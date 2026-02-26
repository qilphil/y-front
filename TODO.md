# y-front — Implementation TODO

Phased checklist. Work phases in order; do not skip ahead. Mark items `[x]` as completed.

---

## Phase 1 — Foundation

Scaffold the project skeleton, configuration, database, auth system, and base templates exactly as specified in `AGENTS.md`. No yt-dlp-specific code yet.

### Project scaffolding
- [x] Create directory structure: `src/`, `src/middleware/`, `src/routes/`, `src/routes/api/`, `src/services/`, `src/validators/`, `src/views/`, `src/views/users/`, `src/views/logs/`, `src/views/queue/`, `public/`, `public/css/`, `public/js/`, `public/images/`, `test/`, `db/`
- [x] `package.json` — name `y-front`, `"type": "module"`, all deps from AGENTS.md, `start`/`dev`/`test` scripts
- [x] `.env` — `PORT=3420`, `DB_PATH=./db/y-front.db`, `SESSION_SECRET`, `NODE_ENV=development`, `YTDLP_PATH=`
- [x] `.env.example` — same keys, safe placeholder values
- [x] `.gitignore` — `node_modules/`, `db/`, `*.db`, `admin-credentials.env`, `.DS_Store`, `*.log`
- [x] `ecosystem.config.cjs` — PM2 config for `y-front`, `src/server.js`, `NODE_ENV=production`
- [x] `yarn install` — verify clean install

### Core source files
- [x] `src/config.js` — all constants: PORT (3420), DB_PATH, SESSION_SECRET, SESSION_MAX_AGE_MS, CREDENTIALS_FILE, YTDLP_PATH, LOGIN_RATE_LIMIT, USER_CREATE_RATE_LIMIT, ANALYSE_RATE_LIMIT
- [x] `src/db.js` — create `db/` dir, open SQLite, `CREATE TABLE IF NOT EXISTS` for all four tables (`users`, `event_log`, `download_jobs`, `settings`), insert default settings rows via `INSERT OR IGNORE`, admin auto-creation with `node:crypto`, write `admin-credentials.env`, export `db`
- [x] `src/middleware/logger.js` — `logEvent(db, {...})` function
- [x] `src/middleware/auth.js` — `requireLogin`, `requireAdmin`
- [x] `src/middleware/errorHandler.js` — 4-arg error handler, JSON vs HTML response, 5xx event logging

### Routes (auth system)
- [x] `src/validators/userValidators.js` — `validateLogin`, `validateCreateUser`, `validateChangePassword`, `validatePreferences`
- [x] `src/routes/auth.js` — `GET /login`, `POST /login` (with loginLimiter, session regenerate, last_login update), `POST /logout`
- [x] `src/routes/account.js` — `GET /account`, `POST /account` (password change), `POST /account/preferences`
- [x] `src/routes/users.js` — full CRUD (list, new, create, edit, update, delete); admin-only; cannot delete self or demote last admin; credentials file deletion endpoint
- [x] `src/routes/logs.js` — `GET /logs` with query filters (username, action, status, from, to, page)

### App assembly
- [x] `src/app.js` — morgan, express.json/urlencoded, session middleware (connect-sqlite3, rolling, 8h), `res.locals.user`, flash middleware, serve `/bootstrap` and `/vendor/Sortable.min.js` and `public/`, health check, mount all routes, 404 handler, errorHandler
- [x] `src/server.js` — `import 'dotenv/config'`, init db, listen on `config.PORT`, graceful shutdown (SIGTERM/SIGINT)

### Base views
- [x] `src/views/layout.pug` — Bootstrap CSS/JS, nav bar (Queue, Add, Settings[admin], Users[admin], Logs[admin], Account, Logout), flash alert block, `scripts` block for page-specific JS
- [x] `src/views/error.pug` — extends layout, displays `status` and `message`
- [x] `src/views/login.pug` — login form with validation error display
- [x] `src/views/account.pug` — change-password form + preferences JSON textarea
- [x] `src/views/users/index.pug` — users table, credentials file delete button (conditional)
- [x] `src/views/users/form.pug` — create/edit user form
- [x] `src/views/logs/index.pug` — event log table with filter controls, pagination

