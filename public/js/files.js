/* public/js/files.js — File manager: browse, sort, download, delete */

// ── State ─────────────────────────────────────────────────────────────────────

let currentDir  = new URLSearchParams(location.search).get('dir') || '';
let sortCol     = 'name';
let sortAsc     = true;
let entries     = [];
let deleteTarget = null; // { path, rowEl }

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtSize(b) {
  if (b == null) return '—';
  if (b < 1024)        return b + ' B';
  if (b < 1048576)     return (b / 1024).toFixed(1) + ' KiB';
  if (b < 1073741824)  return (b / 1048576).toFixed(1) + ' MiB';
  return (b / 1073741824).toFixed(2) + ' GiB';
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortedEntries() {
  const dirs   = entries.filter((e) => e.type === 'dir');
  const files  = entries.filter((e) => e.type === 'file');

  const cmp = (a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (sortCol === 'name') { av = (av || '').toLowerCase(); bv = (bv || '').toLowerCase(); }
    if (av == null) return 1;
    if (bv == null) return -1;
    return av < bv ? -1 : av > bv ? 1 : 0;
  };

  dirs.sort(cmp);
  files.sort(cmp);
  if (!sortAsc) { dirs.reverse(); files.reverse(); }
  return [...dirs, ...files]; // dirs always group before files
}

function updateSortIcons() {
  ['name', 'size', 'mtime'].forEach((col) => {
    const el = document.getElementById(`sort-${col}-icon`);
    if (!el) return;
    el.textContent = col === sortCol ? (sortAsc ? ' ↑' : ' ↓') : ' ↕';
  });
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function renderBreadcrumb() {
  const bc  = document.getElementById('files-breadcrumb');
  const parts = currentDir ? currentDir.split('/').filter(Boolean) : [];
  const items = [{ label: 'Downloads', dir: '' }];
  let acc = '';
  for (const p of parts) { acc = acc ? `${acc}/${p}` : p; items.push({ label: p, dir: acc }); }

  bc.innerHTML = '<nav aria-label="breadcrumb"><ol class="breadcrumb mb-0">' +
    items.map((item, i) => {
      if (i === items.length - 1) return `<li class="breadcrumb-item active">${esc(item.label)}</li>`;
      return `<li class="breadcrumb-item"><a href="#" data-dir="${esc(item.dir)}">${esc(item.label)}</a></li>`;
    }).join('') +
    '</ol></nav>';

  bc.querySelectorAll('a[data-dir]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.dataset.dir); });
  });
}

// ── Render table ──────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('files-body');
  const sorted = sortedEntries();

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Empty directory.</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map((e) => {
    const relPath = currentDir ? `${currentDir}/${e.name}` : e.name;
    const icon    = e.type === 'dir' ? '📁' : '📄';

    if (e.type === 'dir') {
      return `<tr class="file-row" data-type="dir" data-dir="${esc(relPath)}" style="cursor:pointer">
        <td>${icon}</td>
        <td>${esc(e.name)}</td>
        <td class="text-muted small">—</td>
        <td class="text-muted small">${fmtDate(e.mtime)}</td>
        <td class="text-muted small">${e.count ?? '—'}</td>
        <td></td>
      </tr>`;
    }

    return `<tr class="file-row" data-type="file">
      <td>${icon}</td>
      <td><a href="/api/files/download?path=${encodeURIComponent(relPath)}"
             class="text-decoration-none">${esc(e.name)}</a></td>
      <td class="text-muted small">${fmtSize(e.size)}</td>
      <td class="text-muted small">${fmtDate(e.mtime)}</td>
      <td class="text-muted small">—</td>
      <td><button class="btn btn-outline-danger btn-sm btn-delete py-0 px-1"
                  data-path="${esc(relPath)}" title="Delete" style="font-size:.75rem">🗑</button></td>
    </tr>`;
  }).join('');

  // Dir row click → navigate
  tbody.querySelectorAll('tr[data-type="dir"]').forEach((row) => {
    row.addEventListener('click', () => navigate(row.dataset.dir));
  });

  // Delete button click → show popover
  tbody.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); showDeletePopover(btn.dataset.path, btn); });
  });
}

