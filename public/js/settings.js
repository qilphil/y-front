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
});
