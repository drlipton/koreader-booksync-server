const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { v2: webdav } = require('webdav-server');
const { parseEpub } = require('./epub-helper');
const { handleKosyncRoutes } = require('./kosync');

const PORT = process.env.PORT || 8085;
const BOOKS_DIR = path.join(__dirname, '..', 'data', 'books');
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'config.json');
const LOG_FILE = path.join(__dirname, '..', 'data', 'access.log');

// Ensure directories exist
if (!fs.existsSync(BOOKS_DIR)) {
  fs.mkdirSync(BOOKS_DIR, { recursive: true });
}

function logRequest(req, resStatus, details = '') {
  const line = `[${new Date().toISOString()}] ${req.method} ${req.url} ${resStatus} UA="${req.headers['user-agent'] || ''}" ${details}\n`;
  console.log(line.trim());
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (e) {}
}

// Custom Permissive Authentication Class for WebDAV
class PermissiveAuthentication {
  askForAuthentication() {
    return {};
  }
  getUser(ctx, callback) {
    const authHeader = ctx.headers.find('Authorization');
    let username = 'koreader';
    if (authHeader) {
      const match = authHeader.match(/^Basic\s+(.*)$/i);
      if (match) {
        try {
          const creds = Buffer.from(match[1], 'base64').toString('utf8');
          username = creds.split(':')[0] || 'koreader';
        } catch (e) {}
      }
    }
    return callback(null, new webdav.SimpleUser(username, username, false));
  }
}

// Load Configuration
function loadConfig() {
  const defaultConfig = {
    webdavUser: 'koreader',
    webdavPass: 'books123',
    requireAuth: false,
    port: PORT
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('Error reading config file:', e);
  }
  return defaultConfig;
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

const config = loadConfig();

// Get local IPv4 addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

// WebDAV Server setup
let davServer;
function initWebDavServer() {
  const privilegeManager = new webdav.SimplePathPrivilegeManager();
  privilegeManager.setRights(new webdav.SimpleUser('koreader', 'koreader', false), '/', ['all']);

  davServer = new webdav.WebDAVServer({
    httpAuthentication: new PermissiveAuthentication(),
    privilegeManager: privilegeManager
  });
  const physicalFs = new webdav.PhysicalFileSystem(BOOKS_DIR);

  davServer.setFileSystem('/', physicalFs, (success) => {
    if (success) console.log('WebDAV FileSystem mounted successfully.');
  });
}
initWebDavServer();

const app = express();

// Request logging middleware
app.use((req, res, next) => {
  res.on('finish', () => {
    logRequest(req, res.statusCode);
  });
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup Kosync Routes (KOReader Progress Sync)
handleKosyncRoutes(app);

// File Upload configuration using Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetSubFolder = req.query.folder || '/';
    const safeSubFolder = path.normalize(targetSubFolder).replace(/^(\.\.[\/\\])+/, '');
    const destDir = path.join(BOOKS_DIR, safeSubFolder);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, originalName);
  }
});
const upload = multer({ storage });

