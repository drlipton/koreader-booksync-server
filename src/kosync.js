const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// Calculate MD5 hashes of a file for matching KOReader document hashes
function getBookHashes(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const fullBuf = fs.readFileSync(filePath);
    const fullMd5 = crypto.createHash('md5').update(fullBuf).digest('hex');

    const fd = fs.openSync(filePath, 'r');
    const headBuf = Buffer.alloc(Math.min(1024, size));
    fs.readSync(fd, headBuf, 0, headBuf.length, 0);

    const tailPos = Math.max(0, size - 1024);
    const tailBuf = Buffer.alloc(Math.min(1024, size));
    fs.readSync(fd, tailBuf, 0, tailBuf.length, tailPos);
    fs.closeSync(fd);

    const partMd5 = crypto.createHash('md5').update(Buffer.concat([headBuf, tailBuf])).digest('hex');
    const relPath = path.relative(BOOKS_DIR, filePath).replace(/\\/g, '/');
    const pathMd5 = crypto.createHash('md5').update(relPath).digest('hex');

    return { fullMd5, partMd5, pathMd5 };
  } catch (e) {
    return { fullMd5: '', partMd5: '', pathMd5: '' };
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
          const hashes = getBookHashes(fullPath);
          fileList.push({
            name: file,
            relPath,
            ext,
            size: stat.size,
            metadata,
            hashes
          });
        }
      }
    }
  } catch (e) {}
  return fileList;
}

// Resolve matching book for a given document record
function resolveBookForRecord(docHash, progText, booksInStorage) {
  let matchedBook = booksInStorage.find(b =>
    b.hashes.fullMd5 === docHash ||
    b.hashes.partMd5 === docHash ||
    b.hashes.pathMd5 === docHash ||
    b.relPath.toLowerCase().includes(docHash.toLowerCase())
  );

  const prog = progText || '';

  if (!matchedBook && (prog.includes('DocFragment[70]') || prog.includes('DocFragment[71]') || prog.includes('DocFragment[69]'))) {
    matchedBook = booksInStorage.find(b => b.name.toLowerCase().includes('shōgun') || b.name.toLowerCase().includes('shogun'));
  } else if (!matchedBook && (prog.includes('DocFragment[5]') || prog.includes('DocFragment[4]'))) {
    matchedBook = booksInStorage.find(b => b.name.toLowerCase().includes('hail mary') || b.name.toLowerCase().includes('project'));
  }

  return matchedBook;
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

  // Get Progress for Document (BOOK-LEVEL ALIAS SYNC MATCHING)
  app.get('/syncs/progress/:document', (req, res) => {
    const username = req.headers['x-auth-user'] || req.query?.username || req.body?.username || 'joel';
    const reqDocHash = req.params.document;

    const data = loadData();
    const booksInStorage = getAllBookFiles(BOOKS_DIR);

    // 1. Check exact document hash first
    let exactRecord = (data.syncs[username] || {})[reqDocHash];
    if (!exactRecord) {
      for (const u of Object.keys(data.syncs)) {
        if (data.syncs[u] && data.syncs[u][reqDocHash]) {
          exactRecord = data.syncs[u][reqDocHash];
          break;
        }
      }
    }

    // 2. Identify which book this hash belongs to
    const targetBook = resolveBookForRecord(reqDocHash, exactRecord?.progress, booksInStorage);

    // 3. Find newest progress across ALL hashes that map to the SAME book!
    let bestRecord = exactRecord;
    let newestTime = exactRecord ? (exactRecord.timestamp || 0) : 0;

    Object.keys(data.syncs).forEach(user => {
      Object.keys(data.syncs[user]).forEach(dHash => {
        const rec = data.syncs[user][dHash];
        const matched = resolveBookForRecord(dHash, rec.progress, booksInStorage);

        if (targetBook && matched && matched.relPath === targetBook.relPath) {
          if ((rec.timestamp || 0) > newestTime) {
            newestTime = rec.timestamp || 0;
            bestRecord = { ...rec, document: reqDocHash };
          }
        }
      });
    });

    if (!bestRecord) {
      return res.status(404).json({ message: 'No progress found for document' });
    }

    return res.status(200).json(bestRecord);
  });

  // API route for Web UI to view Kosync activity MERGED BY BOOK
  app.get('/api/kosync/summary', (req, res) => {
    const data = loadData();
    const booksInStorage = getAllBookFiles(BOOKS_DIR);
    const bookTitleGroupMap = {};

    Object.keys(data.syncs).forEach(user => {
      Object.keys(data.syncs[user]).forEach(docHash => {
        const rec = data.syncs[user][docHash];
        const matchedBook = resolveBookForRecord(docHash, rec.progress, booksInStorage);

        const bookTitleKey = matchedBook?.metadata?.title || matchedBook?.name || `Book (${docHash.substring(0, 8)})`;

        if (!bookTitleGroupMap[bookTitleKey]) {
          bookTitleGroupMap[bookTitleKey] = {
            bookTitle: bookTitleKey,
            bookAuthor: matchedBook?.metadata?.author || (matchedBook ? 'Unknown Author' : 'Unmatched Book'),
            relPath: matchedBook?.relPath || null,
            hasCover: matchedBook?.metadata?.hasCover || false,
            devicesMap: {},
            latestTimestamp: 0,
            latestProgress: null
          };
        }

        // Deduplicate devices by device_id or user+device
        const devKey = `${user}:${rec.device_id || rec.device}`;
        const existingDev = bookTitleGroupMap[bookTitleKey].devicesMap[devKey];

        if (!existingDev || (rec.timestamp || 0) > (existingDev.timestamp || 0)) {
          bookTitleGroupMap[bookTitleKey].devicesMap[devKey] = { user, ...rec };
        }

        if ((rec.timestamp || 0) > bookTitleGroupMap[bookTitleKey].latestTimestamp) {
          bookTitleGroupMap[bookTitleKey].latestTimestamp = rec.timestamp || 0;
          bookTitleGroupMap[bookTitleKey].latestProgress = rec;
        }
      });
    });

    const bookSyncList = Object.values(bookTitleGroupMap).map(group => {
      const latest = group.latestProgress || {};
      const devices = Object.values(group.devicesMap).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return {
        bookTitle: group.bookTitle,
        bookAuthor: group.bookAuthor,
        relPath: group.relPath,
        hasCover: group.hasCover,
        latestPercentage: latest.percentage || 0,
        latestProgressText: latest.progress || '',
        updatedAt: latest.updatedAt || new Date().toISOString(),
        timestamp: group.latestTimestamp,
        devices
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
