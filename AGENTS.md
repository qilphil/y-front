# Project Specification for AI Agents — y-front

> **y-front** is a multi-user web frontend for [yt-dlp](https://github.com/yt-dlp/yt-dlp) as a remote download engine.
> Users can queue URLs for download, monitor progress in real time via SSE, manage a download queue with drag-and-drop reordering, and configure global settings through an admin UI.

---

## Technology Stack

| Concern           | Choice                                       |
|-------------------|----------------------------------------------|
| Runtime           | Node.js (>=18)                               |
| Framework         | Express.js 5                                 |
| Template engine   | Pug                                          |
| CSS framework     | Bootstrap 5 (served as static files, no CDN) |
| Package manager   | Yarn (do **not** use npm)                    |
| Database          | SQLite via `better-sqlite3`                  |
| Session store     | SQLite-backed `express-session`              |
| Password hashing  | `bcrypt`                                     |
| Input validation  | `express-validator`                          |
| Rate limiting     | `express-rate-limit`                         |
| Request logging   | `morgan`                                     |
| Environment vars  | `dotenv`                                     |
| Process killing   | `tree-kill` (kills yt-dlp + ffmpeg subtrees) |
| Drag-and-drop     | SortableJS (served as static file, no CDN)   |

> **Bootstrap static path**: Bootstrap is installed as a yarn dependency (`bootstrap@5`). Its compiled CSS and JS files are served from `node_modules/bootstrap/dist/` via Express static middleware. Do **not** use a CDN. Updates are performed by bumping the version in `package.json` and running `yarn install`.
>
> In ES module context, use `import.meta.url` and `fileURLToPath` to resolve `__dirname`:
> ```js
> import { fileURLToPath } from 'url';
> import { dirname, join } from 'path';
> const __dirname = dirname(fileURLToPath(import.meta.url));
> app.use('/bootstrap', express.static(join(__dirname, '../node_modules/bootstrap/dist')));
> ```
> Reference in Pug templates as `/bootstrap/css/bootstrap.min.css` and `/bootstrap/js/bootstrap.bundle.min.js`.

> **SortableJS static path**: SortableJS is installed as a yarn dependency (`sortablejs`). Serve its UMD build from `node_modules/sortablejs/Sortable.min.js` via Express static middleware. Reference in Pug templates as `/vendor/Sortable.min.js`.

---

## JavaScript Best Practices

- Use **ES modules** (`import`/`export`) throughout — `package.json` must include `"type": "module"`
- All file imports must use the `.js` extension explicitly (ESM requirement)
- Use ES6 or later syntax and features for concise and expressive code
- Use `async`/`await` for asynchronous operations
- Use `try`/`catch` blocks for error handling
- Use destructuring and spread syntax for cleaner code
- Use arrow functions for concise syntax
- Use template literals for string interpolation
- Use default parameters for optional arguments
- Use `const` and `let` for variable declaration — never `var`
- Use `Object.freeze()` to prevent object mutation on config/constant objects
- For external API calls, use `fetch`
- Do **not** use `__dirname` or `__filename` directly — derive them via:
  ```js
  import { fileURLToPath } from 'url';
  import { dirname } from 'path';
  const __dirname = dirname(fileURLToPath(import.meta.url));
  ```

---

## Project Layout

```
y-front/
├── AGENTS.md                  ← this file
├── TODO.md                    ← phased implementation checklist
├── package.json               ← must include "type": "module"
├── yarn.lock
├── .env                       ← environment variables
├── .env.example               ← committed template with safe placeholder values
├── .gitignore
├── ecosystem.config.cjs       ← PM2 process configuration
├── admin-credentials.env      ← generated once at init, deleted by admin after first login
├── db/
│   └── y-front.db             ← SQLite database file (created at runtime)
├── src/
│   ├── app.js                 ← Express app configuration (middleware, routes) — does NOT call listen()
│   ├── server.js              ← HTTP server entry point — imports app, calls listen(), handles shutdown
│   ├── config.js              ← centralised configuration constants
│   ├── db.js                  ← database initialisation and schema migrations
│   ├── middleware/
│   │   ├── auth.js            ← requireLogin, requireAdmin middleware
│   │   ├── errorHandler.js    ← centralised Express error handler (must be last middleware in app.js)
│   │   └── logger.js          ← event-logging helper (logEvent function)
│   ├── routes/
│   │   ├── auth.js            ← GET/POST /login, POST /logout
│   │   ├── queue.js           ← GET / (redirect), GET /queue
│   │   ├── add.js             ← GET /add
│   │   ├── account.js         ← GET/POST /account (authenticated user self-service)
│   │   ├── settings.js        ← GET/POST /settings (admin only)
│   │   ├── users.js           ← Admin: user CRUD
│   │   ├── logs.js            ← Admin: event log viewer
│   │   └── api/
│   │       ├── jobs.js        ← Job CRUD, reorder, clear-completed
│   │       ├── analyse.js     ← URL metadata + format analysis
│   │       ├── playlist.js    ← Playlist entry fetching
│   │       ├── filesystem.js  ← Server filesystem browser (admin)
│   │       └── events.js      ← SSE stream
│   ├── services/
│   │   ├── ytdlp.js           ← yt-dlp process helpers (analyseUrl, fetchPlaylist, buildArgs)
│   │   └── downloadQueue.js   ← Singleton download queue manager (spawn, kill, pause, resume)
│   ├── validators/
│   │   ├── userValidators.js  ← Reusable express-validator chains (login, createUser, changePassword)
│   │   └── jobValidators.js   ← Validators for job submission and settings
│   └── views/
│       ├── layout.pug
│       ├── error.pug          ← rendered by error handler for 4xx/5xx responses
│       ├── login.pug
│       ├── account.pug        ← change-password form for authenticated users
│       ├── queue/
│       │   └── index.pug      ← download queue table with status tabs and progress bars
│       ├── add.pug            ← add job form (URL input, format picker panel, playlist panel)
│       ├── settings.pug       ← admin settings page with filesystem browser
│       ├── users/
│       │   ├── index.pug
│       │   └── form.pug
│       └── logs/
│           └── index.pug
├── public/
│   ├── favicon.svg            ← yt-dlp themed SVG icon
│   ├── css/
│   │   └── site.css           ← Custom CSS overrides (minimal)
│   ├── js/
│   │   ├── main.js            ← Shared frontend utilities
│   │   ├── queue.js           ← SSE connection, queue table updates, SortableJS init, filter tabs
│   │   ├── add-job.js         ← URL form, format analysis, playlist selector, regex filtering
│   │   └── settings.js        ← Path browser modal, settings form
│   └── images/
│       └── logo.svg           ← yt-dlp themed logo
└── test/
    └── basic.test.js          ← node:test baseline tests (app startup, key routes)
```

### `app.js` vs `server.js` split

`src/app.js` configures and exports the Express app but does **not** call `listen()`. All middleware registration, route mounting, and error handler registration happens here. It exports the configured `app` instance.

`src/server.js` is the process entry point. It imports `app`, `db`, and `downloadQueue`, calls `app.listen()`, starts the download queue, stores the returned `server` handle, and registers graceful shutdown signal handlers.

```js
// src/app.js
import express from 'express';
// ... all middleware and route imports
const app = express();
// ... configure middleware, mount routes, register error handler
export default app;

// src/server.js
import 'dotenv/config';
import app from './app.js';
import { db } from './db.js';
import downloadQueue from './services/downloadQueue.js';
import config from './config.js';

const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Listening on port ${config.PORT}`);
});

