import { db } from '../db.js';
import { logEvent } from './logger.js';

export const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[ERROR] ${req.method} ${req.url} — ${status}: ${message}`);
  if (status >= 500) console.error(err.stack);

  if (status >= 500) {
    logEvent(db, {
      userId:   req.session?.user?.id       ?? null,
      username: req.session?.user?.username ?? null,
      action:   'SERVER_ERROR',
      target:   `${req.method} ${req.url}`,
      status:   'FAILURE',
      detail:   message,
      ip:       req.ip,
    });
  }

  if (req.headers.accept?.includes('application/json')) {
    return res.status(status).json({ error: message });
  }
  res.status(status).render('error', { status, message });
};
