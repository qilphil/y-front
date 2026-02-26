import { Router } from 'express';
import bcrypt from 'bcrypt';
import { validationResult } from 'express-validator';
import { db } from '../db.js';
import { logEvent } from '../middleware/logger.js';
import { requireLogin } from '../middleware/auth.js';
import { validateChangePassword, validatePreferences } from '../validators/userValidators.js';

const router = Router();

router.get('/account', requireLogin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const preferences = JSON.parse(user.preferences || '{}');
  res.render('account', { title: 'Account', preferences });
});

router.post('/account', requireLogin, validateChangePassword, async (req, res) => {
  const errors = validationResult(req);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const preferences = JSON.parse(user.preferences || '{}');

  if (!errors.isEmpty()) {
    return res.render('account', { title: 'Account', preferences, passwordErrors: errors.array() });
  }

  const { current_password, new_password } = req.body;
  if (!(await bcrypt.compare(current_password, user.password))) {
    return res.render('account', {
      title: 'Account',
      preferences,
      passwordErrors: [{ msg: 'Current password is incorrect.' }],
    });
  }

  const newHash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'PASSWORD_CHANGED',
    status:   'SUCCESS',
    ip:       req.ip,
  });

  req.session.flash = { type: 'success', message: 'Password changed successfully.' };
  res.redirect('/account');
});

router.post('/account/preferences', requireLogin, validatePreferences, (req, res) => {
  const errors = validationResult(req);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const preferences = JSON.parse(user.preferences || '{}');

  if (!errors.isEmpty()) {
    return res.render('account', { title: 'Account', preferences, prefErrors: errors.array() });
  }

  const newPreferences = JSON.parse(req.body.preferences);
  db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(JSON.stringify(newPreferences), user.id);

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'PREFERENCES_UPDATED',
    status:   'SUCCESS',
    ip:       req.ip,
  });

  req.session.flash = { type: 'success', message: 'Preferences saved.' };
  res.redirect('/account');
});

export default router;
