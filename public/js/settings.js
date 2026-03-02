/* public/js/settings.js — Settings page: format presets, filesystem browser */

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Format spec presets ───────────────────────────────────────────────────────

document.querySelectorAll('.format-preset').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('default_format_spec').value = item.dataset.spec;
  });
});

// ── Filesystem browser ────────────────────────────────────────────────────────

let fsModal       = null;
let currentFsPath = null;
let currentParent = null;

async function loadDir(path) {
  const loadingEl = document.getElementById('fs-loading');
  const errorEl   = document.getElementById('fs-error');
  const listEl    = document.getElementById('fs-entries');
  const upBtn     = document.getElementById('fs-up');
  const pathLabel = document.getElementById('fs-current-path');

  loadingEl.classList.remove('d-none');
  errorEl.classList.add('d-none');
  listEl.innerHTML = '';

  try {
    const r    = await fetch(`/api/filesystem?path=${encodeURIComponent(path)}`);
    const body = await r.json().catch(() => ({}));

    loadingEl.classList.add('d-none');

    if (!r.ok) {
      // If path not found, fall back to root
      if (r.status === 404 && path !== '/') {
        loadDir('/');
        return;
      }
      errorEl.textContent = body.error || `Error ${r.status}`;
      errorEl.classList.remove('d-none');
      return;
    }

    currentFsPath = body.path;
    currentParent = body.parent;

    pathLabel.textContent = body.path;
    upBtn.disabled = !body.parent;

    if (body.entries.length === 0) {
      listEl.innerHTML = '<div class="text-muted small p-2">Empty directory.</div>';
      return;
    }

    body.entries.forEach((entry) => {
      const item = document.createElement('div');

      if (entry.type === 'directory') {
        item.className =
          'list-group-item list-group-item-action d-flex align-items-center gap-2 py-2';
        item.innerHTML = `<span>📁</span> ${escHtml(entry.name)}`;
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => loadDir(entry.path));
      } else {
        item.className =
          'list-group-item d-flex align-items-center gap-2 py-1 text-muted';
        item.innerHTML = `<span style="opacity:.5">📄</span> <small>${escHtml(entry.name)}</small>`;
      }

      listEl.appendChild(item);
    });
  } catch (err) {
    loadingEl.classList.add('d-none');
    errorEl.textContent = 'Error: ' + err.message;
    errorEl.classList.remove('d-none');
  }
}

// ── yt-dlp update panel ───────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Normalize yt-dlp version strings for comparison.
// yt-dlp uses zero-padded segments (2026.02.21) while PyPI omits them (2026.2.21).
function normVer(v) {
  return (v || '').split('.').map(Number).join('.');
}

let ytdlpInstalled = null;
let ytdlpLatest    = null;
let sseConn        = null;

function renderVersions(data) {
  ytdlpInstalled = data.installed || null;
  ytdlpLatest    = data.latest    || null;

  const instEl   = document.getElementById('ytdlp-installed');
  const latestEl = document.getElementById('ytdlp-latest');
  const badge    = document.getElementById('ytdlp-status-badge');
  const lcEl     = document.getElementById('ytdlp-last-check');
  const btnUpd   = document.getElementById('btn-ytdlp-update');
  const btnForce = document.getElementById('btn-ytdlp-force');

  if (instEl)   instEl.textContent   = ytdlpInstalled || '—';
  if (latestEl) latestEl.textContent = ytdlpLatest    || '—';

  if (badge) {
    badge.classList.remove('d-none', 'bg-success', 'bg-warning', 'text-dark');
    if (ytdlpInstalled && ytdlpLatest) {
      if (normVer(ytdlpInstalled) === normVer(ytdlpLatest)) {
        badge.textContent = 'up to date';
        badge.classList.add('bg-success');
      } else {
        badge.textContent = 'update available';
        badge.classList.add('bg-warning', 'text-dark');
      }
      badge.classList.remove('d-none');
    }
  }

  if (data.last_check && lcEl) {
    lcEl.textContent = new Date(data.last_check).toLocaleString(
      undefined, { dateStyle: 'short', timeStyle: 'short' }
    );
  }

  // Show correct action buttons
  if (btnUpd && btnForce && ytdlpInstalled && ytdlpLatest) {
    if (normVer(ytdlpInstalled) !== normVer(ytdlpLatest)) {
      btnUpd.classList.remove('d-none');
      btnForce.classList.add('d-none');
    } else {
      btnUpd.classList.add('d-none');
      btnForce.classList.remove('d-none');
    }
  }
}

async function ytdlpLoadVersion() {
  const spinner = document.getElementById('ytdlp-check-spinner');
  if (spinner) spinner.classList.remove('d-none');
  try {
    const r    = await fetch('/api/ytdlp/version');
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      renderVersions(data);
      // Auto-check if last_check is missing or older than 24h
      const lastCheck = data.last_check ? new Date(data.last_check).getTime() : 0;
      if (!lastCheck || Date.now() - lastCheck > DAY_MS) ytdlpCheck();
    }
  } finally {
    if (spinner) spinner.classList.add('d-none');
  }
}

