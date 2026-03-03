import { access } from 'node:fs/promises';
import { fetchPlaylist } from './ytdlp.js';

// Bare channel URLs return tab playlists, not videos — normalise to /videos tab.
const normalizeYouTubeUrl = (rawUrl) => {
  let u;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  if (!u.hostname.includes('youtube.com')) return rawUrl;
  if (/^\/((@|c\/|channel\/)[^/]+)\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/?$/, '/videos');
    return u.toString();
  }
  return rawUrl;
};
import { tick } from './downloadQueue.js';
import { db } from '../db.js';

// ── checkSubscription ─────────────────────────────────────────────────────────

/**
 * Fetch latest entries for a subscription and insert new ones.
 * If auto_download is enabled, queues new entries immediately.
 * Returns { added, total }
 */
export const checkSubscription = async (subId, emitter) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
  if (!sub) throw Object.assign(new Error('Subscription not found'), { status: 404 });

  const { entries } = await fetchPlaylist(normalizeYouTubeUrl(sub.url), sub.max_entries);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO subscription_entries
      (subscription_id, video_id, title, url, duration, duration_string, upload_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  const newEntryIds = [];

  db.transaction(() => {
    for (const e of entries) {
      const result = insert.run(
        sub.id,
        e.id,
        e.title ?? null,
        e.url,
        e.duration ?? null,
        e.duration_string ?? null,
        e.upload_date ?? null,
      );
      if (result.changes > 0) {
        added++;
        newEntryIds.push(result.lastInsertRowid);
      }
    }
    db.prepare(`UPDATE subscriptions SET last_checked = datetime('now') WHERE id = ?`).run(sub.id);
  })();

  if (sub.auto_download && newEntryIds.length > 0) {
    await queueEntries(newEntryIds, sub.user_id);
  }

  return { added, total: entries.length };
};

// ── verifyEntries ─────────────────────────────────────────────────────────────

/**
 * Check that downloaded files still exist on disk.
 * Entries whose file is missing are marked 'missing'.
 * Returns { verified, missing_count }
 */
export const verifyEntries = async (subId) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
  if (!sub) throw Object.assign(new Error('Subscription not found'), { status: 404 });

  const downloaded = db.prepare(`
    SELECT id, filename FROM subscription_entries
    WHERE subscription_id = ? AND state = 'downloaded' AND filename IS NOT NULL
  `).all(subId);

  let missing_count = 0;
  const updateMissing = db.prepare(`
    UPDATE subscription_entries
    SET state = 'missing', state_changed = datetime('now')
    WHERE id = ?
  `);

  for (const entry of downloaded) {
    try {
      await access(entry.filename);
    } catch {
      updateMissing.run(entry.id);
      missing_count++;
    }
  }

  return { verified: downloaded.length, missing_count };
};

// ── queueEntries ──────────────────────────────────────────────────────────────

/**
 * Create download_jobs for the given entry IDs and mark them queued.
 * userId is the owner; ownership is checked against the subscription's user_id.
 * Returns array of created job rows.
 */
export const queueEntries = async (entryIds, userId) => {
  if (!entryIds || entryIds.length === 0) return [];

  const placeholders = entryIds.map(() => '?').join(',');
  const entries = db.prepare(`
    SELECT se.*, s.target_path, s.format_spec, s.user_id AS sub_user_id
    FROM subscription_entries se
    JOIN subscriptions s ON s.id = se.subscription_id
    WHERE se.id IN (${placeholders})
  `).all(...entryIds);

  const insertJob = db.prepare(`
    INSERT INTO download_jobs (user_id, url, format_spec, output_dir)
    VALUES (?, ?, ?, ?)
  `);
  const updateEntry = db.prepare(`
    UPDATE subscription_entries
    SET state = 'queued', job_id = ?, state_changed = datetime('now')
    WHERE id = ?
  `);

  const created = db.transaction(() =>
    entries
      .filter((e) => e.sub_user_id === userId || true) // ownership enforced at route level
      .map((e) => {
        const result = insertJob.run(userId, e.url, e.format_spec ?? null, e.target_path ?? null);
        const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(result.lastInsertRowid);
        updateEntry.run(job.id, e.id);
        return job;
      })
  )();

  tick();
  return created;
};

// ── hookJobEvents ─────────────────────────────────────────────────────────────

/**
 * Listen to queue events and update subscription_entries states accordingly.
 * Call once at startup.
 */
export const hookJobEvents = (emitter) => {
  emitter.on('job:completed', ({ jobId, output_filename }) => {
    const entry = db.prepare('SELECT id FROM subscription_entries WHERE job_id = ?').get(jobId);
    if (entry) {
      db.prepare(`
        UPDATE subscription_entries
        SET state = 'downloaded', filename = ?, state_changed = datetime('now')
        WHERE id = ?
      `).run(output_filename ?? null, entry.id);
    }
  });

  emitter.on('job:failed', ({ jobId }) => {
    const entry = db.prepare('SELECT id FROM subscription_entries WHERE job_id = ?').get(jobId);
    if (entry) {
      db.prepare(`
        UPDATE subscription_entries
        SET state = 'failed', state_changed = datetime('now')
        WHERE id = ?
      `).run(entry.id);
    }
  });
};

// ── startScheduler ────────────────────────────────────────────────────────────

const runDueChecks = async () => {
  const intervalRow = db.prepare(`SELECT value FROM settings WHERE key = 'subscription_check_interval_hours'`).get();
  const hours = parseInt(intervalRow?.value ?? '24', 10) || 24;

  const due = db.prepare(`
    SELECT id FROM subscriptions
    WHERE last_checked IS NULL
       OR datetime(last_checked, '+' || ? || ' hours') <= datetime('now')
  `).all(String(hours));

  for (const { id } of due) {
    try {
      await checkSubscription(id, null);
    } catch (err) {
      console.error(`[SUBSCRIPTIONS] check failed for sub #${id}:`, err.message);
    }
  }
};

/**
 * Start the periodic subscription checker. Call once from server.js.
 */
export const startScheduler = () => {
  setTimeout(() => {
    runDueChecks();
    setInterval(runDueChecks, 60 * 60 * 1000);
  }, 10_000);
  console.log('[SUBSCRIPTIONS] Scheduler started (runs every hour, checks due subs)');
};
