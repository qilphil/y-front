import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import morgan from 'morgan';
import session from 'express-session';
import ConnectSqlite3 from 'connect-sqlite3';

import config from './config.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRouter      from './routes/auth.js';
import dashboardRouter from './routes/dashboard.js';
import queueRouter     from './routes/queue.js';
import addRouter       from './routes/add.js';
import accountRouter   from './routes/account.js';
import settingsRouter  from './routes/settings.js';
import usersRouter     from './routes/users.js';
import logsRouter      from './routes/logs.js';
import filesRouter     from './routes/files.js';
import apiJobsRouter       from './routes/api/jobs.js';
import apiAnalyseRouter    from './routes/api/analyse.js';
import apiPlaylistRouter   from './routes/api/playlist.js';
import apiFilesystemRouter from './routes/api/filesystem.js';
import apiFilesRouter      from './routes/api/files.js';
import apiEventsRouter     from './routes/api/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQLiteStore = ConnectSqlite3(session);

const app = express();

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'pug');
app.set('views', join(__dirname, 'views'));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use('/bootstrap', express.static(join(__dirname, '../node_modules/bootstrap/dist')));
app.use('/vendor',    express.static(join(__dirname, '../node_modules/sortablejs')));
app.use(express.static(join(__dirname, '../public')));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './db' }),
  secret:            config.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge:   config.SESSION_MAX_AGE_MS,
  },
}));

// ── Locals ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user = req.session?.user ?? null;
  next();
});

// ── Flash ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.flash = req.session.flash ?? null;
  delete req.session.flash;
  next();
});

// ── Health check (no auth) ────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(authRouter);
app.use(dashboardRouter);
app.use(queueRouter);
app.use(addRouter);
app.use(accountRouter);
app.use(settingsRouter);
app.use('/users', usersRouter);
app.use('/logs',  logsRouter);
app.use(filesRouter);
app.use('/api',   apiJobsRouter);
app.use('/api',   apiAnalyseRouter);
app.use('/api',   apiPlaylistRouter);
app.use('/api',   apiFilesystemRouter);
app.use('/api',   apiFilesRouter);
app.use('/api',   apiEventsRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

export default app;
