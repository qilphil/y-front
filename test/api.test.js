/**
 * test/api.test.js — Extended API tests (Phase 6)
 * Covers auth flows, queue API, settings auth, and filesystem safety.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { db } from '../src/db.js';
import app from '../src/app.js';

// ── Test-only users (cleaned up in after()) ───────────────────────────────────

const ADMIN_U = '_test_admin_p6';
const ADMIN_P = 'Admin!Test_p6';
const USER_U  = '_test_user_p6';
const USER_P  = 'User!Test_p6';

// ── Server setup ──────────────────────────────────────────────────────────────

let server;
let baseUrl;
let adminCookie; // session cookie for ADMIN_U
let userCookie;  // session cookie for USER_U

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  // bcrypt with 4 rounds for test speed
  const hash = (p) => bcrypt.hashSync(p, 4);

  db.prepare(
    `INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, 'admin')`
  ).run(ADMIN_U, hash(ADMIN_P));

  db.prepare(
    `INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, 'user')`
  ).run(USER_U, hash(USER_P));

  [adminCookie, userCookie] = await Promise.all([
    loginAs(ADMIN_U, ADMIN_P),
    loginAs(USER_U, USER_P),
  ]);

  assert.ok(adminCookie, 'admin test login should succeed');
  assert.ok(userCookie,  'user test login should succeed');
});

after(async () => {
  // Remove test users (jobs will cascade-fail FK but we cleaned them per-test)
  db.prepare('DELETE FROM users WHERE username IN (?, ?)').run(ADMIN_U, USER_U);
  await new Promise((resolve) => server.close(resolve));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(username, password) {
  const res = await fetch(`${baseUrl}/login`, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:     new URLSearchParams({ username, password }),
    redirect: 'manual',
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? null;
}

function jsonHeaders(cookie) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

// ── Auth flow tests ───────────────────────────────────────────────────────────

test('successful login redirects and updates last_login', async () => {
  const res = await fetch(`${baseUrl}/login`, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:     new URLSearchParams({ username: ADMIN_U, password: ADMIN_P }),
    redirect: 'manual',
  });

  assert.ok([301, 302, 303].includes(res.status), `expected redirect, got ${res.status}`);
  assert.ok(res.headers.get('set-cookie'), 'Set-Cookie header present after login');

  const user = db.prepare('SELECT last_login FROM users WHERE username = ?').get(ADMIN_U);
  assert.ok(user.last_login, 'last_login was updated on successful login');
});

test('successful login is logged as SUCCESS in event_log', async () => {
  const before = db.prepare(
    `SELECT COUNT(*) AS n FROM event_log WHERE username = ? AND action = 'LOGIN' AND status = 'SUCCESS'`
  ).get(ADMIN_U).n;

  await fetch(`${baseUrl}/login`, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:     new URLSearchParams({ username: ADMIN_U, password: ADMIN_P }),
    redirect: 'manual',
  });

  const after = db.prepare(
    `SELECT COUNT(*) AS n FROM event_log WHERE username = ? AND action = 'LOGIN' AND status = 'SUCCESS'`
  ).get(ADMIN_U).n;

  assert.ok(after > before, 'LOGIN SUCCESS event logged');
});

test('failed login is logged as FAILURE in event_log', async () => {
  const before = db.prepare(
    `SELECT COUNT(*) AS n FROM event_log WHERE username = ? AND action = 'LOGIN' AND status = 'FAILURE'`
  ).get(ADMIN_U).n;

  const res = await fetch(`${baseUrl}/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ username: ADMIN_U, password: 'definitely-wrong' }),
  });

  assert.equal(res.status, 200, 'failed login returns 200 (re-renders form)');

  const after = db.prepare(
    `SELECT COUNT(*) AS n FROM event_log WHERE username = ? AND action = 'LOGIN' AND status = 'FAILURE'`
  ).get(ADMIN_U).n;

  assert.ok(after > before, 'LOGIN FAILURE event logged');
});

// ── Queue API tests ───────────────────────────────────────────────────────────

test('POST /api/jobs creates a row in DB and returns 201', async () => {
  const res = await fetch(`${baseUrl}/api/jobs`, {
    method:  'POST',
    headers: jsonHeaders(adminCookie),
    body:    JSON.stringify({ url: 'https://www.example.com/video/api-test-p6' }),
  });

  assert.equal(res.status, 201, 'job creation returns 201');
  const job = await res.json();
  assert.ok(Number.isInteger(job.id), 'response includes numeric job id');
  assert.equal(job.url, 'https://www.example.com/video/api-test-p6');
  assert.equal(job.status, 'pending');

  const row = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(job.id);
  assert.ok(row, 'row exists in download_jobs');
  assert.equal(row.url, 'https://www.example.com/video/api-test-p6');

  db.prepare('DELETE FROM download_jobs WHERE id = ?').run(job.id);
});

test('DELETE /api/jobs/:id as non-owner returns 403', async () => {
  // Admin creates a job
  const createRes = await fetch(`${baseUrl}/api/jobs`, {
    method:  'POST',
    headers: jsonHeaders(adminCookie),
    body:    JSON.stringify({ url: 'https://www.example.com/video/ownership-test' }),
  });
  assert.equal(createRes.status, 201);
  const job = await createRes.json();

  // Regular user attempts to delete admin's job
  const delRes = await fetch(`${baseUrl}/api/jobs/${job.id}`, {
    method:  'DELETE',
    headers: { Cookie: userCookie, Accept: 'application/json' },
  });
  assert.equal(delRes.status, 403, 'non-owner gets 403');

  // Verify job still exists
  const row = db.prepare('SELECT id FROM download_jobs WHERE id = ?').get(job.id);
  assert.ok(row, 'job still exists after failed delete attempt');

  db.prepare('DELETE FROM download_jobs WHERE id = ?').run(job.id);
});

test('POST /api/jobs/reorder updates priority values correctly', async () => {
  const { id: adminId } = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_U);
  const ins = db.prepare(
    `INSERT INTO download_jobs (user_id, url, status) VALUES (?, ?, 'pending')`
  );
  const r1 = ins.run(adminId, 'https://www.example.com/reorder-a');
  const r2 = ins.run(adminId, 'https://www.example.com/reorder-b');
  const id1 = r1.lastInsertRowid;
  const id2 = r2.lastInsertRowid;

  // Reverse the order: put id2 first, id1 second
  const res = await fetch(`${baseUrl}/api/jobs/reorder`, {
    method:  'POST',
    headers: jsonHeaders(adminCookie),
    body:    JSON.stringify({ order: [id2, id1] }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const row1 = db.prepare('SELECT priority FROM download_jobs WHERE id = ?').get(id1);
  const row2 = db.prepare('SELECT priority FROM download_jobs WHERE id = ?').get(id2);
  assert.equal(row2.priority, 0, 'id2 should have priority 0 (first in order)');
  assert.equal(row1.priority, 1, 'id1 should have priority 1 (second in order)');

  db.prepare('DELETE FROM download_jobs WHERE id IN (?, ?)').run(id1, id2);
});

// ── Settings auth test ────────────────────────────────────────────────────────

test('POST /settings as non-admin returns 403', async () => {
  const before = db.prepare(
    `SELECT value FROM settings WHERE key = 'default_download_path'`
  ).get().value;

  const res = await fetch(`${baseUrl}/settings`, {
    method:  'POST',
    headers: { Cookie: userCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      default_download_path:    '/tmp/should-not-be-set',
      max_concurrent_downloads: '1',
      default_format_spec:      'best',
    }),
  });
  assert.equal(res.status, 403, 'non-admin POST /settings returns 403');

  const after = db.prepare(
    `SELECT value FROM settings WHERE key = 'default_download_path'`
  ).get().value;
  assert.equal(before, after, 'settings unchanged after rejected POST');
});

// ── Filesystem API tests ──────────────────────────────────────────────────────

test('GET /api/filesystem as non-admin returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/filesystem?path=/tmp`, {
    headers:  { Cookie: userCookie },
    redirect: 'manual',
  });
  assert.equal(res.status, 403, 'non-admin filesystem request returns 403');
});

test('GET /api/filesystem normalises path traversal attempts', async () => {
  const res = await fetch(
    `${baseUrl}/api/filesystem?path=${encodeURIComponent('../../../etc')}`,
    { headers: { Cookie: adminCookie, Accept: 'application/json' } }
  );

  // May be 200 (readable), 403 (permission denied), or 404 (not found)
  // — all are safe outcomes; a crash would be a 500
  assert.ok(
    [200, 403, 404].includes(res.status),
    `path traversal should not crash server, got ${res.status}`
  );

  if (res.status === 200) {
    const body = await res.json();
    assert.ok(body.path.startsWith('/'), 'returned path is absolute');
    assert.ok(!body.path.includes('..'), 'returned path has no raw .. segments');
  }
});
