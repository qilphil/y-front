import { body } from 'express-validator';

export const validateLogin = [
  body('username').trim().notEmpty().isLength({ max: 64 }),
  body('password').notEmpty().isLength({ max: 128 }),
];

export const validateCreateUser = [
  body('username').trim().notEmpty().isAlphanumeric().isLength({ min: 3, max: 64 }),
  body('password').notEmpty().isLength({ min: 8, max: 128 }),
  body('role').isIn(['user', 'admin']),
];

export const validateChangePassword = [
  body('current_password').notEmpty().isLength({ max: 128 }),
  body('new_password').notEmpty().isLength({ min: 8, max: 128 }),
];

export const validatePreferences = [
  body('preferences')
    .notEmpty()
    .isLength({ max: 8192 })
    .custom((value) => {
      let parsed;
      try { parsed = JSON.parse(value); } catch { throw new Error('Preferences must be valid JSON.'); }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Preferences must be a JSON object.');
      }
      return true;
    }),
];