### Static assets
- [x] `public/css/site.css` — minimal custom overrides
- [x] `public/js/main.js` — shared frontend utilities (empty or minimal)
- [x] `public/favicon.svg` — yt-dlp themed icon (download arrow or similar)
- [x] `public/images/logo.svg` — yt-dlp themed logo

### Tests
- [x] `test/basic.test.js` — all baseline tests from AGENTS.md (app imports, tables exist, default settings present, `/health`, `/login`, `/` redirect, `/queue` redirect, `/add` redirect, `/api/queue` unauth, `POST /login` invalid creds)

### Phase 1 verification
- [x] `yarn install` runs cleanly
- [x] `node --test test/*.test.js` — all baseline tests pass (10/10)
- [ ] `node src/server.js` starts without errors, `admin-credentials.env` created on first run
- [ ] Visit `/login`, log in with generated credentials, log out

---

## Phase 2 — yt-dlp Service Layer

Implement the yt-dlp subprocess helpers and the download queue manager. No HTTP routes yet — these are pure service modules.

### yt-dlp helpers (`src/services/ytdlp.js`)
- [x] `getYtdlpPath()` — returns `process.env.YTDLP_PATH || 'yt-dlp'`
- [x] `analyseUrl(url)` — spawn `yt-dlp -j --no-simulate --no-playlist <url>` (no `shell: true`), parse stdout JSON, return `{ title, duration, extractor, formats }`; reject on non-zero exit or parse error
- [x] `fetchPlaylist(url)` — spawn `yt-dlp --flat-playlist -J <url>`, parse stdout JSON, return `{ title, entries: [{id, title, duration, duration_string, url}] }`; reject on error
- [x] `buildArgs(job, config)` — construct full args array including `--newline`, `--progress-template` with `YTDLP_JSON` prefix, `-f <format_spec>`, `-o <output_template>`; derive output_dir and subfolder; never use shell: true

### Download queue manager (`src/services/downloadQueue.js`)
- [x] Module structure: singleton export, internal `Map<jobId, {proc, buffer}>`, `EventEmitter` instance
- [x] `getEmitter()` — returns the internal EventEmitter
- [x] `start()` — reads `max_concurrent_downloads` from settings DB, begins polling (setInterval or tick-driven) for pending jobs; calls `tick()`
- [x] `tick()` — queries DB for count of running jobs, queries pending jobs ordered by `priority ASC, id ASC`, spawns up to `max_concurrent_downloads - running` jobs
- [x] `_spawn(job)` — `child_process.spawn` with args from `buildArgs`, no `shell: true`; sets `status = 'running'`, `started_at`, `pid`; line-by-line stdout parsing; JSON progress lines update DB + emit `progress`; on close code 0 → `completed`, emit `job:completed`, call `tick()`; on close non-zero → `failed`, emit `job:failed`, call `tick()`
- [x] `cancel(jobId)` — look up running job, call `treeKill(pid, 'SIGTERM')`, set `status = 'cancelled'` after exit, emit `job:cancelled`
- [x] `pause(jobId)` — `process.kill(pid, 'SIGSTOP')`, set `status = 'paused'`
- [x] `resume(jobId)` — `process.kill(pid, 'SIGCONT')`, set `status = 'running'`, emit `job:started`
- [x] `shutdown()` — cancel all active processes gracefully (for SIGTERM handler in server.js)

### Phase 2 verification
- [x] Manual: call `analyseUrl` in a REPL with a real YouTube URL — verify format list returned
- [x] Manual: call `fetchPlaylist` with a playlist URL — verify error propagated correctly
- [x] Manual: call `buildArgs` with a mock job — verify arg array structure
- [x] Manual: instantiate queue, insert a pending job in SQLite, call `start()` — verify download starts and progress events fire

---

## Phase 3 — Download API Routes

Wire up all REST API endpoints. The download queue and yt-dlp services from Phase 2 are the backend.

### Validators
- [x] `src/validators/jobValidators.js` — `validateJobSubmit` (url, format_spec, output_dir, subfolder), `validateSettings` (path, max_concurrent, format_spec), `validateAnalyseQuery` (url)

