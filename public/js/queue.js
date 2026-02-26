/* public/js/queue.js — Queue page: SSE updates, SortableJS, action buttons */

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSpeed(bps) {
  if (bps == null) return '—';
  if (bps < 1024)    return bps.toFixed(0) + ' B/s';
  if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KiB/s';
  return (bps / 1048576).toFixed(1) + ' MiB/s';
}

function fmtEta(sec) {
  if (sec == null) return '—';
  if (sec < 60)   return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
}

function badgeClass(status) {
  return {
    pending:   'badge bg-secondary',
    running:   'badge bg-primary',
    paused:    'badge bg-warning text-dark',
    completed: 'badge bg-success',
    failed:    'badge bg-danger',
    cancelled: 'badge bg-dark',
  }[status] || 'badge bg-secondary';
}

function buildProgressCell(job) {
  const pct = job.progress_pct != null ? job.progress_pct.toFixed(1) : '0';
  if (job.status === 'running' || job.status === 'paused') {
    const animated = job.status === 'running' ? ' progress-bar-animated' : '';
    return `<div class="progress" style="height:18px">
      <div class="progress-bar progress-bar-striped${animated}"
           style="width:${pct}%" role="progressbar"
           aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <small>${pct}%</small>
      </div>
    </div>`;
  }
  if (job.status === 'completed') {
    return `<div class="progress" style="height:18px">
      <div class="progress-bar bg-success" style="width:100%" role="progressbar">
        <small>100%</small>
      </div>
    </div>`;
  }
  return '—';
}

function buildActionButtons(job) {
  const btns = [];
  if (['pending', 'running', 'paused'].includes(job.status)) {
    btns.push(`<button class="btn btn-outline-danger btn-action" type="button"
      data-action="cancel" data-job-id="${job.id}" title="Cancel">✕</button>`);
  }
  if (job.status === 'running') {
    btns.push(`<button class="btn btn-outline-warning btn-action" type="button"
      data-action="pause" data-job-id="${job.id}" title="Pause">⏸</button>`);
  }
  if (job.status === 'paused') {
    btns.push(`<button class="btn btn-outline-success btn-action" type="button"
      data-action="resume" data-job-id="${job.id}" title="Resume">▶</button>`);
  }
  if (['failed', 'cancelled'].includes(job.status)) {
    btns.push(`<button class="btn btn-outline-info btn-action" type="button"
      data-action="retry" data-job-id="${job.id}" title="Retry">↺</button>`);
  }
  if (!['running', 'paused'].includes(job.status)) {
    btns.push(`<button class="btn btn-outline-secondary btn-action" type="button"
      data-action="delete" data-job-id="${job.id}" title="Delete">🗑</button>`);
  }
  return `<div class="btn-group btn-group-sm">${btns.join('')}</div>`;
}

// ── Row update ────────────────────────────────────────────────────────────────

function updateRow(job) {
  const row = document.querySelector(`tr.job-row[data-job-id="${job.id}"]`);
  if (!row) return;

  row.dataset.status = job.status;

  const badge = row.querySelector('.job-status-badge');
  if (badge) {
    badge.className = `job-status-badge ${badgeClass(job.status)}`;
    badge.textContent = job.status;
  }

  const progressCell = row.querySelector('.job-progress-cell');
  if (progressCell) progressCell.innerHTML = buildProgressCell(job);

  const speedCell = row.querySelector('.job-speed');
  if (speedCell) speedCell.textContent = fmtSpeed(job.speed_bps);

  const etaCell = row.querySelector('.job-eta');
  if (etaCell) etaCell.textContent = fmtEta(job.eta_sec);

  const handle = row.querySelector('.drag-handle');
  if (handle) handle.textContent = job.status === 'pending' ? '⠿' : '';

  const actionsCell = row.querySelector('.job-actions');
  if (actionsCell) actionsCell.innerHTML = buildActionButtons(job);

  // Update error message if present
  const titleCell = row.querySelector('.job-title-cell');
  if (titleCell) {
    let errEl = titleCell.querySelector('.text-danger');
    if (job.status === 'failed' && job.error_msg) {
      if (!errEl) {
        errEl = document.createElement('small');
        errEl.className = 'text-danger d-block';
        errEl.style.cssText = 'max-width:320px;white-space:pre-wrap;word-break:break-word';
        titleCell.appendChild(errEl);
      }
      const truncated = job.error_msg.length > 120
        ? job.error_msg.slice(0, 120) + '…'
        : job.error_msg;
      errEl.textContent = truncated;
      errEl.title = job.error_msg;
    } else if (errEl) {
      errEl.remove(); // clear error when status is no longer 'failed'
    }
  }

  applyCurrentFilter();
}

// ── SSE ───────────────────────────────────────────────────────────────────────

let es = null;

