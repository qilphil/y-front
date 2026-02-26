import { Router } from 'express';
import { db } from '../db.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireLogin, (req, res) => {
  res.redirect('/dashboard');
});

router.get('/queue', requireLogin, (req, res) => {
  const { user } = req.session;
  const conditions = [];
  const params = [];

  if (user.role !== 'admin') {
    conditions.push('dj.user_id = ?');
    params.push(user.id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const jobs = db.prepare(`
    SELECT dj.*, u.username AS owner_username
    FROM download_jobs dj
    JOIN users u ON u.id = dj.user_id
    ${where}
    ORDER BY
      CASE dj.status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
      dj.priority ASC, dj.id ASC
  `).all(...params);

  res.render('queue/index', { title: 'Download Queue', jobs });
});

export default router;
