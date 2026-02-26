import { Router } from 'express';
import bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { logEvent } from '../middleware/logger.js';
import { requireAdmin } from '../middleware/auth.js';
import { validateCreateUser } from '../validators/userValidators.js';
import config from '../config.js';

const router = Router();

const userCreateLimiter = rateLimit({
  windowMs: config.USER_CREATE_RATE_LIMIT.windowMs,
  max:      config.USER_CREATE_RATE_LIMIT.max,
  message:  'Too many accounts created. Please try again later.',
  standardHeaders: true,
  legacyHeaders:   false,
});

router.use(requireAdmin);

// DELETE credentials file — must be before /:id routes
router.post('/credentials/delete', async (req, res) => {
  const credPath = resolve(config.CREDENTIALS_FILE);
  if (!existsSync(credPath)) {
    req.session.flash = { type: 'info', message: 'Credentials file not found.' };
    return res.redirect('/users');
  }
  await unlink(credPath);
  logEvent(db, {
    userId:   req.session.user.id,
    username: req.session.user.username,
    action:   'CREDENTIALS_FILE_DELETED',
    status:   'SUCCESS',
    ip:       req.ip,
  });
  req.session.flash = { type: 'success', message: 'admin-credentials.env deleted.' };
  res.redirect('/users');
});

router.get('/', (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role, created_at, last_login FROM users ORDER BY id'
  ).all();
  const credentialsFileExists = existsSync(resolve(config.CREDENTIALS_FILE));
  res.render('users/index', { title: 'Users', users, credentialsFileExists });
});

router.get('/new', userCreateLimiter, (req, res) => {
  res.render('users/form', { title: 'New User', editUser: null });
});

router.post('/', userCreateLimiter, validateCreateUser, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('users/form', { title: 'New User', editUser: null, errors: errors.array() });
  }

  const { username, password, role } = req.body;
  const hash = await bcrypt.hash(password, 12);

  try {
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);
    logEvent(db, {
      userId:   req.session.user.id,
      username: req.session.user.username,
      action:   'USER_CREATED',
      target:   username,
      status:   'SUCCESS',
      ip:       req.ip,
    });
    req.session.flash = { type: 'success', message: `User "${username}" created.` };
    res.redirect('/users');
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.render('users/form', {
        title: 'New User',
        editUser: null,
        errors: [{ msg: 'Username already exists.' }],
      });
    }
    throw err;
  }
});

router.get('/:id/edit', (req, res) => {
  const editUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  res.render('users/form', { title: 'Edit User', editUser });
});

router.post('/:id', async (req, res) => {
  const editUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const { role, password } = req.body;

  if (role && role !== editUser.role && editUser.role === 'admin') {
    const adminCount = db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'admin'`).get().n;
    if (adminCount <= 1) {
      req.session.flash = { type: 'error', message: 'Cannot demote the last admin.' };
      return res.redirect('/users');
    }
  }

  if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, editUser.id);
  }
  if (password && password.length >= 8) {
    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, editUser.id);
  }

  logEvent(db, {
    userId:   req.session.user.id,
    username: req.session.user.username,
    action:   'USER_UPDATED',
    target:   editUser.username,
    status:   'SUCCESS',
    ip:       req.ip,
  });

  req.session.flash = { type: 'success', message: `User "${editUser.username}" updated.` };
  res.redirect('/users');
});

router.post('/:id/delete', (req, res) => {
  const editUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  if (!editUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (editUser.id === req.session.user.id) {
    req.session.flash = { type: 'error', message: 'Cannot delete your own account.' };
    return res.redirect('/users');
  }

  if (editUser.role === 'admin') {
    const adminCount = db.prepare(`SELECT COUNT(*) as n FROM users WHERE role = 'admin'`).get().n;
    if (adminCount <= 1) {
      req.session.flash = { type: 'error', message: 'Cannot delete the last admin account.' };
      return res.redirect('/users');
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(editUser.id);
  logEvent(db, {
    userId:   req.session.user.id,
    username: req.session.user.username,
    action:   'USER_DELETED',
    target:   editUser.username,
    status:   'SUCCESS',
    ip:       req.ip,
  });

  req.session.flash = { type: 'success', message: `User "${editUser.username}" deleted.` };
  res.redirect('/users');
});

export default router;
