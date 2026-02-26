/* public/js/add-job.js — Add Download page: format picker, playlist selector, submit */

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlaylistUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.has('list') || u.pathname.includes('/playlist');
  } catch { return false; }
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-+$/, '')
    .slice(0, 40);
}

function fmtDuration(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(msg) {
  const el = document.getElementById('error-message');
  el.textContent = msg;
  el.classList.remove('d-none');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  document.getElementById('error-message').classList.add('d-none');
}

// ── Format analysis ───────────────────────────────────────────────────────────

let currentFormatSpec = '';

function updateFormatSpec() {
  const video = document.getElementById('video-format').value;
  const audio = document.getElementById('audio-format').value;
  currentFormatSpec = `${video}+${audio}`;
  document.getElementById('format-spec-preview').textContent = currentFormatSpec;
  document.getElementById('format-spec-input').value = currentFormatSpec;
}

function renderFormats(data) {
  const formats = data.formats || [];
  const videoFmts = formats.filter((f) => f.vcodec && f.vcodec !== 'none');
  const audioFmts = formats.filter(
    (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
  );

  // Show a notice when no specific streams were returned
  const errEl = document.getElementById('format-error');
  if (videoFmts.length === 0 && audioFmts.length === 0) {
    errEl.className = 'alert alert-info small py-2';
    errEl.textContent = 'No format details available — "best" selection will be used automatically.';
    errEl.classList.remove('d-none');
  } else {
    errEl.classList.add('d-none');
  }

  const videoSel = document.getElementById('video-format');
  const audioSel = document.getElementById('audio-format');

  videoSel.innerHTML = '<option value="bestvideo">Best video (auto)</option>';
  videoFmts.forEach((f) => {
    const parts = [
      f.format_id,
      f.ext,
      f.resolution && f.resolution !== 'audio only' ? f.resolution : null,
      f.fps ? f.fps + 'fps' : null,
      f.tbr ? Math.round(f.tbr) + 'k' : null,
      f.format_note,
    ].filter(Boolean).join(' · ');
    videoSel.innerHTML += `<option value="${esc(f.format_id)}">${esc(parts)}</option>`;
  });

  audioSel.innerHTML = '<option value="bestaudio">Best audio (auto)</option>';
  audioFmts.forEach((f) => {
    const parts = [
      f.format_id,
      f.ext,
      f.tbr ? Math.round(f.tbr) + 'k' : null,
      f.format_note,
    ].filter(Boolean).join(' · ');
    audioSel.innerHTML += `<option value="${esc(f.format_id)}">${esc(parts)}</option>`;
  });

  updateFormatSpec();
  document.getElementById('format-loading').classList.add('d-none');
  document.getElementById('format-error').classList.add('d-none');
  document.getElementById('format-table').classList.remove('d-none');
}

async function analyseUrl(url) {
  document.getElementById('format-panel').classList.remove('d-none');
  document.getElementById('format-loading').classList.remove('d-none');
  document.getElementById('format-table').classList.add('d-none');
  document.getElementById('format-error').classList.add('d-none');

  try {
    const r = await fetch(`/api/analyse?url=${encodeURIComponent(url)}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      document.getElementById('format-loading').classList.add('d-none');
      const errEl = document.getElementById('format-error');
      errEl.textContent = 'Analysis failed: ' + (body.error || r.status);
      errEl.classList.remove('d-none');
      return;
    }
    renderFormats(body);
  } catch (err) {
    document.getElementById('format-loading').classList.add('d-none');
    const errEl = document.getElementById('format-error');
    errEl.textContent = 'Analysis error: ' + err.message;
    errEl.classList.remove('d-none');
  }
}

// ── Playlist ──────────────────────────────────────────────────────────────────

let playlistEntries = [];
let isPlaylistMode  = false;

function renderPlaylist(entries) {
  const tbody = document.getElementById('playlist-body');
  tbody.innerHTML = '';

  entries.forEach((entry, i) => {
    const dur = entry.duration_string || fmtDuration(entry.duration);
    const tr  = document.createElement('tr');
    tr.dataset.index = i;
    tr.dataset.title = (entry.title || '').toLowerCase();
    tr.innerHTML = `
      <td><input class="form-check-input entry-check" type="checkbox" checked data-index="${i}"></td>
      <td class="text-muted">${i + 1}</td>
      <td class="text-truncate" style="max-width:340px" title="${esc(entry.title)}">${esc(entry.title)}</td>
      <td class="text-nowrap">${esc(dur)}</td>
    `;
    tbody.appendChild(tr);
  });
  syncCheckAll();
}

function filterPlaylist(pattern) {
  const rows = document.querySelectorAll('#playlist-body tr');
  rows.forEach((row) => {
    if (!pattern) { row.style.display = ''; return; }
    try {
      row.style.display = new RegExp(pattern, 'i').test(row.dataset.title) ? '' : 'none';
    } catch { row.style.display = ''; }
  });
}

function syncCheckAll() {
  const checks = document.querySelectorAll('.entry-check');
  const checkAll = document.getElementById('check-all');
  if (!checkAll || checks.length === 0) return;
  const all  = Array.from(checks).every((c) => c.checked);
  const none = Array.from(checks).every((c) => !c.checked);
  checkAll.indeterminate = !all && !none;
  checkAll.checked = all;
}

async function loadPlaylist(url) {
  document.getElementById('playlist-panel').classList.remove('d-none');
  document.getElementById('playlist-loading').classList.remove('d-none');
  document.getElementById('playlist-error').classList.add('d-none');
  document.getElementById('playlist-body').innerHTML = '';

  try {
    const r    = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`);
    const body = await r.json().catch(() => ({}));
    document.getElementById('playlist-loading').classList.add('d-none');

    if (!r.ok) {
      const errEl = document.getElementById('playlist-error');
      errEl.textContent = 'Playlist load failed: ' + (body.error || r.status);
      errEl.classList.remove('d-none');
      return;
    }

    playlistEntries = body.entries || [];
    isPlaylistMode  = true;

    // Pre-fill subfolder with slugified playlist title
    const sf = document.getElementById('subfolder');
    if (!sf.value && body.title) sf.value = slugify(body.title);

    renderPlaylist(playlistEntries);
  } catch (err) {
    document.getElementById('playlist-loading').classList.add('d-none');
    const errEl = document.getElementById('playlist-error');
    errEl.textContent = 'Playlist error: ' + err.message;
    errEl.classList.remove('d-none');
  }
}

// ── Form submit ───────────────────────────────────────────────────────────────

async function submitForm(e) {
  e.preventDefault();
  hideError();

  const url       = document.getElementById('url-input').value.trim();
  const outputDir = document.getElementById('output-dir').value.trim();
  const subfolder = document.getElementById('subfolder').value.trim();
  const fmtSpec   = document.getElementById('format-spec-input').value.trim();
  const analyseOn = document.getElementById('analyse-check').checked;

  if (!url) { showError('URL is required.'); return; }

  const btn = document.getElementById('btn-submit');
  btn.disabled    = true;
  btn.textContent = 'Adding…';

  try {
    let reqBody;

    if (isPlaylistMode && playlistEntries.length > 0) {
      const selectedChecks = Array.from(
        document.querySelectorAll('#playlist-body tr:not([style*="none"]) .entry-check:checked')
      );
      if (selectedChecks.length === 0) {
        showError('No playlist entries selected.');
        btn.disabled = false; btn.textContent = 'Add to Queue';
        return;
      }
      const jobs = selectedChecks.map((ch) => {
        const entry = playlistEntries[Number(ch.dataset.index)];
        const job   = { url: entry.url };
        if (outputDir) job.output_dir  = outputDir;
        if (subfolder) job.subfolder   = subfolder;
        if (fmtSpec && analyseOn) job.format_spec = fmtSpec;
        return job;
      });
      reqBody = { jobs };
    } else {
      const job = { url };
      if (outputDir) job.output_dir  = outputDir;
      if (subfolder) job.subfolder   = subfolder;
      if (fmtSpec && analyseOn) job.format_spec = fmtSpec;
      reqBody = job;
    }

    const r = await fetch('/api/jobs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(reqBody),
    });

    if (r.ok) {
      window.location.href = '/queue';
      return;
    }

    const data = await r.json().catch(() => ({}));
    const msg  = data.error
      || (data.errors && data.errors[0]?.error)
      || `Submission failed (${r.status})`;
    showError(msg);
    btn.disabled = false; btn.textContent = 'Add to Queue';
  } catch (err) {
    showError('Submission error: ' + err.message);
    btn.disabled = false; btn.textContent = 'Add to Queue';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const urlInput    = document.getElementById('url-input');
  const analyseCheck = document.getElementById('analyse-check');

  // URL input: detect playlist after brief pause
  let playlistDebounce  = null;
  let lastPlaylistUrl   = null;

  urlInput.addEventListener('input', () => {
    clearTimeout(playlistDebounce);
    const url = urlInput.value.trim();
    if (!url) return;

    playlistDebounce = setTimeout(() => {
      if (isPlaylistUrl(url) && url !== lastPlaylistUrl) {
        lastPlaylistUrl = url;
        loadPlaylist(url);
      } else if (!isPlaylistUrl(url)) {
        isPlaylistMode = false;
        lastPlaylistUrl = null;
        document.getElementById('playlist-panel').classList.add('d-none');
        playlistEntries = [];
      }
    }, 700);
  });

  // Analyse checkbox
  analyseCheck.addEventListener('change', () => {
    if (analyseCheck.checked) {
      const url = urlInput.value.trim();
      if (url) {
        analyseUrl(url);
      } else {
        document.getElementById('format-panel').classList.remove('d-none');
        document.getElementById('format-loading').classList.add('d-none');
      }
    } else {
      document.getElementById('format-panel').classList.add('d-none');
      document.getElementById('format-spec-input').value = '';
      currentFormatSpec = '';
    }
  });

  // Format selects
  document.getElementById('video-format').addEventListener('change', updateFormatSpec);
  document.getElementById('audio-format').addEventListener('change', updateFormatSpec);

  // Preset buttons
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFormatSpec = btn.dataset.preset;
      document.getElementById('format-spec-preview').textContent = currentFormatSpec;
      document.getElementById('format-spec-input').value = currentFormatSpec;
    });
  });

  // Playlist toolbar
  document.getElementById('btn-select-all').addEventListener('click', () => {
    document.querySelectorAll('#playlist-body tr').forEach((row) => {
      if (row.style.display !== 'none') row.querySelector('.entry-check').checked = true;
    });
    syncCheckAll();
  });
  document.getElementById('btn-select-none').addEventListener('click', () => {
    document.querySelectorAll('#playlist-body tr .entry-check').forEach((c) => { c.checked = false; });
    syncCheckAll();
  });
  document.getElementById('btn-invert').addEventListener('click', () => {
    document.querySelectorAll('#playlist-body tr').forEach((row) => {
      if (row.style.display !== 'none') {
        const ch = row.querySelector('.entry-check');
        ch.checked = !ch.checked;
      }
    });
    syncCheckAll();
  });
  document.getElementById('check-all').addEventListener('change', function () {
    document.querySelectorAll('#playlist-body tr').forEach((row) => {
      if (row.style.display !== 'none') row.querySelector('.entry-check').checked = this.checked;
    });
  });

  // Regex filter
  document.getElementById('playlist-filter').addEventListener('input', (e) => {
    filterPlaylist(e.target.value);
  });

  // Sync check-all on individual checkbox change
  document.getElementById('playlist-body').addEventListener('change', syncCheckAll);

  // Form submit
  document.getElementById('add-form').addEventListener('submit', submitForm);
});
