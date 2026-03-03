/* Subscription detail page */
'use strict';

const subId = (() => {
  const m = location.pathname.match(/\/subscriptions\/(\d+)/);
  return m ? m[1] : null;
})();

// ── Toast helper ──────────────────────────────────────────────────────────────

const toastEl   = document.getElementById('main-toast');
const toastBody = document.getElementById('toast-body');
let bsToast;
if (toastEl) {
  bsToast = new bootstrap.Toast(toastEl, { delay: 3500 });
}
function showToast(msg, type = 'success') {
  if (!bsToast) return;
  toastEl.className = `toast align-items-center text-bg-${type} border-0`;
  toastBody.textContent = msg;
  bsToast.show();
}

// ── Check for new ─────────────────────────────────────────────────────────────

const btnCheck    = document.getElementById('btn-check');
const checkSpinner = document.getElementById('check-spinner');
if (btnCheck) {
  btnCheck.addEventListener('click', async () => {
    btnCheck.disabled = true;
    checkSpinner.classList.remove('d-none');
    try {
      const res  = await fetch(`/api/subscriptions/${subId}/check`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(`Check complete: ${data.added} new, ${data.total} total`);
        if (data.added > 0) setTimeout(() => location.reload(), 1500);
      } else {
        showToast(data.error || 'Check failed', 'danger');
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      btnCheck.disabled = false;
      checkSpinner.classList.add('d-none');
    }
  });
}

// ── Verify files ──────────────────────────────────────────────────────────────

const btnVerify    = document.getElementById('btn-verify');
const verifySpinner = document.getElementById('verify-spinner');
if (btnVerify) {
  btnVerify.addEventListener('click', async () => {
    btnVerify.disabled = true;
    verifySpinner.classList.remove('d-none');
    try {
      const res  = await fetch(`/api/subscriptions/${subId}/verify`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(`Verified ${data.verified} files; ${data.missing_count} missing`);
        if (data.missing_count > 0) setTimeout(() => location.reload(), 1500);
      } else {
        showToast(data.error || 'Verify failed', 'danger');
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      btnVerify.disabled = false;
      verifySpinner.classList.add('d-none');
    }
  });
}

// ── Delete subscription ───────────────────────────────────────────────────────

const btnDeleteSub = document.getElementById('btn-delete-sub');
if (btnDeleteSub) {
  btnDeleteSub.addEventListener('click', async () => {
    if (!confirm(`Delete subscription "${btnDeleteSub.dataset.name}"?`)) return;
    const res = await fetch(`/api/subscriptions/${subId}`, { method: 'DELETE' });
    if (res.ok) location.href = '/subscriptions';
    else showToast('Delete failed', 'danger');
  });
}

// ── Edit subscription ─────────────────────────────────────────────────────────

const btnEditSave = document.getElementById('btn-edit-save');
const editError   = document.getElementById('edit-sub-error');
if (btnEditSave) {
  btnEditSave.addEventListener('click', async () => {
    editError.classList.add('d-none');
    const body = {
      name:          document.getElementById('edit-name').value.trim(),
      target_path:   document.getElementById('edit-target-path').value.trim() || null,
      format_spec:   document.getElementById('edit-format-spec').value.trim() || null,
      max_entries:   parseInt(document.getElementById('edit-max-entries').value, 10) || 50,
      auto_download: document.getElementById('edit-auto-download').checked,
    };
    const res = await fetch(`/api/subscriptions/${subId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      location.reload();
    } else {
      editError.textContent = data.error || 'Save failed';
      editError.classList.remove('d-none');
    }
  });
}

// ── Select all ────────────────────────────────────────────────────────────────

const selectAll   = document.getElementById('select-all');
const rowChecks   = () => [...document.querySelectorAll('.row-check')];
const getSelected = () => rowChecks().filter((c) => c.checked).map((c) => Number(c.value));

if (selectAll) {
  selectAll.addEventListener('change', () => {
    rowChecks().forEach((c) => { c.checked = selectAll.checked; });
    updateBulkButtons();
  });
}

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('row-check')) updateBulkButtons();
});

function updateBulkButtons() {
  const n = getSelected().length;
  const btnQueueSel = document.getElementById('btn-queue-selected');
  const btnSkipSel  = document.getElementById('btn-skip-selected');
  if (btnQueueSel) btnQueueSel.disabled = n === 0;
  if (btnSkipSel)  btnSkipSel.disabled  = n === 0;
}

// ── Queue selected ────────────────────────────────────────────────────────────

const btnQueueSelected = document.getElementById('btn-queue-selected');
if (btnQueueSelected) {
  btnQueueSelected.addEventListener('click', () => queueEntries(getSelected()));
}

// ── Queue all new ─────────────────────────────────────────────────────────────

const btnQueueAllNew = document.getElementById('btn-queue-all-new');
if (btnQueueAllNew) {
  btnQueueAllNew.addEventListener('click', async () => {
    btnQueueAllNew.disabled = true;
    try {
      const res  = await fetch(`/api/subscriptions/${subId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'new' }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Queued ${data.queued} jobs`);
        setTimeout(() => location.reload(), 1200);
      } else {
        showToast(data.error || 'Queue failed', 'danger');
      }
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      btnQueueAllNew.disabled = false;
    }
  });
}

async function queueEntries(entry_ids) {
  if (!entry_ids.length) return;
  try {
    const res  = await fetch(`/api/subscriptions/${subId}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_ids }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Queued ${data.queued} jobs`);
      setTimeout(() => location.reload(), 1200);
    } else {
      showToast(data.error || 'Queue failed', 'danger');
    }
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ── Skip selected ─────────────────────────────────────────────────────────────

const btnSkipSelected = document.getElementById('btn-skip-selected');
if (btnSkipSelected) {
  btnSkipSelected.addEventListener('click', () => {
    const ids = getSelected();
    Promise.all(ids.map((id) => patchEntryState(id, 'skipped'))).then(() => location.reload());
  });
}

// ── Per-row skip / unskip ─────────────────────────────────────────────────────

document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('btn-skip-entry')) {
    const id = Number(e.target.dataset.id);
    const ok = await patchEntryState(id, 'skipped');
    if (ok) location.reload();
  } else if (e.target.classList.contains('btn-unskip-entry')) {
    const id = Number(e.target.dataset.id);
    const ok = await patchEntryState(id, 'new');
    if (ok) location.reload();
  }
});

async function patchEntryState(entryId, state) {
  try {
    const res = await fetch(`/api/subscriptions/${subId}/entries/${entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const d = await res.json();
      showToast(d.error || 'Update failed', 'danger');
      return false;
    }
    return true;
  } catch (err) {
    showToast(err.message, 'danger');
    return false;
  }
}