downloadQueue.start();

const shutdown = (signal) => { ... }; // see Graceful Shutdown section
```

---

## Server Binding

- **Port**: `3420` — set via `process.env.PORT`
- **Bind address**: `0.0.0.0` (all interfaces)
- LAN restriction is expected to be enforced at the network/firewall level. The app itself does **not** implement IP allow-listing.
- No TLS/HTTPS at the application level (handle upstream if needed).

---

## Environment Variables (`.env`)

Load `.env` at the very top of `src/server.js` before any other imports that depend on configuration:

```js
import 'dotenv/config';
```

The `.env` file is **not** ignored by `.gitignore` by default. Exclude it manually per-project if it contains secrets. Always commit `.env.example` with all variable names and safe placeholder values:

```
# .env.example
PORT=3420
DB_PATH=./db/y-front.db
SESSION_SECRET=change-me-in-production
NODE_ENV=development
YTDLP_PATH=
```

---

## Configuration (`src/config.js`)

All environment-tuneable constants must be centralised here with sensible defaults. No configuration is hardcoded outside this file.

```js
export default Object.freeze({
  PORT:               process.env.PORT            || 3420,
  DB_PATH:            process.env.DB_PATH         || './db/y-front.db',
  SESSION_SECRET:     process.env.SESSION_SECRET  || 'change-me-in-production',
  SESSION_MAX_AGE_MS: 8 * 60 * 60 * 1000,        // 8 hours
  CREDENTIALS_FILE:   './admin-credentials.env',
  YTDLP_PATH:         process.env.YTDLP_PATH      || 'yt-dlp',
  LOGIN_RATE_LIMIT: {
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 20,
  },
  USER_CREATE_RATE_LIMIT: {
    windowMs: 60 * 60 * 1000,  // 1 hour
    max: 30,
  },
  ANALYSE_RATE_LIMIT: {
    windowMs: 60 * 1000,       // 1 minute
    max: 10,
  },
});
```

---

## Database Schema (`src/db.js`)

The database is initialised on startup. All tables use `CREATE TABLE IF NOT EXISTS`.

### `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE,
  password    TEXT    NOT NULL,                        -- bcrypt hash
  role        TEXT    NOT NULL DEFAULT 'user',         -- 'user' | 'admin'
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT,
  preferences TEXT    NOT NULL DEFAULT '{}'            -- JSON-encoded user preferences object
);
```

### `sessions`

Managed automatically by `connect-sqlite3` (or equivalent). Do not define manually.

### `event_log`

```sql
CREATE TABLE IF NOT EXISTS event_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id     INTEGER,                   -- NULL for unauthenticated actions
  username    TEXT,                      -- denormalised snapshot at time of event
  action      TEXT    NOT NULL,          -- e.g. 'LOGIN', 'JOB_QUEUED'
  target      TEXT,                      -- optional subject (e.g. job ID, affected username)
  status      TEXT    NOT NULL,          -- 'SUCCESS' | 'FAILURE'
  detail      TEXT,                      -- optional freeform detail / error message
  ip          TEXT                       -- client IP address
);
```

### `download_jobs`

```sql
CREATE TABLE IF NOT EXISTS download_jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  url              TEXT    NOT NULL,
  title            TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending',  -- pending|running|paused|completed|failed|cancelled
  priority         INTEGER NOT NULL DEFAULT 0,          -- lower = higher priority; used for ordering
  format_spec      TEXT,                                -- yt-dlp -f argument; NULL = use global default
  output_dir       TEXT,                                -- absolute path; NULL = use global default
  subfolder        TEXT,                                -- appended to output_dir
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  started_at       TEXT,
  completed_at     TEXT,
  error_msg        TEXT,
  pid              INTEGER,                             -- OS PID of running yt-dlp process
  progress_pct     REAL,
  speed_bps        REAL,
  eta_sec          INTEGER,
  total_bytes      INTEGER,
  downloaded_bytes INTEGER,
  output_filename  TEXT
);
```

### `settings`

```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Default settings rows (inserted via `INSERT OR IGNORE` on init):

