import { Router } from 'express';
import { db } from '../db.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

// ── GET /subscriptions ────────────────────────────────────────────────────────

router.get('/subscriptions', requireLogin, (req, res) => {
  const { user } = req.session;

  const subs = db.prepare(`
    SELECT s.*,
      COUNT(se.id)                                          AS total_entries,
      SUM(CASE WHEN se.state = 'new'        THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN se.state = 'queued'     THEN 1 ELSE 0 END) AS queued_count,
      SUM(CASE WHEN se.state = 'downloaded' THEN 1 ELSE 0 END) AS downloaded_count,
      SUM(CASE WHEN se.state = 'missing'    THEN 1 ELSE 0 END) AS missing_count,
      SUM(CASE WHEN se.state = 'failed'     THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN se.state = 'skipped'    THEN 1 ELSE 0 END) AS skipped_count
    FROM subscriptions s
    LEFT JOIN subscription_entries se ON se.subscription_id = s.id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.id DESC
  `).all(user.id);

  res.render('subscriptions/index', { title: 'Subscriptions', subs });
});

// ── GET /subscriptions/:id ────────────────────────────────────────────────────

router.get('/subscriptions/:id', requireLogin, (req, res, next) => {
  const { user } = req.session;
  const subId = Number(req.params.id);

  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?').get(subId, user.id);
  if (!sub) {
    const err = new Error('Subscription not found');
    err.status = 404;
    return next(err);
  }

  const stateFilter = req.query.state || null;
  const validStates = ['new', 'queued', 'downloaded', 'missing', 'failed', 'skipped'];

  const params = [subId];
  let where = 'WHERE se.subscription_id = ?';
  if (stateFilter && validStates.includes(stateFilter)) {
    where += ' AND se.state = ?';
    params.push(stateFilter);
  }

  const entries = db.prepare(`
    SELECT se.* FROM subscription_entries se
    ${where}
    ORDER BY se.id DESC
  `).all(...params);

  // Per-state counts for filter tabs
  const counts = db.prepare(`
    SELECT state, COUNT(*) AS n
    FROM subscription_entries
    WHERE subscription_id = ?
    GROUP BY state
  `).all(subId);
  const countMap = Object.fromEntries(counts.map((r) => [r.state, r.n]));

  res.render('subscriptions/detail', {
    title: sub.name,
    sub,
    entries,
    stateFilter,
    counts: countMap,
  });
});

export default router;
