import { body, query } from 'express-validator';

export const validateJobSubmit = [
  body('url').trim().notEmpty().isURL({ require_protocol: true }).isLength({ max: 2048 }),
  body('format_spec').optional({ nullable: true }).trim().isLength({ max: 256 }),
  body('output_dir').optional({ nullable: true }).trim().isLength({ max: 1024 }),
  body('subfolder').optional({ nullable: true }).trim().isLength({ max: 256 }),
];

export const validateSettings = [
  body('default_download_path').trim().notEmpty().isLength({ max: 1024 }),
  body('max_concurrent_downloads').isInt({ min: 1, max: 8 }),
  body('default_format_spec').trim().notEmpty().isLength({ max: 256 }),
];

export const validateAnalyseQuery = [
  query('url').trim().notEmpty().isURL({ require_protocol: true }).isLength({ max: 2048 }),
];
