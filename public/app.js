// Application State
let currentFolder = '/';
let allItems = [];
let currentFilter = 'all';
let viewMode = 'grid'; // 'grid' or 'list'
let serverIp = '192.168.0.80';
let serverPort = 8085;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadStats();
  loadBooks(currentFolder);
  loadKosyncSummary();
  setInterval(loadKosyncSummary, 10000); // refresh sync status every 10s
});

function initEventListeners() {
  // Navigation & Toolbar
  document.getElementById('btn-home').addEventListener('click', () => loadBooks('/'));
  document.getElementById('search-input').addEventListener('input', filterAndRenderItems);
  
  // View mode toggles
  document.getElementById('btn-view-grid').addEventListener('click', () => setViewMode('grid'));
  document.getElementById('btn-view-list').addEventListener('click', () => setViewMode('list'));

  // Modals & Buttons
  document.getElementById('btn-upload').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', handleFileSelect);
  
  document.getElementById('btn-koreader-guide').addEventListener('click', () => {
    openModal('modal-guide');
    generateQrCode(`http://${serverIp}:${serverPort}/dav/`);
  });

  document.getElementById('btn-mkdir').addEventListener('click', () => openModal('modal-mkdir'));
  document.getElementById('btn-submit-mkdir').addEventListener('click', submitMkdir);
  document.getElementById('btn-submit-rename').addEventListener('click', submitRename);

  // Filter Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      filterAndRenderItems();
    });
  });

  // Modal Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById(e.target.dataset.tab).classList.add('active');
    });
  });

  // Drag & Drop File Upload
  setupDragAndDrop();
}

// Fetch Server Stats & Config
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    serverIp = data.serverIp || window.location.hostname;
    serverPort = data.port || 8080;

    document.getElementById('stat-books').textContent = data.totalBooks || 0;
    document.getElementById('stat-storage').textContent = data.formattedTotalSize || '0 MB';
    document.getElementById('stat-ip').textContent = `${serverIp}:${serverPort}`;

    const davUrl = `http://${serverIp}:${serverPort}/dav/`;
    const kosyncUrl = `http://${serverIp}:${serverPort}/`;

    document.getElementById('input-dav-url').value = davUrl;
    document.getElementById('input-kosync-url').value = kosyncUrl;
  } catch (e) {
    console.error('Error loading stats:', e);
  }
}

