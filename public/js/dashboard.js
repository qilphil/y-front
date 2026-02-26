/* public/js/dashboard.js — Dashboard: quick-add, live queue mini-list, recent files */

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

function fmtEta(sec) {
  if (sec == null) return '—';
  sec = Math.round(sec);
  if (sec < 60)   return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function fmtSpeed(bps) {
  if (bps == null) return '—';
  if (bps < 1024)    return bps.toFixed(0) + ' B/s';
  if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KiB/s';
  return (bps / 1048576).toFixed(1) + ' MiB/s';
}

function badgeClass(status) {
  return ({ pending:'bg-secondary', running:'bg-primary', paused:'bg-warning text-dark',
            completed:'bg-success', failed:'bg-danger', cancelled:'bg-dark' })[status] || 'bg-secondary';
}

// ── Format picker (mirrors add-job.js) ───────────────────────────────────────

let currentFormatSpec = '';

function dedup(fmts, keyFn) {
  const seen = new Set();
  return fmts.filter((f) => { const k = keyFn(f); if (seen.has(k)) return false; seen.add(k); return true; });
}

function updateFormatSpec() {
  const audioRow = document.getElementById('audio-format-row');
  const isMuxed  = audioRow && audioRow.classList.contains('d-none');
  const video    = document.getElementById('video-format').value;
  currentFormatSpec = isMuxed ? (video || 'best') : `${video}+${document.getElementById('audio-format').value}`;
  document.getElementById('format-spec-preview').textContent = currentFormatSpec;
  document.getElementById('format-spec-input').value = currentFormatSpec;
}

function renderFormats(data) {
  const formats       = data.formats || [];
  const videoOnlyFmts = dedup(
    formats.filter((f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none')),
    (f) => `${f.resolution}|${f.vcodec}|${f.fps ?? ''}|${Math.round(f.tbr ?? 0)}`
  );
  const audioOnlyFmts = dedup(
    formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')),
    (f) => `${f.acodec}|${f.ext}|${f.format_note ?? ''}`
  );
  const muxedFmts = dedup(
    formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'),
    (f) => `${f.resolution}|${f.vcodec}|${f.acodec}|${Math.round(f.tbr ?? 0)}`
  );
  const muxedOnly = videoOnlyFmts.length === 0 && audioOnlyFmts.length === 0 && muxedFmts.length > 0;

  document.getElementById('format-loading').classList.add('d-none');
  const errEl = document.getElementById('format-error');

  if (formats.length === 0) {
    errEl.className = 'alert alert-info small py-2';
    errEl.textContent = 'No format details available — "best" selection will be used automatically.';
    errEl.classList.remove('d-none');
    document.getElementById('format-table').classList.add('d-none');
    return;
  }
  errEl.classList.add('d-none');

  const videoSel   = document.getElementById('video-format');
  const audioSel   = document.getElementById('audio-format');
  const audioRow   = document.getElementById('audio-format-row');
  const videoLabel = document.getElementById('video-format-label');

  if (muxedOnly) {
    audioRow.classList.add('d-none');
    videoLabel.textContent = 'Format (muxed stream)';
    videoSel.innerHTML = '<option value="best">Best (auto)</option>';
    muxedFmts.forEach((f) => {
      const parts = [f.format_id, f.ext,
        f.resolution && f.resolution !== 'audio only' ? f.resolution : null,
        f.fps ? f.fps + 'fps' : null, f.tbr ? Math.round(f.tbr) + 'k' : null,
      ].filter(Boolean).join(' · ');
      videoSel.innerHTML += `<option value="${esc(f.format_id)}">${esc(parts)}</option>`;
    });
  } else {
    audioRow.classList.remove('d-none');
    videoLabel.textContent = 'Video stream';
    videoSel.innerHTML = '<option value="bestvideo">Best video (auto)</option>';
    videoOnlyFmts.forEach((f) => {
      const parts = [f.format_id, f.ext,
        f.resolution && f.resolution !== 'audio only' ? f.resolution : null,
        f.fps ? f.fps + 'fps' : null, f.tbr ? Math.round(f.tbr) + 'k' : null, f.format_note,
      ].filter(Boolean).join(' · ');
      videoSel.innerHTML += `<option value="${esc(f.format_id)}">${esc(parts)}</option>`;
    });
    audioSel.innerHTML = '<option value="bestaudio">Best audio (auto)</option>';
    audioOnlyFmts.forEach((f) => {
      const parts = [f.format_id, f.ext,
        f.tbr ? Math.round(f.tbr) + 'k' : null, f.format_note,
      ].filter(Boolean).join(' · ');
      audioSel.innerHTML += `<option value="${esc(f.format_id)}">${esc(parts)}</option>`;
    });
  }

  updateFormatSpec();
  document.getElementById('format-table').classList.remove('d-none');
}

async function runAnalyse(url) {
  document.getElementById('format-panel').classList.remove('d-none');
  document.getElementById('format-loading').classList.remove('d-none');
  document.getElementById('format-table').classList.add('d-none');
  document.getElementById('format-error').classList.add('d-none');
  try {
    const r    = await fetch(`/api/analyse?url=${encodeURIComponent(url)}`);
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

// ── Queue mini-list ───────────────────────────────────────────────────────────

let allJobs = [];

function buildQueueHtml(jobs) {
  // Sort: running/paused first, then pending, then finished (most recent last)
  const order = { running: 0, paused: 1, pending: 2, completed: 3, failed: 3, cancelled: 3 };
  const sorted = [...jobs].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.id - b.id);
  const active    = sorted.filter((j) => ['running','paused','pending'].includes(j.status));
  const finished  = sorted.filter((j) => !['running','paused','pending'].includes(j.status))
                          .sort((a, b) => b.id - a.id); // most recent first
  const display = [...active, ...finished].slice(0, 10);

  if (display.length === 0) {
    return '<p class="text-muted small p-3 mb-0">No jobs in queue.</p>';
  }

  return display.map((j) => {
    const url     = esc(j.url || '');
    const short   = url.length > 60 ? url.slice(0, 60) + '…' : url;
    const badge   = `<span class="badge ${badgeClass(j.status)} me-2">${esc(j.status)}</span>`;
    let detail = '';
    if (j.status === 'running' || j.status === 'paused') {
      const pct = j.progress_pct != null ? j.progress_pct.toFixed(1) : '0';
      const animated = j.status === 'running' ? ' progress-bar-animated' : '';
      detail = `
        <div class="progress mt-1" style="height:6px">
          <div class="progress-bar progress-bar-striped${animated}" style="width:${pct}%"
               data-jobid="${j.id}" role="progressbar"></div>
        </div>
        <small class="text-muted" data-speed="${j.id}">${fmtSpeed(j.speed_bps)} · ETA ${fmtEta(j.eta_sec)}</small>`;
    } else if (j.status === 'failed' && j.error_msg) {
      detail = `<small class="text-danger d-block">${esc(j.error_msg.slice(0, 80))}</small>`;
    }
    return `<div class="border-bottom px-3 py-2 dash-job-row" data-job-id="${j.id}">
      <div class="d-flex align-items-center">${badge}<span class="small text-truncate" style="max-width:320px" title="${url}">${short}</span></div>
      ${detail}
    </div>`;
  }).join('');
}

async function loadQueue() {
  const r = await fetch('/api/queue').catch(() => null);
  if (!r || !r.ok) return;
  allJobs = await r.json();
  const el = document.getElementById('dash-queue');
  el.innerHTML = buildQueueHtml(allJobs);
  document.getElementById('dash-queue-loading').style.display = 'none';
  el.style.display = '';
}

// ── Recent files ──────────────────────────────────────────────────────────────

function buildFilesHtml(files) {
  if (!files.length) return '<p class="text-muted small p-3 mb-0">No files found.</p>';
  return `<table class="table table-sm table-hover mb-0">
    <thead class="table-light"><tr><th>Name</th><th style="width:7rem">Size</th><th style="width:11rem">Modified</th></tr></thead>
    <tbody>${files.map((f) => `
      <tr>
        <td><a href="/api/files/download?path=${encodeURIComponent(f.path)}" class="text-decoration-none"
               title="${esc(f.path)}">${esc(f.name)}</a></td>
        <td class="text-muted small">${fmtSize(f.size)}</td>
        <td class="text-muted small">${fmtDate(f.mtime)}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function loadRecentFiles() {
  const r = await fetch('/api/files/recent').catch(() => null);
  if (!r || !r.ok) return;
  const { files } = await r.json();
  const el = document.getElementById('dash-files');
  el.innerHTML = buildFilesHtml(files);
  document.getElementById('dash-files-loading').style.display = 'none';
  el.style.display = '';
}

// ── Rolling averages for running jobs ─────────────────────────────────────────

const jobBuffers = new Map();
function getBuffers(id) {
  if (!jobBuffers.has(id)) jobBuffers.set(id, { speed: [], eta: [] });
  return jobBuffers.get(id);
}
function pushAvg(buf, val) {
  if (val == null || !isFinite(val)) return buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : null;
  buf.push(val); if (buf.length > 10) buf.shift();
  return buf.reduce((a, b) => a + b, 0) / buf.length;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

let es = null;

function connectSSE() {
  if (es) es.close();
  es = new EventSource('/api/events');

  es.addEventListener('progress', (e) => {
    const d    = JSON.parse(e.data);
    const bufs = getBuffers(d.jobId);
    const avgSpeed = pushAvg(bufs.speed, d.speed);
    const avgEta   = pushAvg(bufs.eta, d.eta);

    const row = document.querySelector(`.dash-job-row[data-job-id="${d.jobId}"]`);
    if (!row) return;
    const bar = row.querySelector(`[data-jobid="${d.jobId}"]`);
    if (bar && d.pct != null) bar.style.width = d.pct.toFixed(1) + '%';
    const speedEl = row.querySelector(`[data-speed="${d.jobId}"]`);
    if (speedEl) speedEl.textContent = `${fmtSpeed(avgSpeed)} · ETA ${fmtEta(avgEta)}`;
  });

  const onJobChange = (e) => {
    const d = JSON.parse(e.data);
    jobBuffers.delete(d.jobId);
    loadQueue();
  };
  const onFilesChanged = () => loadRecentFiles();

  es.addEventListener('job:started',   onJobChange);
  es.addEventListener('job:completed', onJobChange);
  es.addEventListener('job:failed',    onJobChange);
  es.addEventListener('job:cancelled', onJobChange);
  es.addEventListener('files:changed', onFilesChanged);

  es.onerror = () => { es.close(); es = null; setTimeout(connectSSE, 5000); };
}

// ── Form submit ───────────────────────────────────────────────────────────────

async function submitForm(e) {
  e.preventDefault();
  const successEl = document.getElementById('dash-success');
  const errorEl   = document.getElementById('dash-error');
  successEl.classList.add('d-none');
  errorEl.classList.add('d-none');

  const url     = document.getElementById('url-input').value.trim();
  const fmtSpec = document.getElementById('format-spec-input').value.trim();
  const analyse = document.getElementById('analyse-check').checked;

  if (!url) { errorEl.textContent = 'URL is required.'; errorEl.classList.remove('d-none'); return; }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true; btn.textContent = 'Adding…';

  const job = { url };
  if (fmtSpec && analyse) job.format_spec = fmtSpec;

  try {
    const r = await fetch('/api/jobs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(job),
    });
    if (r.ok) {
      successEl.textContent = 'Added to queue.';
      successEl.classList.remove('d-none');
      document.getElementById('url-input').value = '';
      document.getElementById('format-spec-input').value = '';
      document.getElementById('format-panel').classList.add('d-none');
      document.getElementById('analyse-check').checked = false;
      currentFormatSpec = '';
      setTimeout(() => successEl.classList.add('d-none'), 4000);
      loadQueue();
    } else {
      const data = await r.json().catch(() => ({}));
      errorEl.textContent = data.error || `Failed (${r.status})`;
      errorEl.classList.remove('d-none');
    }
  } catch (err) {
    errorEl.textContent = 'Error: ' + err.message;
    errorEl.classList.remove('d-none');
  }
  btn.disabled = false; btn.textContent = 'Add to Queue';
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadQueue();
  loadRecentFiles();
  setInterval(loadRecentFiles, 60_000); // fallback poll for externally added files

  document.getElementById('analyse-check').addEventListener('change', function () {
    if (this.checked) {
      const url = document.getElementById('url-input').value.trim();
      if (url) runAnalyse(url); else document.getElementById('format-panel').classList.remove('d-none');
    } else {
      document.getElementById('format-panel').classList.add('d-none');
      document.getElementById('format-spec-input').value = '';
      currentFormatSpec = '';
    }
  });

  document.getElementById('video-format').addEventListener('change', updateFormatSpec);
  document.getElementById('audio-format').addEventListener('change', updateFormatSpec);

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFormatSpec = btn.dataset.preset;
      document.getElementById('format-spec-preview').textContent = currentFormatSpec;
      document.getElementById('format-spec-input').value = currentFormatSpec;
    });
  });

  document.getElementById('dash-form').addEventListener('submit', submitForm);

  connectSSE();
});
