import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import { db } from '../db.js';

const router = Router();

router.get('/dashboard', requireLogin, (req, res) => {
  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])
  );
  res.render('dashboard', { title: 'Dashboard', settings });
});

export default router;
