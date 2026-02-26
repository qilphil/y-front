import { spawn }        from 'node:child_process';
import { EventEmitter } from 'node:events';
import treeKill         from 'tree-kill';
import { db }           from '../db.js';
import { logEvent }     from '../middleware/logger.js';
import { getYtdlpPath, buildArgs } from './ytdlp.js';

// ── Singleton state ───────────────────────────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(200); // many SSE clients can subscribe

/** @type {Map<number, { proc: import('node:child_process').ChildProcess }>} */
const active = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

const getSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

/**
 * Replace yt-dlp's NA / None / numeric-strings in a YTDLP_JSON line so
 * JSON.parse doesn't choke on unquoted non-number values.
 */
const sanitiseProgressLine = (raw) =>
  raw.replace(/:\s*(NA|None)\b/g, ':null');

// ── Internal spawn ────────────────────────────────────────────────────────────

const _spawn = (job, settings) => {
  if (active.has(job.id)) return;

  const args = buildArgs(job, settings);
  const proc = spawn(getYtdlpPath(), args, { shell: false });

  active.set(job.id, { proc });

  // Mark running
  db.prepare(`
    UPDATE download_jobs
    SET status = 'running', started_at = datetime('now'), pid = ?
    WHERE id = ?
  `).run(proc.pid, job.id);

  logEvent(db, {
    userId: job.user_id,
    action: 'JOB_STARTED',
    target: String(job.id),
    status: 'SUCCESS',
  });

  emitter.emit('job:started', {
    jobId:      job.id,
    pid:        proc.pid,
    started_at: new Date().toISOString(),
  });

  // ── stdout line parser ────────────────────────────────────────────────────
  let lineBuf = '';

  proc.stdout.on('data', (chunk) => {
    lineBuf += chunk.toString();
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop(); // keep incomplete tail

    for (const line of lines) {
      if (!line.startsWith('YTDLP_JSON ')) continue;

      try {
        const p = JSON.parse(sanitiseProgressLine(line.slice('YTDLP_JSON '.length)));
        const downloaded = p.pct   ?? null;
        const total      = p.total ?? p.est ?? null;
        const pct        = total > 0 ? (downloaded / total) * 100 : null;

        db.prepare(`
          UPDATE download_jobs
          SET progress_pct = ?, speed_bps = ?, eta_sec = ?,
              total_bytes = ?, downloaded_bytes = ?
          WHERE id = ?
        `).run(pct, p.spd ?? null, p.eta ?? null, total, downloaded, job.id);

        emitter.emit('progress', {
          jobId:  job.id,
          pct,
          total,
          speed:  p.spd   ?? null,
          eta:    p.eta   ?? null,
          frag_i: p.frag_i ?? null,
          frag_n: p.frag_n ?? null,
        });
      } catch { /* malformed line — ignore */ }
    }
  });

  // ── stderr: buffer for error reporting, also echo to server stderr ────────
  const stderrLines = [];
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[yt-dlp #${job.id}] ${text}`);
    stderrLines.push(text);
  });

  // Build a human-readable error message from buffered stderr.
  const buildErrorMsg = (code) => {
    const text  = stderrLines.join('').trim();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Prefer lines that yt-dlp explicitly marks as ERROR:
    const errLines = lines
      .filter((l) => l.startsWith('ERROR:'))
      .map((l) => l.replace(/^ERROR:\s*/, ''));

    if (errLines.length > 0) return errLines.join('\n').slice(0, 800);

    // Fall back to the last few non-empty lines of stderr
    if (lines.length > 0) return lines.slice(-3).join('\n').slice(0, 800);

    return `yt-dlp exited with code ${code}`;
  };

  // ── close handler ─────────────────────────────────────────────────────────
  proc.on('close', (code) => {
    active.delete(job.id);

    const row = db.prepare('SELECT status FROM download_jobs WHERE id = ?').get(job.id);
    if (!row) return;

    if (row.status === 'cancelled') {
      emitter.emit('job:cancelled', { jobId: job.id });
      tick();
      return;
    }

    if (code === 0) {
      db.prepare(`
        UPDATE download_jobs
        SET status = 'completed', completed_at = datetime('now'), pid = NULL
        WHERE id = ?
      `).run(job.id);

      logEvent(db, {
        userId: job.user_id,
        action: 'JOB_COMPLETED',
        target: String(job.id),
        status: 'SUCCESS',
      });

      emitter.emit('job:completed', {
        jobId:        job.id,
        completed_at: new Date().toISOString(),
      });
      emitter.emit('files:changed', { jobId: job.id });
    } else {
      const errorMsg = buildErrorMsg(code);

      db.prepare(`
        UPDATE download_jobs
        SET status = 'failed', error_msg = ?, pid = NULL
        WHERE id = ?
      `).run(errorMsg, job.id);

      logEvent(db, {
        userId: job.user_id,
        action: 'JOB_FAILED',
        target: String(job.id),
        status: 'FAILURE',
        detail: errorMsg,
      });

      emitter.emit('job:failed', { jobId: job.id, error_msg: errorMsg });
    }

    tick();
  });

  proc.on('error', (err) => {
    active.delete(job.id);
    const errorMsg = `Spawn error: ${err.message}`;

    db.prepare(`
      UPDATE download_jobs
      SET status = 'failed', error_msg = ?, pid = NULL
      WHERE id = ?
    `).run(errorMsg, job.id);

    logEvent(db, {
      userId: job.user_id,
      action: 'JOB_FAILED',
      target: String(job.id),
      status: 'FAILURE',
      detail: errorMsg,
    });

    emitter.emit('job:failed', { jobId: job.id, error_msg: errorMsg });
    tick();
  });
};