| key | default value |
|-----|---------------|
| `default_download_path` | `/tmp/ytdlp-downloads` |
| `max_concurrent_downloads` | `2` |
| `default_format_spec` | `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best` |

---

## Initialisation Sequence (`src/db.js` — called at startup)

1. Create `db/` directory if it does not exist.
2. Open (or create) the SQLite file at the configured path.
3. Run all `CREATE TABLE IF NOT EXISTS` statements.
4. Insert default settings rows via `INSERT OR IGNORE INTO settings (key, value) VALUES (...)`.
5. Check whether any user with `role = 'admin'` exists.
6. If **no admin exists**:
   - Generate a random 16-character alphanumeric password using `node:crypto`:
     ```js
     import { randomBytes } from 'node:crypto';
     const password = randomBytes(12).toString('base64url').slice(0, 16);
     ```
   - Hash it with bcrypt (rounds: 12).
   - Insert a user `{ username: 'admin', password: <hash>, role: 'admin' }`.
   - Write `admin-credentials.env` in the project root:
     ```
     ADMIN_USER=admin
     ADMIN_PASS=<plaintext password>
     ```
   - Log to stdout: `"[INIT] Admin user created. Credentials written to admin-credentials.env — delete this file after first login."`
7. If an admin already exists, skip step 6 and do **not** overwrite the file.

---

## Authentication & Sessions

- Use `express-session` with a SQLite-backed session store (`connect-sqlite3`).
- Sessions expire after 8 hours of inactivity (`rolling: true`).
- Passwords are verified with `bcrypt.compare`.
- On successful login: update `users.last_login`, write a `LOGIN / SUCCESS` event log entry, then call `req.session.regenerate()` before saving user info to the session.
- On failed login: write a `LOGIN / FAILURE` event log entry (with the attempted username in `target`).
- On logout: write a `LOGOUT / SUCCESS` event log entry, then call `req.session.destroy()`.

### Middleware (`src/middleware/auth.js`)

```js
// Redirect to /login if not authenticated
export const requireLogin = (req, res, next) => { ... };

// Respond 403 or redirect if authenticated user is not admin
export const requireAdmin = (req, res, next) => { ... };
```

### `res.locals.user` convention

Register the following middleware in `src/app.js` **after** session middleware and **before** routes. This makes the current user available in all Pug templates as `user` without passing it explicitly from every route handler:

```js
app.use((req, res, next) => {
  res.locals.user = req.session?.user ?? null;
  next();
});
```

Templates can then use `if user` / `if user.role === 'admin'` directly. Route handlers must not pass a redundant `user` variable to `res.render()`.

---

## Input Validation (`src/validators/`)

Use `express-validator` for all form input. Place reusable validation chains in `src/validators/userValidators.js`. Job and settings validators live in `src/validators/jobValidators.js`.

```js
// src/validators/userValidators.js
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
```

```js
// src/validators/jobValidators.js
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
```

**Checking results in a route handler**:
```js
import { validationResult } from 'express-validator';

const errors = validationResult(req);
if (!errors.isEmpty()) {
  return res.status(400).json({ errors: errors.array() });
}
```

- Always `trim()` text inputs before validation.
- Always enforce a reasonable `max` length on every field.
- Never log raw user input in error detail fields.

---

## Rate Limiting

Apply `express-rate-limit` to sensitive mutation endpoints. Configure limits in `src/config.js` and apply as route middleware.

