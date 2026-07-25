const AdmZip = require('adm-zip');
const path = require('path');

/**
 * Extracts metadata and cover image from an EPUB file.
 * @param {string} filePath Absolute path to the EPUB file
 * @returns {object} { title, author, coverBuffer, coverMime }
 */
function parseEpub(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    // Find container.xml
    const containerEntry = zipEntries.find(e => e.entryName === 'META-INF/container.xml');
    if (!containerEntry) {
      return { title: null, author: null, coverBuffer: null, coverMime: null };
    }
    
    const containerText = containerEntry.getData().toString('utf8');
    const opfMatch = containerText.match(/full-path=["']([^"']+)["']/i);
    if (!opfMatch) {
      return { title: null, author: null, coverBuffer: null, coverMime: null };
    }
    
    const opfPath = opfMatch[1];
    const opfDir = path.dirname(opfPath);
    const opfEntry = zipEntries.find(e => e.entryName === opfPath);
    if (!opfEntry) {
      return { title: null, author: null, coverBuffer: null, coverMime: null };
    }
    
    const opfText = opfEntry.getData().toString('utf8');
    
    // Extract Title
    const titleMatch = opfText.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // Extract Author
    const authorMatch = opfText.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
    const author = authorMatch ? authorMatch[1].trim() : null;
    
    // Find Cover Image ID or href
    let coverHref = null;
    
    // Method 1: properties="cover-image"
    const coverPropMatch = opfText.match(/<item[^>]+properties=["'][^"']*cover-image[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
                           opfText.match(/<item[^>]+href=["']([^"']+)["'][^>]+properties=["'][^"']*cover-image[^"']*["']/i);
    if (coverPropMatch) {
      coverHref = coverPropMatch[1];
    }
    
    // Method 2: meta name="cover"
    if (!coverHref) {
      const metaCoverMatch = opfText.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/i) ||
                             opfText.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']cover["']/i);
      if (metaCoverMatch) {
        const coverId = metaCoverMatch[1];
        // find item with id=coverId
        const itemMatch = opfText.match(new RegExp(`<item[^>]+id=["']${coverId}["'][^>]+href=["']([^"']+)["']`, 'i')) ||
                          opfText.match(new RegExp(`<item[^>]+href=["']([^"']+)["'][^>]+id=["']${coverId}["']`, 'i'));
        if (itemMatch) {
          coverHref = itemMatch[1];
        }
      }
    }
    
    // Method 3: item id="cover" or id="cover-image"
    if (!coverHref) {
      const coverItemMatch = opfText.match(/<item[^>]+id=["'](?:cover|cover-image|cover_image)["'][^>]+href=["']([^"']+)["']/i);
      if (coverItemMatch) {
        coverHref = coverItemMatch[1];
      }
    }

    // Method 4: any image file with cover in name
    if (!coverHref) {
      const coverFileMatch = zipEntries.find(e => /\bcover\b.*\.(jpg|jpeg|png|webp|gif)$/i.test(e.entryName));
      if (coverFileMatch) {
        const ext = path.extname(coverFileMatch.entryName).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return {
          title,
          author,
          coverBuffer: coverFileMatch.getData(),
          coverMime: mime
        };
      }
    }
    
    if (coverHref) {
      // Decode URI components in coverHref
      try {
        coverHref = decodeURIComponent(coverHref);
      } catch (e) {}
      
      const fullCoverPath = opfDir && opfDir !== '.' ? path.join(opfDir, coverHref).replace(/\\/g, '/') : coverHref;
      const coverEntry = zipEntries.find(e => e.entryName === fullCoverPath || e.entryName.endsWith(coverHref));
      
      if (coverEntry) {
        const ext = path.extname(coverEntry.entryName).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return {
          title,
          author,
          coverBuffer: coverEntry.getData(),
          coverMime: mime
        };
      }
    }
    
    return { title, author, coverBuffer: null, coverMime: null };
  } catch (err) {
    return { title: null, author: null, coverBuffer: null, coverMime: null };
  }
}

module.exports = { parseEpub };
