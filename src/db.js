import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import config from './config.js';

// Ensure db directory exists
const dbPath = resolve(config.DB_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

// WAL mode for better read/write concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'user',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT,
    preferences TEXT    NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS event_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL DEFAULT (datetime('now')),
    user_id   INTEGER,
    username  TEXT,
    action    TEXT    NOT NULL,
    target    TEXT,
    status    TEXT    NOT NULL,
    detail    TEXT,
    ip        TEXT
  );

  CREATE TABLE IF NOT EXISTS download_jobs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    url              TEXT    NOT NULL,
    title            TEXT,
    status           TEXT    NOT NULL DEFAULT 'pending',
    priority         INTEGER NOT NULL DEFAULT 0,
    format_spec      TEXT,
    output_dir       TEXT,
    subfolder        TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    started_at       TEXT,
    completed_at     TEXT,
    error_msg        TEXT,
    pid              INTEGER,
    progress_pct     REAL,
    speed_bps        REAL,
    eta_sec          INTEGER,
    total_bytes      INTEGER,
    downloaded_bytes INTEGER,
    output_filename  TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Default settings ──────────────────────────────────────────────────────────

const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
insertSetting.run('default_download_path', '/tmp/ytdlp-downloads');
insertSetting.run('max_concurrent_downloads', '2');
insertSetting.run('default_format_spec', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');

// ── Bootstrap admin ───────────────────────────────────────────────────────────

const adminExists = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();

if (!adminExists) {
  const password = randomBytes(12).toString('base64url').slice(0, 16);
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')`).run(hash);
  const credPath = resolve(config.CREDENTIALS_FILE);
  writeFileSync(credPath, `ADMIN_USER=admin\nADMIN_PASS=${password}\n`);
  console.log('[INIT] Admin user created. Credentials written to admin-credentials.env — delete this file after first login.');
}

export default db;