```js
import rateLimit from 'express-rate-limit';
import config from '../config.js';

export const loginLimiter = rateLimit({
  windowMs: config.LOGIN_RATE_LIMIT.windowMs,
  max:      config.LOGIN_RATE_LIMIT.max,
  message:  'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders:   false,
});

export const userCreateLimiter = rateLimit({
  windowMs: config.USER_CREATE_RATE_LIMIT.windowMs,
  max:      config.USER_CREATE_RATE_LIMIT.max,
  message:  'Too many accounts created. Please try again later.',
  standardHeaders: true,
  legacyHeaders:   false,
});

export const analyseLimiter = rateLimit({
  windowMs: config.ANALYSE_RATE_LIMIT.windowMs,
  max:      config.ANALYSE_RATE_LIMIT.max,
  message:  'Too many analyse requests. Please slow down.',
  standardHeaders: true,
  legacyHeaders:   false,
});
```

Apply limiters:
- `POST /login` — `loginLimiter`
- `GET /users/new` and `POST /users` — `userCreateLimiter`
- `GET /api/analyse` and `GET /api/playlist` — `analyseLimiter`

---

## Event Logging

Every significant application action must be written to `event_log`. Use a helper function (not middleware), exported from `src/middleware/logger.js`:

```js
export const logEvent = (db, { userId, username, action, target, status, detail, ip }) => { ... };
```

### Required actions

| Action constant            | When                                        |
|----------------------------|---------------------------------------------|
| `LOGIN`                    | Every login attempt (success or failure)    |
| `LOGOUT`                   | User logs out                               |
| `USER_CREATED`             | Admin creates a new user                    |
| `USER_UPDATED`             | Admin edits a user (role change, password)  |
| `USER_DELETED`             | Admin deletes a user                        |
| `PASSWORD_CHANGED`         | User changes their own password             |
| `PREFERENCES_UPDATED`      | User saves their preferences                |
| `LOG_VIEWED`               | Admin opens the event log page              |
| `CREDENTIALS_FILE_DELETED` | Admin triggers deletion of credentials file |
| `JOB_QUEUED`               | User adds download job(s)                   |
| `JOB_STARTED`              | Download begins                             |
| `JOB_COMPLETED`            | Download finishes successfully              |
| `JOB_FAILED`               | yt-dlp exits with error                     |
| `JOB_CANCELLED`            | User cancels a job                          |
| `JOB_DELETED`              | User deletes a job record                   |
| `SETTINGS_UPDATED`         | Admin saves settings                        |
| `SERVER_ERROR`             | Unhandled 5xx error                         |

---

## Request Logging (Morgan)

Mount Morgan as the first middleware in `src/app.js`:

```js
import morgan from 'morgan';
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
```

- `'combined'` — Apache-style, full detail, suitable for log aggregation. Used when `NODE_ENV=production`.
- `'dev'` — concise, coloured, suitable for development. Used otherwise.

---

## Error Handling

### Express 5 async error handling

Express 5 natively catches errors thrown from async route handlers and passes them to the error handler. Do **not** use a wrapper utility or `try`/`catch` in route handlers solely for the purpose of calling `next(err)` — throw or re-throw directly and Express 5 will forward to the error handler automatically.

Use `try`/`catch` only when you need to act on specific error cases (e.g. distinguish a bcrypt failure from a DB failure). Otherwise, let errors propagate.

### Centralised error handler (`src/middleware/errorHandler.js`)

Must be registered **last** in `src/app.js`, after all routes:

