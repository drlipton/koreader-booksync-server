const path = require('path');
const fs = require('fs');
const { parseEpub } = require('./epub-helper');

const BOOKS_DIR = path.join(__dirname, '..', 'data', 'books');

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getMimeType(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.epub': return 'application/epub+zip';
    case '.pdf': return 'application/pdf';
    case '.mobi': return 'application/x-mobipocket-ebook';
    case '.azw3': return 'application/vnd.amazon.mobi8-ebook';
    case '.cbz': return 'application/x-cbz';
    case '.cbr': return 'application/x-cbr';
    default: return 'application/octet-stream';
  }
}

function handleOpdsRoutes(app) {
  // OPDS Catalog Root / Folder Listing
  app.get(['/opds', '/opds/', '/opds/folder/{*subpath}'], (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let subPath = req.params.subpath || '';
    if (Array.isArray(subPath)) subPath = subPath.join('/');
    subPath = path.normalize(subPath).replace(/^(\.\.[\/\\])+/, '');
    const absPath = path.join(BOOKS_DIR, subPath);

    if (!fs.existsSync(absPath)) {
      return res.status(404).send('Folder not found');
    }

    try {
      const files = fs.readdirSync(absPath);
      const entriesXml = [];

      for (const name of files) {
        if (name.startsWith('.')) continue;
        const itemAbsPath = path.join(absPath, name);
        const itemRelPath = path.relative(BOOKS_DIR, itemAbsPath).replace(/\\/g, '/');
        const stat = fs.statSync(itemAbsPath);
        const ext = path.extname(name).toLowerCase();
        const updatedIso = stat.mtime.toISOString();

        if (stat.isDirectory()) {
          const folderUrl = `${baseUrl}/opds/folder/${itemRelPath.split('/').map(encodeURIComponent).join('/')}`;
          entriesXml.push(`
    <entry>
      <title>${escapeXml(name)}</title>
      <id>urn:koreader-booksync:folder:${escapeXml(itemRelPath)}</id>
      <updated>${updatedIso}</updated>
      <link rel="subsection" href="${folderUrl}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
      <content type="text">Directory containing books</content>
    </entry>`);
        } else {
          let title = name.replace(/\.[^/.]+$/, '');
          let author = 'Unknown Author';
          let hasCover = false;

          if (ext === '.epub') {
            const parsed = parseEpub(itemAbsPath);
            if (parsed.title) title = parsed.title;
            if (parsed.author) author = parsed.author;
            hasCover = !!parsed.coverBuffer;
          }

          const downloadUrl = `${baseUrl}/api/download?path=${encodeURIComponent(itemRelPath)}`;
          const mimeType = getMimeType(ext);

          let coverXml = '';
          if (hasCover) {
            const coverUrl = `${baseUrl}/api/cover?path=${encodeURIComponent(itemRelPath)}`;
            coverXml = `
      <link rel="http://opds-spec.org/image" href="${coverUrl}" type="image/jpeg"/>
      <link rel="http://opds-spec.org/image/thumbnail" href="${coverUrl}" type="image/jpeg"/>`;
          }

          entriesXml.push(`
    <entry>
      <title>${escapeXml(title)}</title>
      <author><name>${escapeXml(author)}</name></author>
      <id>urn:koreader-booksync:book:${escapeXml(itemRelPath)}</id>
      <updated>${updatedIso}</updated>
      ${coverXml}
      <link rel="http://opds-spec.org/acquisition" href="${downloadUrl}" type="${mimeType}"/>
      <content type="text">${escapeXml(name)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)</content>
    </entry>`);
        }
      }

      const selfUrl = `${baseUrl}${req.originalUrl}`;
      const feedXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <id>urn:koreader-booksync:opds:${escapeXml(subPath || 'root')}</id>
  <title>BookSync OPDS Library${subPath ? ' - ' + escapeXml(subPath) : ''}</title>
  <updated>${new Date().toISOString()}</updated>
  <link rel="self" href="${selfUrl}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="${baseUrl}/opds/" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  ${entriesXml.join('\n')}
</feed>`;

      res.setHeader('Content-Type', 'application/atom+xml; profile=opds-catalog; charset=utf-8');
      res.send(feedXml);
    } catch (e) {
      console.error('Error generating OPDS feed:', e);
      res.status(500).send('Error generating OPDS feed');
    }
  });
}

module.exports = { handleOpdsRoutes };
