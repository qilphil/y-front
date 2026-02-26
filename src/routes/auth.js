import { Router } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { validationResult } from 'express-validator';
import { db } from '../db.js';
import { logEvent } from '../middleware/logger.js';
import { validateLogin } from '../validators/userValidators.js';
import config from '../config.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: config.LOGIN_RATE_LIMIT.windowMs,
  max:      config.LOGIN_RATE_LIMIT.max,
  message:  'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders:   false,
});

router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/queue');
  res.render('login', { title: 'Login' });
});

router.post('/login', loginLimiter, validateLogin, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('login', { title: 'Login', errors: errors.array() });
  }

  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    logEvent(db, {
      userId:   user?.id ?? null,
      username,
      action:   'LOGIN',
      target:   username,
      status:   'FAILURE',
      detail:   'Invalid credentials',
      ip:       req.ip,
    });
    return res.render('login', { title: 'Login', errors: [{ msg: 'Invalid username or password.' }] });
  }

  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'LOGIN',
    status:   'SUCCESS',
    ip:       req.ip,
  });

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      res.redirect('/queue');
    });
  });
});

router.post('/logout', (req, res, next) => {
  const { user } = req.session;
  logEvent(db, {
    userId:   user?.id       ?? null,
    username: user?.username ?? null,
    action:   'LOGOUT',
    status:   'SUCCESS',
    ip:       req.ip,
  });
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

export default router;