// ── Navigate ──────────────────────────────────────────────────────────────────

async function navigate(dir) {
  currentDir = dir || '';
  history.pushState({}, '', dir ? `/files?dir=${encodeURIComponent(dir)}` : '/files');
  await loadDir();
}

// ── Load directory ────────────────────────────────────────────────────────────

async function loadDir() {
  document.getElementById('files-loading').style.display = '';
  document.getElementById('files-table-wrap').style.display = 'none';
  document.getElementById('files-error').classList.add('d-none');

  const url = `/api/files/list?dir=${encodeURIComponent(currentDir)}`;
  const r   = await fetch(url).catch(() => null);

  document.getElementById('files-loading').style.display = 'none';

  if (!r || !r.ok) {
    const body = r ? await r.json().catch(() => ({})) : {};
    const errEl = document.getElementById('files-error');
    errEl.textContent = 'Error: ' + (body.error || 'Failed to load directory');
    errEl.classList.remove('d-none');
    return;
  }

  const data = await r.json();
  entries = data.entries || [];
  renderBreadcrumb();
  renderTable();
  updateSortIcons();
  document.getElementById('files-table-wrap').style.display = '';
}

// ── Delete popover ────────────────────────────────────────────────────────────

let popoverVisible = false;

function showDeletePopover(path, anchorEl) {
  const popover = document.getElementById('delete-confirm-popover');
  deleteTarget  = { path, anchorEl };

  // Position near anchor
  popover.classList.remove('d-none');
  popover.style.position = 'fixed';
  popover.style.zIndex   = '1050';

  const rect = anchorEl.getBoundingClientRect();
  popover.style.top  = (rect.bottom + 4 + window.scrollY) + 'px';
  popover.style.left = Math.max(4, rect.right - 200) + 'px';

  popoverVisible = true;
}

function hideDeletePopover() {
  document.getElementById('delete-confirm-popover').classList.add('d-none');
  popoverVisible  = false;
  deleteTarget    = null;
}

async function confirmDelete() {
  if (!deleteTarget) return;
  const { path, anchorEl } = deleteTarget;
  hideDeletePopover();

  const r = await fetch(`/api/files/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  if (r.ok) {
    // Remove the row immediately
    const row = anchorEl.closest('tr');
    if (row) row.remove();
    entries = entries.filter((e) => {
      const rel = currentDir ? `${currentDir}/${e.name}` : e.name;
      return rel !== path;
    });
  } else {
    const body = await r.json().catch(() => ({}));
    alert('Delete failed: ' + (body.error || r.status));
  }
}

// ── Sort click ────────────────────────────────────────────────────────────────

function handleSortClick(col) {
  if (sortCol === col) sortAsc = !sortAsc;
  else { sortCol = col; sortAsc = true; }
  renderTable();
  updateSortIcons();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadDir();

  // Sort headers
  document.querySelectorAll('[data-sort]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); handleSortClick(a.dataset.sort); });
  });

  // Delete popover buttons
  document.getElementById('delete-confirm-yes').addEventListener('click', confirmDelete);
  document.getElementById('delete-confirm-no').addEventListener('click', hideDeletePopover);

  // Dismiss popover on outside click
  document.addEventListener('click', (e) => {
    if (!popoverVisible) return;
    const popover = document.getElementById('delete-confirm-popover');
    if (!popover.contains(e.target) && !e.target.classList.contains('btn-delete')) {
      hideDeletePopover();
    }
  });

  // Browser back/forward
  window.addEventListener('popstate', () => {
    currentDir = new URLSearchParams(location.search).get('dir') || '';
    loadDir();
  });
});