async function ytdlpCheck() {
  const spinner = document.getElementById('ytdlp-check-spinner');
  const btn     = document.getElementById('btn-ytdlp-check');
  if (spinner) spinner.classList.remove('d-none');
  if (btn)     btn.disabled = true;
  try {
    const r    = await fetch('/api/ytdlp/check', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (r.ok) renderVersions(data);
    else {
      const lcEl = document.getElementById('ytdlp-last-check');
      if (lcEl) lcEl.textContent = 'Check failed: ' + (data.error || r.status);
    }
  } finally {
    if (spinner) spinner.classList.add('d-none');
    if (btn)     btn.disabled = false;
  }
}

async function ytdlpStartUpdate(force) {
  const wrap    = document.getElementById('ytdlp-terminal-wrap');
  const term    = document.getElementById('ytdlp-terminal');
  const result  = document.getElementById('ytdlp-update-result');
  const btnUpd  = document.getElementById('btn-ytdlp-update');
  const btnForce = document.getElementById('btn-ytdlp-force');
  const btnCheck = document.getElementById('btn-ytdlp-check');

  if (wrap) wrap.classList.remove('d-none');
  if (term) term.textContent = '';
  if (result) result.textContent = '';
  [btnUpd, btnForce, btnCheck].forEach((b) => { if (b) b.disabled = true; });

  // Ensure SSE is connected before kicking off the process
  connectYtdlpSSE();

  const r = await fetch(`/api/ytdlp/update${force ? '?force=true' : ''}`, { method: 'POST' });
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    if (term) appendTermLine('Error: ' + (data.error || r.status), 'stderr');
    [btnUpd, btnForce, btnCheck].forEach((b) => { if (b) b.disabled = false; });
    return;
  }

  if (term && data.args) {
    appendTermLine('$ ' + data.args.join(' '), 'cmd');
  }
}

function appendTermLine(line, stream) {
  const term = document.getElementById('ytdlp-terminal');
  if (!term) return;
  const span = document.createElement('span');
  span.textContent = line + '\n';
  if (stream === 'stderr') span.style.color = '#ffc107';
  else if (stream === 'cmd') span.style.color = '#6ea8fe';
  term.appendChild(span);
  term.scrollTop = term.scrollHeight;
}

function connectYtdlpSSE() {
  if (sseConn && sseConn.readyState !== EventSource.CLOSED) return;
  sseConn = new EventSource('/api/events');

  sseConn.addEventListener('ytdlp:output', (e) => {
    const d = JSON.parse(e.data);
    appendTermLine(d.line, d.stream);
  });

  sseConn.addEventListener('ytdlp:done', async (e) => {
    const d = JSON.parse(e.data);
    const result  = document.getElementById('ytdlp-update-result');
    const btnUpd  = document.getElementById('btn-ytdlp-update');
    const btnForce = document.getElementById('btn-ytdlp-force');
    const btnCheck = document.getElementById('btn-ytdlp-check');

    if (result) {
      result.className = d.code === 0 ? 'small text-success' : 'small text-danger';
      result.textContent = d.code === 0
        ? `Done. Installed version: ${d.version || '—'}`
        : `Failed (exit code ${d.code}).`;
    }

    // Refresh displayed versions
    if (d.version) renderVersions({ installed: d.version, latest: d.version, last_check: new Date().toISOString() });

    [btnUpd, btnForce, btnCheck].forEach((b) => { if (b) b.disabled = false; });

    // Disconnect — only needed during update
    sseConn.close();
    sseConn = null;
  });

  sseConn.onerror = () => {};
}

document.addEventListener('DOMContentLoaded', () => {
  const modalEl = document.getElementById('fs-modal');
  if (!modalEl) return;

  fsModal = new bootstrap.Modal(modalEl);

  // Open modal and navigate to the current configured path
  document.getElementById('btn-browse').addEventListener('click', () => {
    const currentVal =
      document.getElementById('default_download_path').value.trim() || '/';
    fsModal.show();
    loadDir(currentVal);
  });

  // Navigate up to parent
  document.getElementById('fs-up').addEventListener('click', () => {
    if (currentParent) loadDir(currentParent);
  });

  // Select current directory and close modal
  document.getElementById('fs-select').addEventListener('click', () => {
    if (currentFsPath) {
      document.getElementById('default_download_path').value = currentFsPath;
      fsModal.hide();
    }
  });

  // yt-dlp update buttons
  document.getElementById('btn-ytdlp-check')
    ?.addEventListener('click', ytdlpCheck);
  document.getElementById('btn-ytdlp-update')
    ?.addEventListener('click', () => ytdlpStartUpdate(false));
  document.getElementById('btn-ytdlp-force')
    ?.addEventListener('click', () => ytdlpStartUpdate(true));

  ytdlpLoadVersion();
});