function getDirStats(dirPath) {
  let size = 0;
  let fileCount = 0;
  let folderCount = 0;

  function traverse(currentPath) {
    try {
      const files = fs.readdirSync(currentPath);
      for (const file of files) {
        const fullPath = path.join(currentPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          folderCount++;
          traverse(fullPath);
        } else {
          fileCount++;
          size += stat.size;
        }
      }
    } catch (e) {}
  }
  traverse(dirPath);
  return { size, fileCount, folderCount };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// REST API ENDPOINTS FOR MOBILE WEB UI
app.get('/api/books', (req, res) => {
  const reqFolder = req.query.folder || '/';
  const safeRelPath = path.normalize(reqFolder).replace(/^(\.\.[\/\\])+/, '');
  const absPath = path.join(BOOKS_DIR, safeRelPath);

  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  try {
    const files = fs.readdirSync(absPath);
    const items = [];

    for (const name of files) {
      if (name.startsWith('.')) continue;
      const itemAbsPath = path.join(absPath, name);
      const itemRelPath = path.relative(BOOKS_DIR, itemAbsPath).replace(/\\/g, '/');
      const stat = fs.statSync(itemAbsPath);
      const ext = path.extname(name).toLowerCase();

      if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(itemAbsPath).filter(f => !f.startsWith('.'));
        items.push({
          name,
          relPath: itemRelPath,
          isDir: true,
          itemCount: subFiles.length,
          modified: stat.mtime
        });
      } else {
        let metadata = null;
        if (ext === '.epub') {
          const parsed = parseEpub(itemAbsPath);
          metadata = {
            title: parsed.title || null,
            author: parsed.author || null,
            hasCover: !!parsed.coverBuffer
          };
        }

        items.push({
          name,
          relPath: itemRelPath,
          isDir: false,
          size: stat.size,
          formattedSize: formatBytes(stat.size),
          ext,
          modified: stat.mtime,
          metadata
        });
      }
    }

    items.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const parentFolder = safeRelPath === '.' || safeRelPath === '/' || safeRelPath === ''
      ? null
      : path.dirname(safeRelPath).replace(/\\/g, '/');

    res.json({
      currentFolder: safeRelPath === '.' ? '/' : '/' + safeRelPath.replace(/^\//, ''),
      parentFolder: parentFolder && parentFolder !== '.' ? '/' + parentFolder.replace(/^\//, '') : (safeRelPath !== '.' && safeRelPath !== '/' ? '/' : null),
      items
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read directory' });
  }
});

app.get('/api/cover', (req, res) => {
  const reqPath = req.query.path;
  if (!reqPath) return res.status(400).send('Missing path');

  const safeRelPath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const absPath = path.join(BOOKS_DIR, safeRelPath);

  if (!fs.existsSync(absPath)) return res.status(404).send('File not found');

  const ext = path.extname(absPath).toLowerCase();
  if (ext !== '.epub') return res.status(400).send('Covers only supported for EPUB');

  const { coverBuffer, coverMime } = parseEpub(absPath);
  if (!coverBuffer) return res.status(404).send('No cover image found');

  res.setHeader('Content-Type', coverMime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(coverBuffer);
});

app.post('/api/upload', upload.array('files'), (req, res) => {
  res.json({ success: true, count: req.files ? req.files.length : 0 });
});

app.post('/api/mkdir', (req, res) => {
  const { folder, name } = req.body;
  if (!name) return res.status(400).json({ error: 'Folder name required' });

  const safeFolder = path.normalize(folder || '/').replace(/^(\.\.[\/\\])+/, '');
  const safeName = name.replace(/[\/\\]/g, '_').trim();
  const newDirPath = path.join(BOOKS_DIR, safeFolder, safeName);

  if (fs.existsSync(newDirPath)) {
    return res.status(400).json({ error: 'Folder already exists' });
  }

  try {
    fs.mkdirSync(newDirPath, { recursive: true });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

app.post('/api/delete', (req, res) => {
  const { itemPath } = req.body;
  if (!itemPath) return res.status(400).json({ error: 'Item path required' });

  const safePath = path.normalize(itemPath).replace(/^(\.\.[\/\\])+/, '');
  const absPath = path.join(BOOKS_DIR, safePath);

  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'File/folder not found' });

  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      fs.rmSync(absPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(absPath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

app.post('/api/rename', (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: 'Missing old path or new name' });

  const safeOldPath = path.normalize(oldPath).replace(/^(\.\.[\/\\])+/, '');
  const absOldPath = path.join(BOOKS_DIR, safeOldPath);

  if (!fs.existsSync(absOldPath)) return res.status(404).json({ error: 'Item not found' });

  const dir = path.dirname(absOldPath);
  const safeNewName = newName.replace(/[\/\\]/g, '_').trim();
  const absNewPath = path.join(dir, safeNewName);

  try {
    fs.renameSync(absOldPath, absNewPath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to rename item' });
  }
});

app.get('/api/download', (req, res) => {
  const itemPath = req.query.path;
  if (!itemPath) return res.status(400).send('Missing path');

  const safePath = path.normalize(itemPath).replace(/^(\.\.[\/\\])+/, '');
  const absPath = path.join(BOOKS_DIR, safePath);

  if (!fs.existsSync(absPath)) return res.status(404).send('File not found');

  res.download(absPath);
});

app.get('/api/stats', (req, res) => {
  const dirStats = getDirStats(BOOKS_DIR);
  const ips = getLocalIpAddresses();
  res.json({
    totalBooks: dirStats.fileCount,
    totalFolders: dirStats.folderCount,
    totalBytes: dirStats.size,
    formattedTotalSize: formatBytes(dirStats.size),
    serverIp: ips[0] || '127.0.0.1',
    allIps: ips,
    port: PORT,
    config
  });
});

app.post('/api/config', (req, res) => {
  const { requireAuth, webdavUser, webdavPass } = req.body;
  if (typeof requireAuth === 'boolean') config.requireAuth = requireAuth;
  if (webdavUser) config.webdavUser = webdavUser;
  if (webdavPass) config.webdavPass = webdavPass;

  saveConfig(config);
  initWebDavServer();

  res.json({ success: true, config });
});

// Serve Static Frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// WEBDAV MIDDLEWARE & ROUTING WITH PERMISSIVE AUTH & KOReader RELATIVE HREF REWRITER
const webdavMethods = ['PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'OPTIONS'];

app.use((req, res, next) => {
  const isWebdavMethod = webdavMethods.includes(req.method);
  const isDavPath = req.url.startsWith('/dav') || req.url.startsWith('/webdav');

  if (isDavPath || isWebdavMethod) {
    const originalUrl = req.url;
    const reqPath = req.url.replace(/^\/(dav|webdav)/, '') || '/';
    const safeRelPath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const absPath = path.join(BOOKS_DIR, safeRelPath);

    // Handle GET / HEAD for directories (prevents 405 Method Not Allowed error)
    if ((req.method === 'GET' || req.method === 'HEAD') && fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
      res.setHeader('DAV', '1, 2');
      res.setHeader('MS-Author-Via', 'DAV');
      res.setHeader('Allow', 'GET, HEAD, PROPFIND, OPTIONS, PUT, DELETE, MKCOL, MOVE, COPY');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (req.method === 'HEAD') return res.status(200).end();

      const files = fs.readdirSync(absPath).filter(f => !f.startsWith('.'));
      const prefix = originalUrl.startsWith('/dav') ? '/dav' : (originalUrl.startsWith('/webdav') ? '/webdav' : '');
      const links = files.map(f => {
        const itemUrl = (prefix + reqPath + '/' + f).replace(/\/+/g, '/');
        return `<li><a href="${itemUrl}">${f}</a></li>`;
      }).join('');

      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Directory Listing - ${escapeHtml(reqPath)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f3f4f6; padding: 2rem; }
            h1 { font-size: 1.5rem; color: #818cf8; }
            ul { list-style: none; padding: 0; }
            li { margin: 0.5rem 0; padding: 0.5rem; background: #131b2e; border-radius: 6px; }
            a { color: #38bdf8; text-decoration: none; font-weight: 500; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>📁 WebDAV Directory: ${escapeHtml(reqPath)}</h1>
          <ul>${links}</ul>
        </body>
        </html>
      `);
    }

    // Strip prefix before passing to webdav-server so /dav/Books -> /Books
    if (req.url.startsWith('/dav')) {
      req.url = req.url.replace(/^\/dav/, '') || '/';
    } else if (req.url.startsWith('/webdav')) {
      req.url = req.url.replace(/^\/webdav/, '') || '/';
    }

    // ONLY intercept XML responses (PROPFIND / PROPPATCH) to rewrite <D:href>
    // NEVER intercept binary file downloads (GET file.epub, file.pdf, file.cbz)
    if (req.method === 'PROPFIND' || req.method === 'PROPPATCH') {
      const originalWrite = res.write;
      const originalEnd = res.end;
      let chunks = [];

      res.write = function (chunk, encoding) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      };

      res.end = function (chunk, encoding) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        let body = Buffer.concat(chunks).toString('utf8');

        if (body.includes('<') && body.includes('href')) {
          const prefix = originalUrl.startsWith('/dav') ? '/dav' : (originalUrl.startsWith('/webdav') ? '/webdav' : '');
          body = body.replace(/(<[^:]*:href[^>]*>)(?:https?:\/\/[^\/]+)?(\/[^<]*)(<\/[^:]*:href>)/gi, (match, p1, p2, p3) => {
            let cleanPath = p2;
            if (prefix && !cleanPath.startsWith(prefix)) {
              cleanPath = prefix + (cleanPath.startsWith('/') ? '' : '/') + cleanPath;
            }
            return `${p1}${cleanPath}${p3}`;
          });
          res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
        }

        originalWrite.call(res, body, 'utf8');
        originalEnd.call(res, null);
      };
    }

    return davServer.executeRequest(req, res);
  }
  next();
});

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Start Server
const server = http.createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log(`====================================================`);
  console.log(` KOReader BookSync & WebDAV Server Started!`);
  console.log(` Mobile Web Manager: http://${ips[0]}:${PORT}`);
  console.log(` KOReader WebDAV URL: http://${ips[0]}:${PORT}/dav/`);
  console.log(` KOReader Sync Server: http://${ips[0]}:${PORT}/`);
  console.log(` Storage Path:        ${BOOKS_DIR}`);
  console.log(`====================================================`);
});
