import { Router } from 'express';
import { spawn }  from 'node:child_process';
import { requireAdmin } from '../../middleware/auth.js';
import { db }           from '../../db.js';
import { getYtdlpPath } from '../../services/ytdlp.js';
import downloadQueue    from '../../services/downloadQueue.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const getSetting = (key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null;

const setSetting = (key, value) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);

const getInstalledVersion = () =>
  new Promise((resolve) => {
    const proc = spawn(getYtdlpPath(), ['--version'], { shell: false });
    let out = '';
    proc.stdout.on('data', (c) => { out += c; });
    proc.on('close', () => resolve(out.trim() || null));
    proc.on('error', () => resolve(null));
  });

// ── GET /api/ytdlp/version ────────────────────────────────────────────────────
// Returns installed version from binary + stored latest/last_check from DB.
// Fast — does not hit the network.

router.get('/ytdlp/version', requireAdmin, async (req, res) => {
  const installed = await getInstalledVersion();
  res.json({
    installed,
    latest:     getSetting('ytdlp_latest_version') || null,
    last_check: getSetting('ytdlp_last_check')     || null,
  });
});

// ── POST /api/ytdlp/check ─────────────────────────────────────────────────────
// Fetches the latest release version from PyPI and stores it.

router.post('/ytdlp/check', requireAdmin, async (req, res) => {
  try {
    const r      = await fetch('https://pypi.org/pypi/yt-dlp/json');
    if (!r.ok) throw new Error(`PyPI responded with ${r.status}`);
    const data   = await r.json();
    const latest = data?.info?.version ?? null;
    if (!latest) throw new Error('Could not parse version from PyPI response');

    const now = new Date().toISOString();
    setSetting('ytdlp_latest_version', latest);
    setSetting('ytdlp_last_check',     now);

    const installed = await getInstalledVersion();
    res.json({ installed, latest, last_check: now });
  } catch (err) {
    res.status(502).json({ error: 'Version check failed: ' + err.message });
  }
});

// ── POST /api/ytdlp/update?force=true ────────────────────────────────────────
// Spawns `uv tool upgrade yt-dlp` (or `uv tool install --force yt-dlp`).
// Progress is streamed line-by-line through the shared SSE emitter as
// ytdlp:output events; ytdlp:done fires when the process exits.

let updateRunning = false;

router.post('/ytdlp/update', requireAdmin, (req, res) => {
  if (updateRunning) return res.status(409).json({ error: 'Update already in progress' });
  updateRunning = true;

  const force   = req.query.force === 'true';
  const args    = force
    ? ['tool', 'install', '--force', 'yt-dlp']
    : ['tool', 'upgrade', 'yt-dlp'];

  res.json({ started: true, args: ['uv', ...args] });

  const emitter = downloadQueue.getEmitter();
  const emit    = (line, stream) => { if (line) emitter.emit('ytdlp:output', { line, stream }); };

  const proc = spawn('uv', args, { shell: false });

  let outBuf = '', errBuf = '';

  proc.stdout.on('data', (chunk) => {
    outBuf += chunk.toString();
    const lines = outBuf.split('\n'); outBuf = lines.pop();
    lines.forEach((l) => emit(l, 'stdout'));
  });

  proc.stderr.on('data', (chunk) => {
    errBuf += chunk.toString();
    const lines = errBuf.split('\n'); errBuf = lines.pop();
    lines.forEach((l) => emit(l, 'stderr'));
  });

  proc.on('close', async (code) => {
    updateRunning = false;
    emit(outBuf, 'stdout');
    emit(errBuf, 'stderr');

    const version = await getInstalledVersion();
    if (version) {
      setSetting('ytdlp_latest_version', version);
      setSetting('ytdlp_last_check',     new Date().toISOString());
    }
    emitter.emit('ytdlp:done', { code, version });
  });

  proc.on('error', (err) => {
    updateRunning = false;
    emit(`spawn error: ${err.message}`, 'stderr');
    emitter.emit('ytdlp:done', { code: -1, version: null });
  });
});

export default router;
