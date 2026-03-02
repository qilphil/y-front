import { Router } from 'express';
import { spawn }  from 'node:child_process';
import { requireAdmin } from '../../middleware/auth.js';
import { db }           from '../../db.js';
import { getYtdlpPath } from '../../services/ytdlp.js';
import downloadQueue    from '../../services/downloadQueue.js';

const router = Router();

const HOME = process.env.HOME || '/root';

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

// Probe a list of candidate executable paths.
// Returns { found, version, path } using the first candidate that exits 0.
async function probeExe(candidates) {
  for (const cmd of candidates) {
    const result = await new Promise((resolve) => {
      const proc = spawn(cmd, ['--version'], { shell: false });
      let out = '';
      proc.stdout.on('data', (c) => { out += c; });
      proc.on('close', (code) => {
        resolve(code === 0
          ? { found: true, version: out.trim().split('\n')[0] || null, path: cmd }
          : null);
      });
      proc.on('error', () => resolve(null));
    });
    if (result) return result;
  }
  return { found: false, version: null, path: null };
}

// Find the uv executable — check PATH first, then common user install locations.
async function findUvPath() {
  const r = await probeExe([
    'uv',
    `${HOME}/.local/bin/uv`,
    `${HOME}/.cargo/bin/uv`,
  ]);
  return r.found ? r.path : 'uv';
}

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

// ── GET /api/ytdlp/status ─────────────────────────────────────────────────────
// Returns availability of both uv and yt-dlp executables.

router.get('/ytdlp/status', requireAdmin, async (req, res) => {
  const [uv, ytdlp] = await Promise.all([
    probeExe(['uv', `${HOME}/.local/bin/uv`, `${HOME}/.cargo/bin/uv`]),
    probeExe([getYtdlpPath(), `${HOME}/.local/bin/yt-dlp`]),
  ]);
  res.json({ uv, ytdlp });
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

// ── POST /api/ytdlp/install-uv ────────────────────────────────────────────────
// Installs uv using the official installer script via curl.
// Progress is streamed line-by-line via uv:output SSE events;
// uv:done fires when the process exits with { code, found, version, path }.

let uvInstallRunning = false;

router.post('/ytdlp/install-uv', requireAdmin, (req, res) => {
  if (uvInstallRunning) return res.status(409).json({ error: 'Install already in progress' });
  uvInstallRunning = true;

  const installCmd = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
  res.json({ started: true, cmd: installCmd });

  const emitter = downloadQueue.getEmitter();
  const emit    = (line, stream) => { if (line) emitter.emit('uv:output', { line, stream }); };

  const proc = spawn('sh', ['-c', installCmd], { shell: false });

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
    uvInstallRunning = false;
    emit(outBuf, 'stdout');
    emit(errBuf, 'stderr');

    // Verify installation at known locations
    const uvStatus = await probeExe([
      'uv',
      `${HOME}/.local/bin/uv`,
      `${HOME}/.cargo/bin/uv`,
    ]);
    emitter.emit('uv:done', {
      code,
      found:   uvStatus.found,
      version: uvStatus.version,
      path:    uvStatus.path,
    });
  });

  proc.on('error', (err) => {
    uvInstallRunning = false;
    emit(`spawn error: ${err.message}`, 'stderr');
    emitter.emit('uv:done', { code: -1, found: false, version: null, path: null });
  });
});

// ── POST /api/ytdlp/update?force=true ────────────────────────────────────────
// Spawns `uv tool upgrade yt-dlp` (or `uv tool install --force yt-dlp`).
// Progress is streamed line-by-line through the shared SSE emitter as
// ytdlp:output events; ytdlp:done fires when the process exits.

let updateRunning = false;

router.post('/ytdlp/update', requireAdmin, async (req, res) => {
  if (updateRunning) return res.status(409).json({ error: 'Update already in progress' });
  updateRunning = true;

  const force   = req.query.force === 'true';
  const uvPath  = await findUvPath();
  const args    = force
    ? ['tool', 'install', '--force', 'yt-dlp']
    : ['tool', 'upgrade', 'yt-dlp'];

  res.json({ started: true, args: [uvPath, ...args] });

  const emitter = downloadQueue.getEmitter();
  const emit    = (line, stream) => { if (line) emitter.emit('ytdlp:output', { line, stream }); };

  const proc = spawn(uvPath, args, { shell: false });

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
