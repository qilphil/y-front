import { existsSync } from 'node:fs';
import { Router } from 'express';
import { validationResult } from 'express-validator';
import { db } from '../db.js';
import config from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { logEvent } from '../middleware/logger.js';
import { validateSettings } from '../validators/jobValidators.js';
import downloadQueue from '../services/downloadQueue.js';

const router = Router();

const loadSettings = () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

// ── GET /settings ─────────────────────────────────────────────────────────────

router.get('/settings', requireAdmin, (req, res) => {
  res.render('settings', {
    title:          'Settings',
    settings:       loadSettings(),
    ytdlpPath:      config.YTDLP_PATH,
    credFileExists: existsSync(config.CREDENTIALS_FILE),
    credFilePath:   config.CREDENTIALS_FILE,
  });
});

// ── POST /settings ────────────────────────────────────────────────────────────

router.post('/settings', requireAdmin, validateSettings, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).render('settings', {
      title:          'Settings',
      settings:       { ...loadSettings(), ...req.body },
      ytdlpPath:      config.YTDLP_PATH,
      credFileExists: existsSync(config.CREDENTIALS_FILE),
      credFilePath:   config.CREDENTIALS_FILE,
      errors:         errors.array(),
    });
  }

  const { default_download_path, max_concurrent_downloads, default_format_spec } = req.body;
  const { user } = req.session;

  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  db.transaction(() => {
    update.run(default_download_path.trim(),        'default_download_path');
    update.run(String(max_concurrent_downloads),    'max_concurrent_downloads');
    update.run(default_format_spec.trim(),          'default_format_spec');
  })();

  downloadQueue.reloadConfig();

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'SETTINGS_UPDATED',
    target:   'global',
    status:   'SUCCESS',
    ip:       req.ip,
  });

  req.session.flash = { type: 'success', message: 'Settings saved.' };
  res.redirect('/settings');
});

export default router;
