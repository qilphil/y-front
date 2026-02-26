import { Router } from 'express';
import { db } from '../db.js';
import { logEvent } from '../middleware/logger.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
const PAGE_SIZE = 50;

router.get('/', requireAdmin, (req, res) => {
  const { username, action, status, from, to, page = '1' } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const conditions = [];
  const params = [];

  if (username) { conditions.push('username LIKE ?'); params.push(`%${username}%`); }
  if (action)   { conditions.push('action = ?');      params.push(action); }
  if (status)   { conditions.push('status = ?');      params.push(status); }
  if (from)     { conditions.push('timestamp >= ?');  params.push(from); }
  if (to)       { conditions.push('timestamp <= ?');  params.push(to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(
    `SELECT COUNT(*) as n FROM event_log ${where}`
  ).get(...params).n;

  const logs = db.prepare(
    `SELECT * FROM event_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params, PAGE_SIZE, offset);

  logEvent(db, {
    userId:   req.session.user.id,
    username: req.session.user.username,
    action:   'LOG_VIEWED',
    status:   'SUCCESS',
    ip:       req.ip,
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const buildPageUrl = (p) => {
    const q = new URLSearchParams({ ...req.query, page: p });
    return `/logs?${q}`;
  };

  res.render('logs/index', {
    title: 'Event Log',
    logs,
    total,
    pageNum,
    pageSize: PAGE_SIZE,
    totalPages,
    query: req.query,
    prevUrl: pageNum > 1           ? buildPageUrl(pageNum - 1) : null,
    nextUrl: pageNum < totalPages  ? buildPageUrl(pageNum + 1) : null,
  });
});

export default router;