### Job API (`src/routes/api/jobs.js`)
- [x] `GET /api/queue` — return all jobs as JSON; regular users see only their own jobs, admins see all; support optional `?status=` filter
- [x] `POST /api/jobs` — accept single job or `{ jobs: [...] }` batch; validate each entry; insert rows; call `downloadQueue.tick()`; log `JOB_QUEUED`; return created job(s)
- [x] `POST /api/jobs/reorder` — accept `{ order: [id, ...] }`, update `priority` column (index = priority value), return success; only affects `pending` jobs owned by user (or all if admin)
- [x] `POST /api/jobs/clear-completed` — delete all `completed`/`failed`/`cancelled` jobs for the authenticated user (admin deletes all users'); log `JOB_DELETED` per job; return count
- [x] `POST /api/jobs/:id/cancel` — ownership check; call `downloadQueue.cancel(id)`; log `JOB_CANCELLED`
- [x] `POST /api/jobs/:id/pause` — ownership check; job must be `running`; call `downloadQueue.pause(id)`
- [x] `POST /api/jobs/:id/resume` — ownership check; job must be `paused`; call `downloadQueue.resume(id)`, call `tick()`
- [x] `DELETE /api/jobs/:id` — ownership check; job must not be `running` or `paused`; delete row; log `JOB_DELETED`

### Analysis API
- [x] `src/routes/api/analyse.js` — `GET /api/analyse?url=...` with `analyseLimiter`; validate URL; call `ytdlp.analyseUrl`; return JSON; handle errors gracefully (return 422 with error message on yt-dlp failure)
- [x] `src/routes/api/playlist.js` — `GET /api/playlist?url=...` with `analyseLimiter`; validate URL; call `ytdlp.fetchPlaylist`; return JSON

### Filesystem API
- [x] `src/routes/api/filesystem.js` — `GET /api/filesystem?path=...` admin-only; resolve and validate path (no symlink follow); read directory entries; return `{ path, parent, entries }` JSON; handle permission errors gracefully

### SSE API
- [x] `src/routes/api/events.js` — `GET /api/events` login-required; set SSE headers, flush; subscribe to all downloadQueue events; write `event: <name>\ndata: <json>\n\n` for each; clean up listeners on `req.close`

### Mount in app.js
- [x] Mount `apiJobsRouter` at `/api`
- [x] Mount `analyseRouter`, `playlistRouter`, `filesystemRouter`, `eventsRouter` at `/api`

### Phase 3 verification
- [x] `node --test test/*.test.js` — all Phase 1 baseline tests still pass (10/10)
- [x] Manual: `POST /api/jobs` with a valid URL, verify row in SQLite (201 + row created)
- [x] Manual: `GET /api/events` — SSE stream opens, `Content-Type: text/event-stream`
- [x] Manual: `GET /api/analyse?url=<youtube>` — 11 formats returned
- [x] Manual: `GET /api/filesystem?path=/tmp` — directory listing returned (admin)
- [x] Manual: `DELETE /api/jobs/:id` as wrong user — 403 Forbidden confirmed

---

## Phase 4 — Queue & Add Views

Build the two main user-facing pages with real-time SSE updates and interactive JS.

### Queue page
- [x] `src/routes/queue.js` — `GET /` redirects to `/queue`; `GET /queue` renders `queue/index.pug` with initial jobs from DB
- [x] `src/views/queue/index.pug` — status filter tabs (All/Pending/Running/Paused/Completed/Failed); table with columns (Title/URL, Status badge, Progress bar, Speed, ETA, Added, Actions); per-row action buttons (Cancel, Pause/Resume, Delete) with `data-job-id` and `data-status` attrs; "Clear completed" button; include `queue.js` via `scripts` block
- [x] `public/js/queue.js`:
  - [x] Open `EventSource('/api/events')` on page load; reconnect on error
  - [x] Handle `progress` events: update progress bar, speed, ETA for matching `data-job-id` row
  - [x] Handle `job:started`, `job:completed`, `job:failed`, `job:cancelled` events: update status badge and action buttons in-place; reload row data from `/api/queue` if needed
  - [x] Status tab click: filter table rows by status class (or re-fetch from `/api/queue?status=...`)
  - [x] "Cancel" button click: `POST /api/jobs/:id/cancel`, update row on success
  - [x] "Pause" button click: `POST /api/jobs/:id/pause`, update row
  - [x] "Resume" button click: `POST /api/jobs/:id/resume`, update row
  - [x] "Delete" button click: `DELETE /api/jobs/:id`, remove row from DOM
  - [x] "Clear completed" button: `POST /api/jobs/clear-completed`, remove matching rows
  - [x] SortableJS init on pending rows only: on `end` event, collect new order of `data-job-id`s, call `POST /api/jobs/reorder`

### Add Job page
- [x] `src/routes/add.js` — `GET /add` renders `add.pug`
- [x] `src/views/add.pug` — URL input, "Analyse formats" checkbox, format picker panel (hidden by default), playlist panel (hidden by default), output dir input, subfolder input, submit button; include `add-job.js` via `scripts` block
- [x] `public/js/add-job.js`:
  - [x] "Analyse formats" checkbox: on check, show format panel skeleton; on form submit with checkbox checked, call `GET /api/analyse?url=...` first, then render format table
  - [x] Format table render: separate video and audio format dropdowns; preset buttons (Best, Best MP4, Audio Only); construct `format_spec` string
  - [x] URL input change: detect playlist URL (contains `list=` or `/playlist?`); auto-call `GET /api/playlist?url=...`; show playlist panel
  - [x] Playlist panel: render table (index, title, duration, checkbox); pre-fill subfolder with slugified playlist title (≤40 chars, lowercase, hyphens for spaces)
  - [x] Toolbar: Select All, Select None, Invert Selection buttons
  - [x] Regex filter input: filter visible rows by title match in real-time
  - [x] Form submit: if playlist mode, collect selected entries, build batch body, `POST /api/jobs` with `{ jobs: [...] }`; if single URL, `POST /api/jobs` with single body; on success, redirect to `/queue`
  - [x] Error display: show error messages inline if analyse/playlist API calls fail

### Phase 4 verification
- [x] `/queue` renders (200), job rows appear, SSE + SortableJS scripts included
- [x] `/add` renders (200), format panel + playlist panel present in DOM (hidden by default)
- [ ] Visit `/queue` in browser — SSE stream opens (verify in DevTools Network tab)
- [ ] Add a YouTube URL via `/add` — job appears in queue table, progress bar updates in real time
- [ ] Pause/resume a running job — status badge updates without page reload
- [ ] Cancel a job — row updates to cancelled status
- [ ] Drag-and-drop two pending rows — reorder takes effect (verify `priority` in SQLite)
- [ ] Add a playlist URL — playlist panel appears, select some entries, submit — multiple jobs created
- [ ] Analyse formats for a URL — format table renders, select custom format, submit — job created with format_spec

---

## Phase 5 — Settings

Build the admin settings page with filesystem browser.

### Settings route
- [x] `src/routes/settings.js` — `GET /settings` (admin only): read all settings from DB, render `settings.pug`; `POST /settings` (admin only): validate with `validateSettings`, update settings rows in DB, call `downloadQueue.reloadConfig()` (re-reads `max_concurrent_downloads`), log `SETTINGS_UPDATED`, flash success, redirect to `/settings`
- [x] `downloadQueue.reloadConfig()` already implemented (calls `tick()`)

### Settings view
- [x] `src/views/settings.pug` — form with: default download path text input + "Browse..." button; max concurrent downloads number input (min=1 max=8); default format spec text input + preset dropdown; yt-dlp binary path display (read-only, from config); admin credentials file section (conditional on file existence); include `settings.js` via `scripts` block

### Settings frontend
- [x] `public/js/settings.js`:
  - [x] "Browse..." button: open Bootstrap modal with AJAX filesystem browser
  - [x] Modal: call `GET /api/filesystem?path=<current>` on open; render directory listing; clicking a directory navigates into it (another AJAX call); "Select this directory" button sets the text input and closes modal; "Up" / parent link in modal
  - [x] Preset dropdown for format spec: selecting a preset fills the text input
  - [x] Format of presets: Best (`bestvideo+bestaudio/best`), Best MP4 (`bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`), Audio Only (`bestaudio/best`)

### Phase 5 verification
- [x] `GET /settings` returns 200, all expected fields rendered
- [x] `POST /settings` saves to DB, redirects with flash, `reloadConfig()` called
- [x] `POST /settings` with empty path returns 422 with validation errors
- [x] Non-admin user cannot access `/settings` — 403 confirmed
- [x] Filesystem browser endpoint responds with directory listing
- [ ] Visit `/settings` in browser — "Browse…" modal opens, navigate, select sets input
- [ ] Change max concurrent downloads, save — next `tick()` respects new limit
- [ ] Change default format spec — new jobs with `format_spec = NULL` use the new default

---

## Phase 6 — Polish & Security

Final hardening, ownership enforcement, navigation polish, and extended assets.

### Security hardening
- [x] `shell: false` confirmed in all `child_process.spawn` calls (`ytdlp.js`, `downloadQueue.js`)
- [x] All API endpoints have correct auth middleware — `requireLogin` on all `/api/jobs*`, `/api/events`, `/api/analyse`, `/api/playlist`; `requireAdmin` on `/api/filesystem`
- [x] Job ownership checked via `assertOwner()` in cancel, pause, resume, delete; reorder silently skips non-owned rows
- [x] `analyseLimiter` applied to both `/api/analyse` and `/api/playlist`
- [x] Filesystem browser returns 403 for non-admin — confirmed by test
- [x] URL inputs validated with `isURL({ require_protocol: true })` in `jobValidators.js` and `validateAnalyseQuery`
- [x] Session cookie: `httpOnly: true`, `sameSite: 'lax'` in `app.js`
- [x] No sensitive data in `event_log.detail` — only error messages/codes, never passwords or raw URLs

### Navigation & UX
- [x] Nav bar shows/hides admin links (`Settings`, `Users`, `Logs`) based on `user.role === 'admin'`
- [x] Queue page: admin column (`owner_username`) shown only when `user.role === 'admin'`
- [x] Failed job rows show `error_msg` inline in title cell
- [x] Empty state: "No jobs in queue." in queue table; "No format details available" notice in format picker when formats array is empty

### Static assets
- [x] `public/favicon.svg` — download arrow on dark background (Bootstrap blue on dark grey)
- [x] `public/images/logo.svg` — icon + "y-front" text

### Extended tests (`test/api.test.js`)
- [x] Auth flow: successful login redirects, updates `last_login`, logs SUCCESS event
- [x] Auth flow: failed login returns 200, logs FAILURE event
- [x] Queue API: `POST /api/jobs` creates row in DB, returns 201 with job object
- [x] Queue API: `DELETE /api/jobs/:id` returns 403 when called by non-owner non-admin
- [x] Queue API: `POST /api/jobs/reorder` updates priority values correctly
- [x] Settings API: `POST /settings` by non-admin returns 403, settings unchanged
- [x] Filesystem API: non-admin returns 403; path traversal (`../../../etc`) is normalised, no crash

### Phase 6 verification
- [x] `node --test test/*.test.js` — 19/19 tests pass (10 baseline + 9 extended)
- [x] Security: non-admin `DELETE /api/jobs/:id` → 403 (automated test)
- [x] Security: non-admin `POST /settings` → 403 (automated test)
- [x] Security: non-admin `GET /api/filesystem` → 403 (automated test)
- [ ] Full end-to-end: create user, log in as user, add download, observe SSE progress, complete download, verify file on disk
- [ ] Graceful shutdown: `kill -TERM <pid>` — running downloads receive SIGTERM, server exits cleanly

---

## Verification Checklist (Final)

- [ ] `yarn install` — installs all deps cleanly, no peer dep warnings
- [x] `node --test test/*.test.js` — 19/19 tests pass
- [ ] Start server: `node src/server.js` — no errors, port 3420 bound
- [ ] Visit `/login`, log in with generated admin credentials, delete credentials file
- [ ] Add a single YouTube URL, observe queue progress via SSE
- [ ] Add a playlist URL, verify playlist table with selection tools, batch-enqueue
- [ ] Add URL with "Analyse formats" checked, verify format picker, submit with custom format
- [ ] Pause a running job — verify SIGSTOP (process stops consuming CPU)
- [ ] Resume the paused job — verify download continues
- [ ] Cancel a running job — verify SIGTERM, status → cancelled
- [ ] Open `/settings`, browse filesystem, save new download path, verify next job uses it
- [ ] Create a second user, verify they cannot touch first user's jobs
- [ ] `pm2 start ecosystem.config.cjs` — production start succeeds