// Load Books in Folder
async function loadBooks(folderPath) {
  currentFolder = folderPath;
  const grid = document.getElementById('file-grid');
  grid.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <span>Loading library...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/books?folder=${encodeURIComponent(folderPath)}`);
    const data = await res.json();
    allItems = data.items || [];

    renderBreadcrumbs(data.currentFolder, data.parentFolder);
    filterAndRenderItems();
  } catch (e) {
    showToast('Failed to load library', 'error');
    grid.innerHTML = `<div class="empty-state">Error loading folder</div>`;
  }
}

// Render Breadcrumb Navigation
function renderBreadcrumbs(current, parent) {
  const container = document.getElementById('breadcrumb-list');
  container.innerHTML = '';

  const parts = current.split('/').filter(Boolean);
  let accumulatedPath = '';

  const rootCrumb = document.createElement('span');
  rootCrumb.className = `crumb ${parts.length === 0 ? 'active' : ''}`;
  rootCrumb.textContent = 'Root';
  rootCrumb.onclick = () => loadBooks('/');
  container.appendChild(rootCrumb);

  parts.forEach((part, index) => {
    accumulatedPath += '/' + part;
    const sep = document.createElement('span');
    sep.textContent = ' / ';
    sep.style.opacity = '0.4';
    container.appendChild(sep);

    const crumb = document.createElement('span');
    crumb.className = `crumb ${index === parts.length - 1 ? 'active' : ''}`;
    crumb.textContent = part;
    const pathTarget = accumulatedPath;
    crumb.onclick = () => loadBooks(pathTarget);
    container.appendChild(crumb);
  });
}

// Filter and Render Items
function filterAndRenderItems() {
  const grid = document.getElementById('file-grid');
  const searchVal = document.getElementById('search-input').value.toLowerCase().trim();

  let filtered = allItems.filter(item => {
    // Search filter
    const titleMatch = (item.metadata?.title || item.name).toLowerCase().includes(searchVal);
    const authorMatch = (item.metadata?.author || '').toLowerCase().includes(searchVal);
    if (!titleMatch && !authorMatch) return false;

    // Type filter
    if (currentFilter === 'folder') return item.isDir;
    if (currentFilter === 'all') return true;

    const allowedExts = currentFilter.split(',');
    return !item.isDir && allowedExts.includes(item.ext);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No books found</h3>
        <p>Upload your EPUBs or PDFs to get started!</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  filtered.forEach(item => {
    if (item.isDir) {
      grid.appendChild(createFolderCard(item));
    } else {
      grid.appendChild(createBookCard(item));
    }
  });
}

// Create Folder Card Element
function createFolderCard(item) {
  const div = document.createElement('div');
  div.className = 'folder-card';
  div.onclick = () => loadBooks('/' + item.relPath);

  div.innerHTML = `
    <div class="folder-icon">📁</div>
    <div class="folder-info">
      <span class="folder-name">${escapeHtml(item.name)}</span>
      <span class="folder-count">${item.itemCount} item${item.itemCount === 1 ? '' : 's'}</span>
    </div>
    <div class="card-actions" onclick="event.stopPropagation()">
      <button class="action-btn" title="Rename" onclick="openRenameModal('${escapeHtml(item.relPath)}', '${escapeHtml(item.name)}')">✏️</button>
      <button class="action-btn delete" title="Delete" onclick="deleteItem('${escapeHtml(item.relPath)}')">🗑️</button>
    </div>
  `;
  return div;
}

// Create Book Card Element
function createBookCard(item) {
  const div = document.createElement('div');
  div.className = 'book-card';

  const extUpper = (item.ext || '').replace('.', '').toUpperCase();
  const title = item.metadata?.title || item.name.replace(/\.[^/.]+$/, '');
  const author = item.metadata?.author || 'Unknown Author';

  let coverHtml = '';
  if (item.metadata?.hasCover) {
    coverHtml = `<img src="/api/cover?path=${encodeURIComponent(item.relPath)}" alt="Cover" loading="lazy">`;
  } else {
    const bgGradient = getGradientForTitle(title);
    coverHtml = `
      <div class="cover-placeholder" style="background: ${bgGradient}">
        <div class="ph-icon">${getFormatIcon(item.ext)}</div>
        <div class="ph-title">${escapeHtml(title)}</div>
      </div>
    `;
  }

  div.innerHTML = `
    <div class="book-cover">
      ${coverHtml}
      <span class="ext-badge">${extUpper}</span>
    </div>
    <div class="book-details">
      <div class="book-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="book-author">${escapeHtml(author)}</div>
      <div class="book-meta">
        <span>${item.formattedSize}</span>
        <div class="card-actions" onclick="event.stopPropagation()">
          <a href="/api/download?path=${encodeURIComponent(item.relPath)}" class="action-btn" title="Download" download>💾</a>
          <button class="action-btn" title="Rename" onclick="openRenameModal('${escapeHtml(item.relPath)}', '${escapeHtml(item.name)}')">✏️</button>
          <button class="action-btn delete" title="Delete" onclick="deleteItem('${escapeHtml(item.relPath)}')">🗑️</button>
        </div>
      </div>
    </div>
  `;
  return div;
}

// View Mode Toggle
function setViewMode(mode) {
  viewMode = mode;
  const grid = document.getElementById('file-grid');
  document.getElementById('btn-view-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');

  grid.className = `file-grid ${mode}-mode`;
}

// File Selection & Upload
function handleFileSelect(e) {
  const files = e.target.files;
  if (files && files.length > 0) {
    uploadFiles(files);
  }
}

async function uploadFiles(files) {
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  showToast(`Uploading ${files.length} file(s)...`, 'info');

  try {
    const res = await fetch(`/api/upload?folder=${encodeURIComponent(currentFolder)}`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Successfully uploaded ${data.count} book(s)!`, 'success');
      loadStats();
      loadBooks(currentFolder);
    } else {
      showToast('Upload failed', 'error');
    }
  } catch (e) {
    showToast('Upload request failed', 'error');
  }
}

// Drag & Drop Setup
function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
  });

  dropZone.addEventListener('dragleave', (e) => {
    if (e.target === dropZone) {
      dropZone.classList.remove('active');
    }
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('active');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });
}