function connectSSE() {
  if (es) { es.close(); }
  es = new EventSource('/api/events');

  es.addEventListener('progress', (e) => {
    const d = JSON.parse(e.data);
    const row = document.querySelector(`tr.job-row[data-job-id="${d.jobId}"]`);
    if (!row) return;

    const bar = row.querySelector('.progress-bar');
    if (bar && d.pct != null) {
      const pctStr = d.pct.toFixed(1);
      bar.style.width = pctStr + '%';
      bar.setAttribute('aria-valuenow', pctStr);
      const small = bar.querySelector('small');
      if (small) small.textContent = pctStr + '%';
    }

    const speedCell = row.querySelector('.job-speed');
    const etaCell   = row.querySelector('.job-eta');
    if (speedCell) speedCell.textContent = fmtSpeed(d.speed);
    if (etaCell)   etaCell.textContent   = fmtEta(d.eta);
  });

  const onJobEvent = (e) => {
    const d = JSON.parse(e.data);
    refreshRow(d.jobId);
  };

  es.addEventListener('job:started',   onJobEvent);
  es.addEventListener('job:completed', onJobEvent);
  es.addEventListener('job:failed',    onJobEvent);
  es.addEventListener('job:cancelled', onJobEvent);

  es.onerror = () => {
    es.close();
    es = null;
    setTimeout(connectSSE, 5000);
  };
}

async function refreshRow(jobId) {
  const r = await fetch('/api/queue');
  if (!r.ok) return;
  const jobs = await r.json();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    updateRow(job);
    updateTabCounts();
  }
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

let currentFilter = 'all';

function applyCurrentFilter() {
  document.querySelectorAll('tr.job-row').forEach((row) => {
    row.style.display =
      (currentFilter === 'all' || row.dataset.status === currentFilter) ? '' : 'none';
  });
  checkEmpty();
}

function updateTabCounts() {
  const rows = Array.from(document.querySelectorAll('tr.job-row'));
  const counts = {};
  rows.forEach((r) => { counts[r.dataset.status] = (counts[r.dataset.status] || 0) + 1; });

  document.querySelectorAll('#status-tabs .nav-link').forEach((tab) => {
    const filter = tab.dataset.filter;
    const badge  = tab.querySelector('.badge');
    if (!badge) return;
    if (filter === 'all') {
      badge.textContent = rows.length;
    } else {
      const n = counts[filter] || 0;
      badge.textContent   = n;
      badge.style.display = n ? '' : 'none';
    }
  });
}

function checkEmpty() {
  const visible = Array.from(document.querySelectorAll('tr.job-row'))
    .filter((r) => r.style.display !== 'none');
  let emptyRow = document.getElementById('empty-row');
  if (visible.length === 0) {
    if (!emptyRow) {
      const isAdmin = !!document.querySelector('th.job-user-cell, td.job-user-cell');
      const cols = isAdmin ? 9 : 8;
      emptyRow = document.createElement('tr');
      emptyRow.id = 'empty-row';
      emptyRow.innerHTML =
        `<td colspan="${cols}" class="text-center text-muted">No jobs in queue.</td>`;
      document.getElementById('queue-body').appendChild(emptyRow);
    } else {
      emptyRow.style.display = '';
    }
  } else if (emptyRow) {
    emptyRow.style.display = 'none';
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function doAction(action, jobId) {
  try {
    let r;
    if (action === 'cancel') {
      r = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    } else if (action === 'pause') {
      r = await fetch(`/api/jobs/${jobId}/pause`, { method: 'POST' });
    } else if (action === 'resume') {
      r = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    } else if (action === 'retry') {
      r = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      if (r.ok) {
        window.location.reload();
        return;
      }
    } else if (action === 'delete') {
      r = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (r.ok) {
        document.querySelector(`tr.job-row[data-job-id="${jobId}"]`)?.remove();
        checkEmpty();
        updateTabCounts();
        return;
      }
    }
    if (r && r.ok) {
      await refreshRow(Number(jobId));
      updateTabCounts();
    } else if (r) {
      const body = await r.json().catch(() => ({}));
      alert(body.error || `Action failed (${r.status})`);
    }
  } catch (err) {
    console.error('Action error:', err);
  }
}

// ── SortableJS ────────────────────────────────────────────────────────────────

function initSortable() {
  const tbody = document.getElementById('queue-body');
  if (!tbody || typeof Sortable === 'undefined') return;

  Sortable.create(tbody, {
    handle:    '.drag-handle',
    animation: 150,
    onEnd: async () => {
      const pendingIds = Array.from(
        tbody.querySelectorAll('tr.job-row[data-status="pending"]')
      ).map((r) => Number(r.dataset.jobId));

      if (pendingIds.length < 2) return;
      await fetch('/api/jobs/reorder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order: pendingIds }),
      });
    },
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Status tabs
  document.querySelectorAll('#status-tabs .nav-link').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('#status-tabs .nav-link').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      applyCurrentFilter();
    });
  });

  // Action buttons (delegated)
  document.getElementById('queue-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-action');
    if (!btn) return;
    const { action, jobId } = btn.dataset;
    if (action && jobId) doAction(action, jobId);
  });

  // Clear completed
  document.getElementById('btn-clear-completed').addEventListener('click', async () => {
    const r = await fetch('/api/jobs/clear-completed', { method: 'POST' });
    if (!r.ok) return;
    document.querySelectorAll('tr.job-row').forEach((row) => {
      if (['completed', 'failed', 'cancelled'].includes(row.dataset.status)) row.remove();
    });
    checkEmpty();
    updateTabCounts();
  });

  initSortable();
  connectSSE();
  updateTabCounts();
});
