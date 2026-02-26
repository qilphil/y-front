export default Object.freeze({
  PORT:               Number(process.env.PORT) || 3420,
  DB_PATH:            process.env.DB_PATH         || './db/y-front.db',
  SESSION_SECRET:     process.env.SESSION_SECRET  || 'change-me-in-production',
  SESSION_MAX_AGE_MS: 8 * 60 * 60 * 1000,
  CREDENTIALS_FILE:   './admin-credentials.env',
  YTDLP_PATH:         process.env.YTDLP_PATH      || 'yt-dlp',
  LOGIN_RATE_LIMIT: {
    windowMs: 15 * 60 * 1000,
    max: 20,
  },
  USER_CREATE_RATE_LIMIT: {
    windowMs: 60 * 60 * 1000,
    max: 30,
  },
  ANALYSE_RATE_LIMIT: {
    windowMs: 60 * 1000,
    max: 10,
  },
});