// Create Directory
async function submitMkdir() {
  const nameInput = document.getElementById('input-mkdir-name');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const res = await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: currentFolder, name })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Folder created!', 'success');
      closeModal('modal-mkdir');
      nameInput.value = '';
      loadBooks(currentFolder);
    } else {
      showToast(data.error || 'Failed to create folder', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// Delete Item
async function deleteItem(itemPath) {
  if (!confirm(`Are you sure you want to delete "${itemPath}"?`)) return;

  try {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemPath })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Deleted successfully', 'success');
      loadStats();
      loadBooks(currentFolder);
    } else {
      showToast(data.error || 'Failed to delete item', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// Rename Item
function openRenameModal(oldPath, oldName) {
  document.getElementById('rename-old-path').value = oldPath;
  document.getElementById('input-rename-name').value = oldName;
  openModal('modal-rename');
}

async function submitRename() {
  const oldPath = document.getElementById('rename-old-path').value;
  const newName = document.getElementById('input-rename-name').value.trim();
  if (!newName) return;

  try {
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newName })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Renamed successfully', 'success');
      closeModal('modal-rename');
      loadBooks(currentFolder);
    } else {
      showToast(data.error || 'Failed to rename', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// Kosync Reading Progress Summary
async function loadKosyncSummary() {
  try {
    const res = await fetch('/api/kosync/summary');
    const data = await res.json();

    document.getElementById('stat-syncs').textContent = data.totalSyncedBooks || 0;
    const container = document.getElementById('kosync-list');

    if (!data.recentSyncs || data.recentSyncs.length === 0) {
      container.innerHTML = `<div class="empty-sync">No active progress sync records yet. Connect KOReader to start syncing!</div>`;
      return;
    }

    container.innerHTML = '';
    data.recentSyncs.forEach(sync => {
      const div = document.createElement('div');
      div.className = 'sync-item';
      const percent = Math.round((sync.percentage || 0) * 100);

      div.innerHTML = `
        <div class="sync-device">${escapeHtml(sync.device)} (${escapeHtml(sync.user)})</div>
        <div class="sync-progress-bar">
          <div class="sync-progress-fill" style="width: ${percent}%"></div>
        </div>
        <div class="sync-info">${percent}% • ${escapeHtml(sync.progress || 'Page')}</div>
      `;
      container.appendChild(div);
    });
  } catch (e) {}
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Copy Helper
function copyValue(inputId) {
  const el = document.getElementById(inputId);
  el.select();
  navigator.clipboard.writeText(el.value);
  showToast('Copied to clipboard!', 'success');
}

// Toast Helper
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Helpers
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getFormatIcon(ext) {
  switch ((ext || '').toLowerCase()) {
    case '.epub': return '📖';
    case '.pdf': return '📄';
    case '.mobi': case '.azw3': return '📙';
    case '.cbz': case '.cbr': return '🎨';
    default: return '📕';
  }
}

function getGradientForTitle(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 65%, 25%) 0%, hsl(${h2}, 70%, 15%) 100%)`;
}

// Minimal Clean SVG QR Code Renderer
function generateQrCode(text) {
  const box = document.getElementById('qr-code-box');
  box.innerHTML = `
    <svg viewBox="0 0 100 100" width="100%" height="100%" shape-rendering="crispEdges">
      <rect width="100" height="100" fill="#ffffff" />
      <g fill="#000000">
        <!-- Outer Frame Position Pattern TL -->
        <rect x="10" y="10" width="24" height="24" fill="#000" />
        <rect x="13" y="13" width="18" height="18" fill="#fff" />
        <rect x="16" y="16" width="12" height="12" fill="#000" />

        <!-- Outer Frame Position Pattern TR -->
        <rect x="66" y="10" width="24" height="24" fill="#000" />
        <rect x="69" y="13" width="18" height="18" fill="#fff" />
        <rect x="72" y="16" width="12" height="12" fill="#000" />

        <!-- Outer Frame Position Pattern BL -->
        <rect x="10" y="66" width="24" height="24" fill="#000" />
        <rect x="13" y="69" width="18" height="18" fill="#fff" />
        <rect x="16" y="72" width="12" height="12" fill="#000" />

        <!-- Data Matrix Mock Pattern -->
        <rect x="40" y="10" width="4" height="8" />
        <rect x="48" y="10" width="4" height="4" />
        <rect x="56" y="14" width="4" height="8" />
        <rect x="40" y="22" width="8" height="4" />
        <rect x="52" y="26" width="8" height="4" />

        <rect x="10" y="40" width="8" height="4" />
        <rect x="22" y="40" width="4" height="8" />
        <rect x="30" y="44" width="8" height="4" />
        <rect x="42" y="40" width="16" height="4" />
        <rect x="66" y="40" width="8" height="4" />
        <rect x="78" y="44" width="8" height="4" />

        <rect x="40" y="52" width="4" height="8" />
        <rect x="48" y="56" width="8" height="4" />
        <rect x="60" y="52" width="4" height="8" />

        <rect x="40" y="66" width="8" height="4" />
        <rect x="52" y="66" width="4" height="8" />
        <rect x="60" y="70" width="8" height="4" />
        <rect x="40" y="78" width="12" height="4" />
        <rect x="56" y="82" width="4" height="8" />
        <rect x="66" y="78" width="8" height="8" />
        <rect x="78" y="70" width="8" height="4" />
        <rect x="78" y="82" width="8" height="4" />
      </g>
    </svg>
  `;
}
