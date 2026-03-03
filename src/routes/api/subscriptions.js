import { Router } from 'express';
import { db } from '../../db.js';
import { requireLogin } from '../../middleware/auth.js';
import { fetchPlaylist } from '../../services/ytdlp.js';
import {
  checkSubscription,
  verifyEntries,
  queueEntries,
} from '../../services/subscriptionService.js';
import { getEmitter } from '../../services/downloadQueue.js';

const router = Router();

// ── URL normalisation ─────────────────────────────────────────────────────────

/**
 * Bare YouTube channel URLs (/@handle, /c/name, /channel/UCxxx) make yt-dlp
 * return the channel's *tab playlists* (Videos, Shorts, Live…) rather than
 * actual video entries.  Appending /videos selects the uploads tab directly.
 */
const normalizeYouTubeUrl = (rawUrl) => {
  let u;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  if (!u.hostname.includes('youtube.com')) return rawUrl;

  // Match bare channel paths with no sub-tab
  if (/^\/((@|c\/|channel\/)[^/]+)\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/?$/, '/videos');
    return u.toString();
  }
  return rawUrl;
};

// ── Ownership helper ──────────────────────────────────────────────────────────

const getSub = (subId, userId) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?').get(subId, userId);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    throw err;
  }
  return sub;
};

// ── GET /api/subscriptions ────────────────────────────────────────────────────

router.get('/subscriptions', requireLogin, (req, res) => {
  const { user } = req.session;

  const subs = db.prepare(`
    SELECT s.*,
      COUNT(se.id)                                              AS total_entries,
      SUM(CASE WHEN se.state = 'new'        THEN 1 ELSE 0 END) AS new_count
    FROM subscriptions s
    LEFT JOIN subscription_entries se ON se.subscription_id = s.id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.id DESC
  `).all(user.id);

  res.json(subs);
});

// ── POST /api/subscriptions ───────────────────────────────────────────────────

router.post('/subscriptions', requireLogin, async (req, res, next) => {
  const { user } = req.session;
  let { url, name, target_path, format_spec, auto_download, max_entries } = req.body;

  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'url must be a valid URL' }); }

  url = normalizeYouTubeUrl(url);

  try {
    // Fetch playlist to confirm URL is valid and get a name if not supplied
    const playlist = await fetchPlaylist(url, 1);
    if (!name || !name.trim()) name = playlist.title || url;

    // Detect type
    const type = url.includes('/channel/') || url.includes('/@') || url.includes('/c/')
      ? 'channel'
      : 'playlist';

    const result = db.prepare(`
      INSERT INTO subscriptions (user_id, url, name, type, target_path, format_spec, auto_download, max_entries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      url.trim(),
      name.trim(),
      type,
      target_path?.trim() || null,
      format_spec?.trim() || null,
      auto_download ? 1 : 0,
      parseInt(max_entries, 10) || 50,
    );

    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(result.lastInsertRowid);

    // Seed entries immediately
    const { added, total } = await checkSubscription(sub.id, getEmitter());
    res.status(201).json({ sub, added, total });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/subscriptions/:id ─────────────────────────────────────────────

router.patch('/subscriptions/:id', requireLogin, (req, res, next) => {
  const { user } = req.session;
  try {
    const sub = getSub(Number(req.params.id), user.id);
    const { name, target_path, format_spec, auto_download, max_entries } = req.body;

    db.prepare(`
      UPDATE subscriptions
      SET name = ?, target_path = ?, format_spec = ?, auto_download = ?, max_entries = ?
      WHERE id = ?
    `).run(
      name?.trim() ?? sub.name,
      target_path?.trim() ?? sub.target_path,
      format_spec?.trim() || null,
      auto_download != null ? (auto_download ? 1 : 0) : sub.auto_download,
      max_entries != null ? (parseInt(max_entries, 10) || 50) : sub.max_entries,
      sub.id,
    );

    const updated = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(sub.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/subscriptions/:id ────────────────────────────────────────────

router.delete('/subscriptions/:id', requireLogin, (req, res, next) => {
  const { user } = req.session;
  try {
    const sub = getSub(Number(req.params.id), user.id);
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/subscriptions/:id/check ────────────────────────────────────────

router.post('/subscriptions/:id/check', requireLogin, async (req, res, next) => {
  const { user } = req.session;
  try {
    getSub(Number(req.params.id), user.id); // ownership check
    const result = await checkSubscription(Number(req.params.id), getEmitter());
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/subscriptions/:id/queue ────────────────────────────────────────
// Body: { entry_ids: [1,2,3] } or { state: 'new' }

router.post('/subscriptions/:id/queue', requireLogin, async (req, res, next) => {
  const { user } = req.session;
  const subId = Number(req.params.id);
  try {
    getSub(subId, user.id); // ownership check

    let entryIds;
    if (Array.isArray(req.body.entry_ids)) {
      entryIds = req.body.entry_ids.map(Number).filter(Boolean);
    } else if (req.body.state) {
      const rows = db.prepare(
        `SELECT id FROM subscription_entries WHERE subscription_id = ? AND state = ?`
      ).all(subId, req.body.state);
      entryIds = rows.map((r) => r.id);
    } else {
      return res.status(400).json({ error: 'Provide entry_ids or state' });
    }

    if (entryIds.length === 0) return res.json({ queued: 0, jobs: [] });

    const jobs = await queueEntries(entryIds, user.id);
    res.json({ queued: jobs.length, jobs });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/subscriptions/:id/verify ───────────────────────────────────────

router.post('/subscriptions/:id/verify', requireLogin, async (req, res, next) => {
  const { user } = req.session;
  try {
    getSub(Number(req.params.id), user.id); // ownership check
    const result = await verifyEntries(Number(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/subscriptions/:id/entries/:eid ─────────────────────────────────

router.patch('/subscriptions/:id/entries/:eid', requireLogin, (req, res, next) => {
  const { user } = req.session;
  const subId  = Number(req.params.id);
  const entryId = Number(req.params.eid);
  const { state } = req.body;

  const allowedStates = ['skipped', 'new'];
  if (!allowedStates.includes(state))
    return res.status(400).json({ error: `state must be one of: ${allowedStates.join(', ')}` });

  try {
    getSub(subId, user.id); // ownership check

    const entry = db.prepare(
      'SELECT id FROM subscription_entries WHERE id = ? AND subscription_id = ?'
    ).get(entryId, subId);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    db.prepare(`
      UPDATE subscription_entries
      SET state = ?, state_changed = datetime('now')
      WHERE id = ?
    `).run(state, entryId);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