```js
export const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[ERROR] ${req.method} ${req.url} — ${status}: ${message}`);
  if (status >= 500) console.error(err.stack);

  if (status >= 500) {
    logEvent(db, {
      userId:   req.session?.user?.id   ?? null,
      username: req.session?.user?.name ?? null,
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
```

- 4xx errors: log to stdout only.
- 5xx errors: log to stdout **and** `event_log` with action `SERVER_ERROR`.
- API endpoints (Accept: application/json) receive JSON error responses.
- Page endpoints receive rendered `error.pug`.

### 404 handler

Register a catch-all route immediately before `errorHandler`:

```js
app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});
```

---

## Flash Messages (Manual Pattern)

Flash messages are stored on `req.session.flash` and consumed on the next request. Implement without a library.

**Writing a flash** (in route handlers, before redirect):
```js
req.session.flash = { type: 'success', message: 'User created.' };
// type is 'success' | 'error' | 'warning' | 'info' — maps to Bootstrap alert classes
```

**Reading and clearing** (middleware in `src/app.js`, registered before routes):
```js
app.use((req, res, next) => {
  res.locals.flash = req.session.flash ?? null;
  delete req.session.flash;
  next();
});
```

**Rendering in `layout.pug`**:
```pug
if flash
  .alert.alert-#{flash.type}.alert-dismissible.fade.show(role='alert')
    = flash.message
    button.btn-close(type='button' data-bs-dismiss='alert')
```

---

## Routes

### Authentication (`src/routes/auth.js`)

| Method | Path      | Auth  | Rate limit     | Description                         |
|--------|-----------|-------|----------------|-------------------------------------|
| GET    | `/login`  | none  | —              | Render login form                   |
| POST   | `/login`  | none  | `loginLimiter` | Authenticate, start session         |
| POST   | `/logout` | login | —              | Destroy session, redirect to /login |

### Queue (`src/routes/queue.js`)

| Method | Path     | Auth  | Description                            |
|--------|----------|-------|----------------------------------------|
| GET    | `/`      | login | Redirect to `/queue`                   |
| GET    | `/queue` | login | Download queue page                    |

### Add Job (`src/routes/add.js`)

| Method | Path   | Auth  | Description                   |
|--------|--------|-------|-------------------------------|
| GET    | `/add` | login | Add download job form         |

### Account (`src/routes/account.js`) — requires login

| Method | Path                   | Description                                              |
|--------|------------------------|----------------------------------------------------------|
| GET    | `/account`             | Render account page: change-password form + preferences  |
| POST   | `/account`             | Process password change; log `PASSWORD_CHANGED` event    |
| POST   | `/account/preferences` | Update user preferences; log `PREFERENCES_UPDATED` event |

#### Password change rules
- User must provide their current password for verification before the new password is accepted.
- Validate with `validateChangePassword` from `src/validators/userValidators.js`.
- On success: update the password hash in `users`, write a `PASSWORD_CHANGED / SUCCESS` event, show flash, redirect to `/account`.

#### Preferences rules
- On `GET /account`: fetch the full user row from `users`, parse `preferences` with `JSON.parse`, and pass the result to the template as `preferences`.
- On `POST /account/preferences`: validate with `validatePreferences`, merge or replace the stored object, serialise with `JSON.stringify`, write to `users.preferences`, log a `PREFERENCES_UPDATED / SUCCESS` event, show flash, redirect to `/account`.

### Settings (`src/routes/settings.js`) — requires admin

| Method | Path        | Description                            |
|--------|-------------|----------------------------------------|
| GET    | `/settings` | Render admin settings page             |
| POST   | `/settings` | Save settings; log `SETTINGS_UPDATED` |

### Health Check

| Method | Path      | Auth | Description                       |
|--------|-----------|------|-----------------------------------|
| GET    | `/health` | none | Returns `200 OK` with JSON status |

```js
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
```

Register this route **before** the `requireLogin` middleware chain.

### Users (`src/routes/users.js`) — all routes require admin

| Method | Path                | Rate limit          | Description                  |
|--------|---------------------|---------------------|------------------------------|
| GET    | `/users`            | —                   | List all users               |
| GET    | `/users/new`        | `userCreateLimiter` | Render create-user form      |
| POST   | `/users`            | `userCreateLimiter` | Create a new user            |
| GET    | `/users/:id/edit`   | —                   | Render edit-user form        |
| POST   | `/users/:id`        | —                   | Update user (role/password)  |
| POST   | `/users/:id/delete` | —                   | Delete a user                |

Constraints:
- An admin cannot delete their own account.
- The last remaining admin account cannot have its role demoted.

### Logs (`src/routes/logs.js`) — requires admin

| Method | Path    | Description                              |
|--------|---------|------------------------------------------|
| GET    | `/logs` | Render event log table with filtering UI |

Supported query parameters: `username`, `action`, `status`, `from`, `to`, `page` (default 1, page size 50). Sorted by `timestamp DESC`.

### Download Jobs API (`src/routes/api/jobs.js`) — requires login

| Method | Path                          | Auth         | Description                                           |
|--------|-------------------------------|--------------|-------------------------------------------------------|
| GET    | `/api/queue`                  | login        | JSON: all jobs visible to user (admins see all)       |
| POST   | `/api/jobs`                   | login        | Enqueue one or more download jobs                     |
| POST   | `/api/jobs/:id/cancel`        | login/owner  | Cancel running or pending job (SIGTERM via tree-kill) |
| POST   | `/api/jobs/:id/pause`         | login/owner  | Pause running job (SIGSTOP)                           |
| POST   | `/api/jobs/:id/resume`        | login/owner  | Resume paused job (SIGCONT), set status to running    |
| DELETE | `/api/jobs/:id`               | login/owner  | Delete job record (only if not running)               |
| POST   | `/api/jobs/reorder`           | login        | Reorder pending jobs (updates `priority` column)      |
| POST   | `/api/jobs/clear-completed`   | login        | Delete all completed/failed jobs for current user     |

**Ownership rule**: users may only act on their own jobs. Admins may act on any job. Return 403 if ownership check fails.

**`POST /api/jobs` body (single job)**:
```json
{
  "url": "https://...",
  "format_spec": "bestvideo+bestaudio",  // optional; null = use global default
  "output_dir": "/data/downloads",       // optional; null = use global default
  "subfolder": "playlist-name"           // optional
}
```

**`POST /api/jobs` body (batch — playlist)**:
```json
{
  "jobs": [
    { "url": "https://...", "format_spec": null, "output_dir": null, "subfolder": "my-playlist" },
    { "url": "https://...", "format_spec": null, "output_dir": null, "subfolder": "my-playlist" }
  ]
}
```

**`POST /api/jobs/reorder` body**:
```json
{ "order": [42, 17, 99, 3] }  // array of job IDs in desired priority order (index 0 = highest priority)
```

### URL Analysis API

| Method | Path              | Auth  | Rate limit      | Description                                       |
|--------|-------------------|-------|-----------------|---------------------------------------------------|
| GET    | `/api/analyse`    | login | `analyseLimiter`| Analyse URL: formats + metadata (yt-dlp -j)       |
| GET    | `/api/playlist`   | login | `analyseLimiter`| Fetch playlist entries (--flat-playlist -J)       |

**`GET /api/analyse?url=...`** response:
```json
{
  "title": "Video Title",
  "duration": 123,
  "extractor": "youtube",
  "formats": [
    { "format_id": "137", "ext": "mp4", "resolution": "1920x1080", "fps": 30, "tbr": 2500, "acodec": "none", "vcodec": "avc1" },
    { "format_id": "140", "ext": "m4a", "resolution": "audio only", "fps": null, "tbr": 128, "acodec": "mp4a.40.2", "vcodec": "none" }
  ]
}
```

**`GET /api/playlist?url=...`** response:
```json
{
  "title": "Playlist Title",
  "entries": [
    { "id": "abc123", "title": "Video 1", "duration": 300, "duration_string": "5:00", "url": "https://..." }
  ]
}
```

### Server Filesystem API

| Method | Path               | Auth  | Description                              |
|--------|--------------------|-------|------------------------------------------|
| GET    | `/api/filesystem`  | admin | Browse server filesystem (AJAX)          |

**`GET /api/filesystem?path=/some/dir`** response:
```json
{
  "path": "/some/dir",
  "parent": "/some",
  "entries": [
    { "name": "downloads", "type": "directory", "path": "/some/dir/downloads" },
    { "name": "file.mp4",  "type": "file",      "path": "/some/dir/file.mp4" }
  ]
}
```

Only returns directory entries and file names. Never follows symlinks. Admin-only.

### SSE Events API

| Method | Path           | Auth  | Description                       |
|--------|----------------|-------|-----------------------------------|
| GET    | `/api/events`  | login | SSE stream for all job progress   |

---

## Services

### `src/services/ytdlp.js`

```js
// Returns the yt-dlp executable path: YTDLP_PATH env or 'yt-dlp' from $PATH
export const getYtdlpPath = () => process.env.YTDLP_PATH || 'yt-dlp';

// Runs: yt-dlp -j --no-simulate --no-playlist URL
// Returns: { title, duration, extractor, formats: [{format_id, ext, resolution, fps, tbr, acodec, vcodec}] }
export const analyseUrl = async (url) => { ... };

// Runs: yt-dlp --flat-playlist -J URL
// Returns: { title, entries: [{id, title, duration, duration_string, url}] }
export const fetchPlaylist = async (url) => { ... };

// Constructs the full yt-dlp argument array for a job
// job: download_jobs row; config: { default_format_spec, default_download_path }
export const buildArgs = (job, config) => { ... };
```

**`buildArgs` output includes:**
- `--newline`
- `--progress-template` with JSON progress line (see below)
- `-f <format_spec>` (job.format_spec || config.default_format_spec)
- `-o <output_template>`

**Progress template**:
```
download:YTDLP_JSON {"pct":%(progress.downloaded_bytes)s,"total":%(progress.total_bytes)s,"est":%(progress.total_bytes_estimate)s,"spd":%(progress.speed)s,"eta":%(progress.eta)s,"frag_i":%(progress.fragment_index)s,"frag_n":%(progress.fragment_count)s}
```

Lines starting with `YTDLP_JSON ` are JSON-parsed to extract progress data. All other stdout lines are stored as log output.

**Output template**:
```
<output_dir>/<subfolder>/%(title)s.%(ext)s
```
Where `output_dir` = `job.output_dir || config.default_download_path`, and `subfolder` is appended only if non-empty.

**Never use `shell: true`** when spawning yt-dlp — construct the args array directly.

### `src/services/downloadQueue.js`

Singleton service, initialised once in `src/server.js` via `downloadQueue.start()`.

**Internal state:**
- `Map<jobId, { proc, buffer }>` for active processes
- `EventEmitter` instance for SSE subscriptions

**Public interface:**

```js
// Begin polling SQLite for pending jobs up to max_concurrent_downloads
start()

// Called after any job state change — promotes pending jobs to running if slots available
tick()

// Spawns yt-dlp for a job; updates DB row; emits events
_spawn(job)   // internal

// Sends SIGTERM via tree-kill to cancel a running/pending job
cancel(jobId)

// Sends SIGSTOP to the process group of a running job
pause(jobId)

// Sends SIGCONT; updates status to 'running'
resume(jobId)

// Returns the internal EventEmitter for SSE subscription
getEmitter()
```

**Events emitted on the EventEmitter:**

| Event name | Payload |
|------------|---------|
| `progress` | `{ jobId, pct, total, speed, eta, frag_i, frag_n }` |
| `job:started` | `{ jobId, pid, started_at }` |
| `job:completed` | `{ jobId, completed_at, output_filename }` |
| `job:failed` | `{ jobId, error_msg }` |
| `job:cancelled` | `{ jobId }` |

**`_spawn` behaviour:**
1. Set job `status = 'running'`, `started_at = datetime('now')`, `pid = proc.pid`.
2. Parse stdout line-by-line. Lines matching `/^YTDLP_JSON /` are JSON-parsed; updates DB row `progress_pct`, `speed_bps`, `eta_sec`, etc. and emits `progress`.
3. On `close` with code 0: set `status = 'completed'`, emit `job:completed`, call `tick()`.
4. On `close` with non-zero code (and status ≠ 'cancelled'): set `status = 'failed'`, `error_msg`, emit `job:failed`, call `tick()`.
5. On cancel: `tree-kill(pid, 'SIGTERM')`, then set `status = 'cancelled'` after exit.

---

## SSE Endpoint (`GET /api/events`)

```js
// src/routes/api/events.js
router.get('/events', requireLogin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const emitter = downloadQueue.getEmitter();

  const send = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Subscribe to all queue events
  const onProgress   = (data) => send('progress',       data);
  const onStarted    = (data) => send('job:started',    data);
  const onCompleted  = (data) => send('job:completed',  data);
  const onFailed     = (data) => send('job:failed',     data);
  const onCancelled  = (data) => send('job:cancelled',  data);

  emitter.on('progress',      onProgress);
  emitter.on('job:started',   onStarted);
  emitter.on('job:completed', onCompleted);
  emitter.on('job:failed',    onFailed);
  emitter.on('job:cancelled', onCancelled);

  req.on('close', () => {
    emitter.off('progress',      onProgress);
    emitter.off('job:started',   onStarted);
    emitter.off('job:completed', onCompleted);
    emitter.off('job:failed',    onFailed);
    emitter.off('job:cancelled', onCancelled);
  });
});
```

---

## Frontend Pages

### Queue page (`views/queue/index.pug` + `public/js/queue.js`)

- Status filter tabs: All / Pending / Running / Paused / Completed / Failed
- Table columns: Title (or URL if no title), Status, Progress (bar + %), Speed, ETA, Added, Actions
- Progress bars rendered from SSE `progress` events — update DOM in-place using `data-job-id` attributes
- Per-row actions: Cancel (pending/running), Pause (running), Resume (paused), Delete (completed/failed/cancelled)
- Drag-and-drop reorder (SortableJS) — only for `pending` rows; on sort end, fires `POST /api/jobs/reorder` with new order
- "Clear completed" button at top of table
- SSE connection opened on page load; reconnects on close

### Add Job page (`views/add.pug` + `public/js/add-job.js`)

**URL input:**
- Single URL input field
- "Analyse formats" checkbox (unchecked by default)
- Submit button

**Format analysis flow (when "Analyse formats" is checked):**
1. JS calls `GET /api/analyse?url=...` on form submit (before job creation)
2. Displays format table: Format ID, Extension, Resolution, FPS, Bitrate, Audio/Video codec
3. Video format dropdown (filtered to formats with vcodec ≠ 'none')
4. Audio format dropdown (filtered to formats with acodec ≠ 'none')
5. Plus preset buttons: Best, Best MP4, Audio Only
6. Format spec constructed: `<video_id>+<audio_id>` or preset string

**Playlist detection and flow:**
1. On URL change or submit, check if URL contains `list=` or `/playlist?`
2. Auto-call `GET /api/playlist?url=...` and show playlist panel
3. Table: index, title, duration — with row checkboxes
4. Toolbar: Select All / Select None / Invert / Regex filter input (filters visible rows by title match)
5. Subfolder input pre-filled with playlist title (first 40 chars, slugified: lowercase, hyphens)
6. Submit → `POST /api/jobs` with batch body: one entry per selected row

**Output directory:**
- Text input for custom output directory (optional, overrides global default)
- Leave blank to use global default

### Settings page (`views/settings.pug` + `public/js/settings.js`)

- Default download path: text input + "Browse..." button
  - Button opens a Bootstrap modal with AJAX filesystem browser
  - Browser: `GET /api/filesystem?path=...` returns JSON; renders directory listing with click-to-navigate
  - "Select" button sets the text input value and closes modal
- Max concurrent downloads: number input (1–8)
- Default format spec: text input with preset dropdown (Best, Best MP4, Audio Only)
- yt-dlp binary path: read-only display of resolved path (from `YTDLP_PATH` env or `yt-dlp`)
- Admin credentials file: if `admin-credentials.env` exists, show "Delete credentials file" button

---

## Views & UI

- All pages extend `layout.pug`.
- `layout.pug` includes Bootstrap 5 CSS and JS bundle (served as static files, not CDN).
- `layout.pug` includes SortableJS only on pages that need it (use a `scripts` block).
- Flash messages are consumed from `res.locals.flash` and rendered in the layout.
- The current user is available in all templates as `res.locals.user` — use `user` directly in Pug.
- Tables use Bootstrap classes `table table-striped table-hover table-sm`.
- Status badges use `badge bg-success` / `badge bg-danger` / `badge bg-warning` / `badge bg-secondary`.
- Navigation bar shows: Queue, Add, Settings (admin only), Users (admin only), Logs (admin only), Account, Logout.
- **No inline scripts in Pug templates or rendered HTML** — all frontend JS must live in `public/js/` static files.
- Frontend JS files communicate with API endpoints via `fetch()`.

---

## Graceful Shutdown

Handle `SIGTERM` and `SIGINT` in `src/server.js`. On shutdown: cancel all active downloads (SIGTERM via tree-kill), close the HTTP server, close the SQLite connection:

```js
const shutdown = async (signal) => {
  console.log(`[SHUTDOWN] Received ${signal}. Closing server...`);
  await downloadQueue.shutdown(); // cancels all active processes
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed.');
    db.close();
    console.log('[SHUTDOWN] Database connection closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

---

## Deployment (PM2)

```js
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name:        'y-front',
    script:      'src/server.js',
    instances:   1,
    autorestart: true,
    watch:       false,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

### Common PM2 commands

| Command                         | Description                        |
|---------------------------------|------------------------------------|
| `pm2 start ecosystem.config.cjs`| Start the application              |
| `pm2 stop y-front`              | Stop the application               |
| `pm2 restart y-front`           | Restart the application            |
| `pm2 reload y-front`            | Zero-downtime reload               |
| `pm2 delete y-front`            | Remove from PM2 process list       |
| `pm2 logs y-front`              | Tail application logs              |
| `pm2 monit`                     | Real-time process monitor          |
| `pm2 save`                      | Save process list for auto-restart |
| `pm2 startup`                   | Generate system startup script     |

- PM2 is installed globally on the host — do **not** add it as a project dependency.
- Environment variables should be set in `.env` (loaded by `dotenv`) rather than in `ecosystem.config.cjs`.

---

## Testing (`test/basic.test.js`)

Use Node's built-in `node:test` runner. Import `app` from `src/app.js` (not `src/server.js`) to avoid binding a port. Baseline tests:

- App module imports without throwing.
- The database initialises and all tables exist (`users`, `download_jobs`, `settings`, `event_log`).
- Default settings rows are present after init.
- `GET /health` returns 200.
- `GET /login` returns 200.
- `GET /` redirects to `/login` when unauthenticated.
- `GET /queue` redirects to `/login` when unauthenticated.
- `GET /add` redirects to `/login` when unauthenticated.
- `GET /api/queue` returns 401/redirect when unauthenticated.
- `POST /login` with invalid credentials returns 200 (re-renders form, does not crash).

Run with:
```json
"scripts": {
  "test": "node --test test/*.test.js"
}
```

> **Agent instruction**: Do not add tests beyond this baseline on first construction. After the initial build, propose additional test cases to the user (covering auth flows, queue API, SSE, job ownership) but do not implement them without explicit approval.

---

## `.gitignore` (baseline)

```
node_modules/
db/
*.db
admin-credentials.env
.DS_Store
Thumbs.db
*.log
```

---

## `package.json` (full dependencies)

```json
{
  "name": "y-front",
  "version": "1.0.0",
  "type": "module",
  "exports": "./src/app.js",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node src/server.js",
    "dev":   "nodemon src/server.js",
    "test":  "node --test test/*.test.js"
  },
  "dependencies": {
    "bcrypt":             "^5.x",
    "better-sqlite3":     "^12.x",
    "bootstrap":          "^5.x",
    "connect-sqlite3":    "^0.9.x",
    "dotenv":             "^16.x",
    "express":            "^5.x",
    "express-rate-limit": "^7.x",
    "express-session":    "^1.x",
    "express-validator":  "^7.x",
    "morgan":             "^1.x",
    "pug":                "^3.x",
    "sortablejs":         "^1.x",
    "tree-kill":          "^1.x"
  },
  "devDependencies": {
    "nodemon": "^3.x"
  }
}
```

---

## Security Notes

- Passwords are **never** logged, stored in plain text, or included in `event_log.detail` fields.
- `express-session` cookie must be set with `httpOnly: true`, `sameSite: 'lax'`.
- All POST/DELETE handlers that mutate state must verify authentication (and admin role where required) before acting.
- All form and query inputs must be validated and sanitised with `express-validator` before use.
- **Never use `shell: true`** when spawning yt-dlp — construct args as an array to prevent command injection.
- URL inputs for analyse/playlist/job-submit are validated with `isURL({ require_protocol: true })`.
- The filesystem browser (`/api/filesystem`) is admin-only and never follows symlinks.
- Secrets and credentials are managed via environment variables loaded from `.env` via `dotenv`; nothing sensitive is hardcoded.
- Rate limiting is applied to login, user creation, and analyse/playlist endpoints.
- Admin password generation uses `node:crypto` — no third-party randomness dependency.
- Job ownership is enforced at the API layer: users can only act on their own jobs; admins can act on any job.
