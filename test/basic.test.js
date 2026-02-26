import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import app from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('app module imports without throwing', () => {
  assert.ok(app, 'app is defined');
});

test('database initialises and all tables exist', () => {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('users'),         'users table exists');
  assert.ok(tables.includes('event_log'),     'event_log table exists');
  assert.ok(tables.includes('download_jobs'), 'download_jobs table exists');
  assert.ok(tables.includes('settings'),      'settings table exists');
});

test('default settings rows are present', () => {
  const keys = db.prepare('SELECT key FROM settings').all().map((r) => r.key);
  assert.ok(keys.includes('default_download_path'),    'default_download_path setting exists');
  assert.ok(keys.includes('max_concurrent_downloads'), 'max_concurrent_downloads setting exists');
  assert.ok(keys.includes('default_format_spec'),      'default_format_spec setting exists');
});

test('GET /health returns 200 with ok status', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(typeof body.uptime === 'number', 'uptime is a number');
});

test('GET /login returns 200', async () => {
  const res = await fetch(`${baseUrl}/login`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Sign In'), 'login page contains Sign In');
});

test('GET / redirects when unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.ok([301, 302, 303].includes(res.status), `expected redirect, got ${res.status}`);
});

test('GET /queue redirects to /login when unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/queue`, { redirect: 'manual' });
  assert.ok([301, 302, 303].includes(res.status), `expected redirect, got ${res.status}`);
  assert.ok(res.headers.get('location')?.includes('/login'), 'redirects to /login');
});

test('GET /add redirects to /login when unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/add`, { redirect: 'manual' });
  assert.ok([301, 302, 303].includes(res.status), `expected redirect, got ${res.status}`);
  assert.ok(res.headers.get('location')?.includes('/login'), 'redirects to /login');
});

test('GET /api/queue redirects when unauthenticated', async () => {
  const res = await fetch(`${baseUrl}/api/queue`, { redirect: 'manual' });
  assert.ok([301, 302, 303, 401].includes(res.status), `expected auth redirect/401, got ${res.status}`);
});

test('POST /login with invalid credentials returns 200 and re-renders form', async () => {
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'nobody', password: 'wrongpassword123' }),
  });
  assert.equal(res.status, 200, 'returns 200, not a crash or redirect');
  const text = await res.text();
  assert.ok(text.includes('Sign In'), 'login form is re-rendered');
});
