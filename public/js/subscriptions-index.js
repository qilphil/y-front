/* Subscriptions list page */
'use strict';

// ── Add subscription ─────────────────────────────────────────────────────────

const btnSubmit   = document.getElementById('btn-sub-submit');
const spinner     = document.getElementById('sub-spinner');
const errorDiv    = document.getElementById('add-sub-error');
const urlInput    = document.getElementById('sub-url');
const nameInput   = document.getElementById('sub-name');
const pathInput   = document.getElementById('sub-target-path');
const fmtInput    = document.getElementById('sub-format-spec');
const maxInput    = document.getElementById('sub-max-entries');
const autoChk     = document.getElementById('sub-auto-download');

btnSubmit.addEventListener('click', async () => {
  errorDiv.classList.add('d-none');
  const url = urlInput.value.trim();
  if (!url) { showError('URL is required'); return; }

  btnSubmit.disabled = true;
  spinner.classList.remove('d-none');

  try {
    const res = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        name:          nameInput.value.trim() || undefined,
        target_path:   pathInput.value.trim() || undefined,
        format_spec:   fmtInput.value.trim() || undefined,
        max_entries:   parseInt(maxInput.value, 10) || 50,
        auto_download: autoChk.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Failed to add subscription'); return; }
    window.location.reload();
  } catch (err) {
    showError(err.message);
  } finally {
    btnSubmit.disabled = false;
    spinner.classList.add('d-none');
  }
});

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.classList.remove('d-none');
}

// ── Check buttons ─────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-check-sub').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await fetch(`/api/subscriptions/${id}/check`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        btn.textContent = `+${data.added}`;
        setTimeout(() => { btn.textContent = 'Check'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = 'Error';
        btn.disabled = false;
      }
    } catch {
      btn.textContent = 'Error';
      btn.disabled = false;
    }
  });
});

// ── Delete buttons ────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-delete-sub').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!confirm(`Delete subscription "${btn.dataset.name}"?`)) return;
    const res = await fetch(`/api/subscriptions/${btn.dataset.id}`, { method: 'DELETE' });
    if (res.ok) window.location.reload();
    else alert('Delete failed');
  });
});
