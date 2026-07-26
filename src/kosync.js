const fs = require('fs');
const path = require('path');
const { parseEpub } = require('./epub-helper');

const DB_FILE = path.join(__dirname, '..', 'data', 'kosync.json');
const BOOKS_DIR = path.join(__dirname, '..', 'data', 'books');

function loadData() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading Kosync DB:', e);
  }
  return { users: {}, syncs: {} };
}

function saveData(data) {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving Kosync DB:', e);
  }
}

// Find all books in data/books directory recursively
function getAllBookFiles(dirPath, fileList = []) {
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.startsWith('.')) continue;
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getAllBookFiles(fullPath, fileList);
      } else {
        const ext = path.extname(file).toLowerCase();
        if (['.epub', '.pdf', '.mobi', '.azw3', '.cbz', '.cbr', '.txt', '.fb2'].includes(ext)) {
          const relPath = path.relative(BOOKS_DIR, fullPath).replace(/\\/g, '/');
          let metadata = null;
          if (ext === '.epub') {
            const parsed = parseEpub(fullPath);
            metadata = {
              title: parsed.title || null,
              author: parsed.author || null,
              hasCover: !!parsed.coverBuffer
            };
          }
          fileList.push({
            name: file,
            relPath,
            ext,
            size: stat.size,
            metadata
          });
        }
      }
    }
  } catch (e) {}
  return fileList;
}

function handleKosyncRoutes(app) {
  // Healthcheck
  app.get(['/healthcheck', '/users/healthcheck'], (req, res) => res.status(200).send('OK'));

  // Auth User Handler (supports both GET and POST /users/auth)
  const authUserHandler = (req, res) => {
    const username = req.headers['x-auth-user'] || req.query?.username || req.body?.username || req.body?.user || 'joel';
    const authKey = req.headers['x-auth-key'] || req.query?.password || req.body?.password || '';

    const data = loadData();

    if (!data.users[username]) {
      data.users[username] = { key: authKey, createdAt: new Date().toISOString() };
    } else if (authKey && !data.users[username].key) {
      data.users[username].key = authKey;
    }
    saveData(data);

    res.setHeader('x-auth-user', username);
    return res.status(200).json({ authorized: 'OK' });
  };

  app.get('/users/auth', authUserHandler);
  app.post('/users/auth', authUserHandler);

  // Create User Handler
  app.post('/users/create', (req, res) => {
    const username = req.headers['x-auth-user'] || req.query?.username || req.body?.username || req.body?.user || 'joel';
    const authKey = req.headers['x-auth-key'] || req.query?.password || req.body?.password || '';

    const data = loadData();
    data.users[username] = { key: authKey, createdAt: new Date().toISOString() };
    saveData(data);

    res.setHeader('x-auth-user', username);
    return res.status(201).json({ username });
  });

  // Update Progress
  app.put('/syncs/progress', (req, res) => {
    const username = req.headers['x-auth-user'] || req.query?.username || req.body?.username || 'joel';
    const body = req.body || {};

    const documentHash = body.document;
    if (!documentHash) {
      return res.status(400).json({ error: 'Missing document parameter' });
    }

    const data = loadData();
    if (!data.syncs[username]) data.syncs[username] = {};

    const syncRecord = {
      document: documentHash,
      progress: body.progress || '',
      percentage: body.percentage || 0,
      device: body.device || 'KOReader Device',
      device_id: body.device_id || 'unknown',
      timestamp: body.timestamp || Math.floor(Date.now() / 1000),
      updatedAt: new Date().toISOString()
    };

    data.syncs[username][documentHash] = syncRecord;
    saveData(data);

    return res.status(200).json({
      document: documentHash,
      timestamp: syncRecord.timestamp
    });
  });

  // Get Progress for Document (STRICT BOOK-SPECIFIC MATCHING)
  app.get('/syncs/progress/:document', (req, res) => {
    const username = req.headers['x-auth-user'] || req.query?.username || req.body?.username || 'joel';
    const reqDocHash = req.params.document;

    const data = loadData();

    // 1. Check specified username's exact document hash match
    let record = (data.syncs[username] || {})[reqDocHash];

    // 2. Fallback: Search across other users for the EXACT same document hash
    if (!record) {
      for (const u of Object.keys(data.syncs)) {
        if (data.syncs[u] && data.syncs[u][reqDocHash]) {
          record = data.syncs[u][reqDocHash];
          break;
        }
      }
    }

    // If no progress found for this SPECIFIC document, return 404 (Book hasn't been synced yet)
    if (!record) {
      return res.status(404).json({ message: 'No progress found for document' });
    }

    return res.status(200).json(record);
  });

  // API route for Web UI to view Kosync activity grouped BY BOOK
  app.get('/api/kosync/summary', (req, res) => {
    const data = loadData();
    const booksInStorage = getAllBookFiles(BOOKS_DIR);
    const docGroupMap = {};

    Object.keys(data.syncs).forEach(user => {
      Object.keys(data.syncs[user]).forEach(docHash => {
        const rec = data.syncs[user][docHash];
        if (!docGroupMap[docHash]) {
          docGroupMap[docHash] = {
            document: docHash,
            devices: [],
            latestTimestamp: 0,
            latestProgress: null
          };
        }

        docGroupMap[docHash].devices.push({ user, ...rec });

        if ((rec.timestamp || 0) > docGroupMap[docHash].latestTimestamp) {
          docGroupMap[docHash].latestTimestamp = rec.timestamp || 0;
          docGroupMap[docHash].latestProgress = rec;
        }
      });
    });

    const bookSyncList = Object.values(docGroupMap).map(group => {
      // Try to match book in storage
      let matchedBook = null;

      // Check if any stored book name matches or partial matches
      if (booksInStorage.length === 1) {
        matchedBook = booksInStorage[0];
      } else if (booksInStorage.length > 0) {
        matchedBook = booksInStorage.find(b => b.relPath.includes(group.document)) || booksInStorage[0];
      }

      const latest = group.latestProgress || {};
      return {
        document: group.document,
        bookTitle: matchedBook?.metadata?.title || matchedBook?.name || `Document (${group.document.substring(0, 8)})`,
        bookAuthor: matchedBook?.metadata?.author || null,
        relPath: matchedBook?.relPath || null,
        hasCover: matchedBook?.metadata?.hasCover || false,
        latestPercentage: latest.percentage || 0,
        latestProgressText: latest.progress || '',
        updatedAt: latest.updatedAt || new Date().toISOString(),
        timestamp: latest.timestamp || 0,
        devices: group.devices.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      };
    });

    bookSyncList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    res.json({
      totalUsers: Object.keys(data.users).length,
      totalSyncedBooks: bookSyncList.length,
      books: bookSyncList
    });
  });
}

module.exports = { handleKosyncRoutes };