// ── Public interface ──────────────────────────────────────────────────────────

export const getEmitter = () => emitter;

/**
 * Promote pending jobs to running, up to max_concurrent_downloads.
 * Called after any job state change and on the periodic heartbeat.
 */
export const tick = () => {
  const settings = getSettings();
  const maxConcurrent = parseInt(settings.max_concurrent_downloads, 10) || 2;

  const { n: runningCount } = db.prepare(`
    SELECT COUNT(*) as n FROM download_jobs WHERE status IN ('running', 'paused')
  `).get();

  const slots = maxConcurrent - runningCount;
  if (slots <= 0) return;

  const pending = db.prepare(`
    SELECT * FROM download_jobs
    WHERE status = 'pending'
    ORDER BY priority ASC, id ASC
    LIMIT ?
  `).all(slots);

  for (const job of pending) {
    _spawn(job, settings);
  }
};

/** Cancel a running, paused, or pending job. */
export const cancel = (jobId) => {
  const entry = active.get(jobId);

  if (entry) {
    // Mark cancelled first so the close handler sees it
    db.prepare(`
      UPDATE download_jobs SET status = 'cancelled'
      WHERE id = ? AND status IN ('running', 'paused')
    `).run(jobId);
    treeKill(entry.proc.pid, 'SIGTERM');
    // job:cancelled is emitted by the close handler
  } else {
    // Pending job — no process to kill
    db.prepare(`
      UPDATE download_jobs SET status = 'cancelled'
      WHERE id = ? AND status = 'pending'
    `).run(jobId);
    emitter.emit('job:cancelled', { jobId });
  }
};

/** Suspend a running job with SIGSTOP. */
export const pause = (jobId) => {
  const entry = active.get(jobId);
  if (!entry) return;
  try {
    process.kill(entry.proc.pid, 'SIGSTOP');
    db.prepare(`UPDATE download_jobs SET status = 'paused' WHERE id = ?`).run(jobId);
  } catch (err) {
    console.error(`[QUEUE] pause(${jobId}) failed:`, err.message);
  }
};

/** Resume a paused job with SIGCONT. */
export const resume = (jobId) => {
  const entry = active.get(jobId);
  if (!entry) return;
  try {
    process.kill(entry.proc.pid, 'SIGCONT');
    db.prepare(`UPDATE download_jobs SET status = 'running' WHERE id = ?`).run(jobId);
    emitter.emit('job:started', {
      jobId,
      pid:        entry.proc.pid,
      started_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[QUEUE] resume(${jobId}) failed:`, err.message);
  }
};

/** Re-read max_concurrent_downloads from DB (called after settings change). */
export const reloadConfig = () => {
  // tick() already reads settings fresh each call — this is a no-op hook
  // kept for explicit caller intent and future caching if needed
  tick();
};

/**
 * Gracefully cancel all active processes.
 * Resolves when all have exited or after a 5-second safety timeout.
 */
export const shutdown = () =>
  new Promise((resolve) => {
    if (active.size === 0) return resolve();

    let remaining = active.size;
    const done = () => { if (--remaining <= 0) resolve(); };
    const timer = setTimeout(resolve, 5000);

    for (const [jobId, { proc }] of active) {
      db.prepare(`UPDATE download_jobs SET status = 'cancelled' WHERE id = ?`).run(jobId);
      treeKill(proc.pid, 'SIGTERM', () => { clearTimeout(timer); done(); });
    }
  });

/**
 * Start the queue. Call once from server.js after DB is ready.
 * Performs an immediate tick then rechecks every 10 seconds as a heartbeat.
 */
export const start = () => {
  tick();
  setInterval(tick, 10_000);
  console.log('[QUEUE] Download queue started');
};

export default { start, tick, cancel, pause, resume, reloadConfig, shutdown, getEmitter };
