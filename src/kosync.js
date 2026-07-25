const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'kosync.json');

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

  // Get Progress for Document (Smart Cross-Device Sync Matcher)
  app.get('/syncs/progress/:document', (req, res) => {
    const username = req.headers['x-auth-user'] || req.query?.username || req.body?.username || 'joel';
    const reqDocHash = req.params.document;

    const data = loadData();
    const userSyncs = data.syncs[username] || {};
    const exactRecord = userSyncs[reqDocHash];

    let newestUserRecord = null;
    let newestUserTimestamp = 0;

    // Find newest progress record for this user across all document hashes
    Object.keys(userSyncs).forEach(hash => {
      const rec = userSyncs[hash];
      if ((rec.timestamp || 0) > newestUserTimestamp) {
        newestUserTimestamp = rec.timestamp || 0;
        newestUserRecord = rec;
      }
    });

    let bestRecord = null;

    if (newestUserRecord) {
      const exactTime = exactRecord ? (exactRecord.timestamp || 0) : 0;
      // If another device pushed newer progress for this user, use the newest progress
      if (newestUserTimestamp >= exactTime) {
        bestRecord = { ...newestUserRecord, document: reqDocHash };
      } else {
        bestRecord = { ...exactRecord, document: reqDocHash };
      }
    } else {
      // Global fallback search across all users
      for (const u of Object.keys(data.syncs)) {
        for (const h of Object.keys(data.syncs[u])) {
          const rec = data.syncs[u][h];
          if (!bestRecord || (rec.timestamp || 0) > (bestRecord.timestamp || 0)) {
            bestRecord = { ...rec, document: reqDocHash };
          }
        }
      }
    }

    if (!bestRecord) {
      return res.status(404).json({ message: 'No progress found for document' });
    }

    return res.status(200).json(bestRecord);
  });

  // API route for Web UI to view Kosync activity
  app.get('/api/kosync/summary', (req, res) => {
    const data = loadData();
    const allRecords = [];
    Object.keys(data.syncs).forEach(user => {
      Object.keys(data.syncs[user]).forEach(doc => {
        allRecords.push({ user, ...data.syncs[user][doc] });
      });
    });
    allRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({
      totalUsers: Object.keys(data.users).length,
      totalSyncedBooks: allRecords.length,
      recentSyncs: allRecords.slice(0, 10)
    });
  });
}

module.exports = { handleKosyncRoutes };
