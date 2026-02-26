import { Router } from 'express';
import { db } from '../../db.js';
import { logEvent } from '../../middleware/logger.js';
import { requireLogin } from '../../middleware/auth.js';
import downloadQueue from '../../services/downloadQueue.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Throw 404 if job not found, 403 if caller doesn't own it. */
const assertOwner = (job, user) => {
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  if (user.role !== 'admin' && job.user_id !== user.id) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
};

/** Validate a single job submission object; returns an error string or null. */
const validateJob = (job) => {
  if (!job || typeof job !== 'object') return 'job must be an object';
  if (!job.url || typeof job.url !== 'string') return 'url is required';
  try { new URL(job.url); } catch { return 'url must be a valid URL with protocol'; }
  if (job.url.length > 2048) return 'url must be ≤2048 chars';
  if (job.format_spec != null && typeof job.format_spec !== 'string')
    return 'format_spec must be a string';
  if (job.format_spec && job.format_spec.length > 256)
    return 'format_spec must be ≤256 chars';
  if (job.output_dir != null && typeof job.output_dir !== 'string')
    return 'output_dir must be a string';
  if (job.output_dir && job.output_dir.length > 1024)
    return 'output_dir must be ≤1024 chars';
  if (job.subfolder != null && typeof job.subfolder !== 'string')
    return 'subfolder must be a string';
  if (job.subfolder && job.subfolder.length > 256)
    return 'subfolder must be ≤256 chars';
  return null;
};

const insertJob = (userId, job) =>
  db.prepare(`
    INSERT INTO download_jobs (user_id, url, format_spec, output_dir, subfolder)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    job.url.trim(),
    job.format_spec?.trim() || null,
    job.output_dir?.trim()  || null,
    job.subfolder?.trim()   || null,
  );

// ── GET /api/queue ────────────────────────────────────────────────────────────

router.get('/queue', requireLogin, (req, res) => {
  const { user } = req.session;
  const { status } = req.query;

  const conditions = [];
  const params = [];

  if (user.role !== 'admin') {
    conditions.push('user_id = ?');
    params.push(user.id);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const jobs = db.prepare(
    `SELECT * FROM download_jobs ${where} ORDER BY
       CASE status WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
       priority ASC, id ASC`
  ).all(...params);

  res.json(jobs);
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────

router.post('/jobs', requireLogin, (req, res) => {
  const { user } = req.session;

  // ── Batch mode: { jobs: [...] } ──────────────────────────────────────────
  if (Array.isArray(req.body.jobs)) {
    const jobList = req.body.jobs;
    if (jobList.length === 0)
      return res.status(400).json({ error: 'jobs array must not be empty' });
    if (jobList.length > 200)
      return res.status(400).json({ error: 'Cannot enqueue more than 200 jobs at once' });

    const errors = [];
    jobList.forEach((j, i) => {
      const err = validateJob(j);
      if (err) errors.push({ index: i, error: err });
    });
    if (errors.length) return res.status(400).json({ errors });

    const insertMany = db.transaction(() =>
      jobList.map((j) => {
        const result = insertJob(user.id, j);
        return db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(result.lastInsertRowid);
      })
    );
    const created = insertMany();

    logEvent(db, {
      userId:   user.id,
      username: user.username,
      action:   'JOB_QUEUED',
      target:   created.map((j) => j.id).join(','),
      status:   'SUCCESS',
      ip:       req.ip,
    });

    downloadQueue.tick();
    return res.status(201).json(created);
  }

  // ── Single mode ──────────────────────────────────────────────────────────
  const err = validateJob(req.body);
  if (err) return res.status(400).json({ error: err });

  const result = insertJob(user.id, req.body);
  const created = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(result.lastInsertRowid);

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'JOB_QUEUED',
    target:   String(created.id),
    status:   'SUCCESS',
    ip:       req.ip,
  });

  downloadQueue.tick();
  res.status(201).json(created);
});

// ── POST /api/jobs/reorder ────────────────────────────────────────────────────
// Must be registered before /:id routes to avoid param capture

router.post('/jobs/reorder', requireLogin, (req, res) => {
  const { user } = req.session;
  const { order } = req.body;

  if (!Array.isArray(order) || order.length === 0)
    return res.status(400).json({ error: 'order must be a non-empty array of job IDs' });
  if (!order.every((id) => Number.isInteger(Number(id))))
    return res.status(400).json({ error: 'order must contain integer job IDs' });

  const reorder = db.transaction(() => {
    order.forEach((jobId, idx) => {
      const job = db.prepare(
        `SELECT id, user_id, status FROM download_jobs WHERE id = ? AND status = 'pending'`
      ).get(Number(jobId));
      if (!job) return; // skip non-pending or missing
      if (user.role !== 'admin' && job.user_id !== user.id) return; // skip unowned
      db.prepare(`UPDATE download_jobs SET priority = ? WHERE id = ?`).run(idx, job.id);
    });
  });
  reorder();

  res.json({ ok: true });
});

// ── POST /api/jobs/clear-completed ───────────────────────────────────────────

router.post('/jobs/clear-completed', requireLogin, (req, res) => {
  const { user } = req.session;

  const conditions = [`status IN ('completed', 'failed', 'cancelled')`];
  const params = [];
  if (user.role !== 'admin') {
    conditions.push('user_id = ?');
    params.push(user.id);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;

  const jobs = db.prepare(`SELECT id FROM download_jobs ${where}`).all(...params);

  if (jobs.length > 0) {
    db.prepare(`DELETE FROM download_jobs ${where}`).run(...params);
    logEvent(db, {
      userId:   user.id,
      username: user.username,
      action:   'JOB_DELETED',
      target:   `clear-completed (${jobs.length} jobs)`,
      status:   'SUCCESS',
      ip:       req.ip,
    });
  }

  res.json({ deleted: jobs.length });
});

// ── POST /api/jobs/:id/retry ──────────────────────────────────────────────────

router.post('/jobs/:id/retry', requireLogin, (req, res) => {
  const { user } = req.session;
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(Number(req.params.id));
  assertOwner(job, user);

  if (!['failed', 'cancelled'].includes(job.status)) {
    return res.status(409).json({ error: `Can only retry failed or cancelled jobs (status: ${job.status})` });
  }

  const result = db.prepare(`
    INSERT INTO download_jobs (user_id, url, format_spec, output_dir, subfolder)
    VALUES (?, ?, ?, ?, ?)
  `).run(job.user_id, job.url, job.format_spec, job.output_dir, job.subfolder);

  const newJob = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(result.lastInsertRowid);

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'JOB_QUEUED',
    target:   String(newJob.id),
    status:   'SUCCESS',
    ip:       req.ip,
  });

  downloadQueue.tick();
  res.status(201).json(newJob);
});

// ── POST /api/jobs/:id/cancel ─────────────────────────────────────────────────

router.post('/jobs/:id/cancel', requireLogin, (req, res) => {
  const { user } = req.session;
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(Number(req.params.id));
  assertOwner(job, user);

  if (!['pending', 'running', 'paused'].includes(job.status)) {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }

  downloadQueue.cancel(job.id);

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'JOB_CANCELLED',
    target:   String(job.id),
    status:   'SUCCESS',
    ip:       req.ip,
  });

  res.json({ ok: true });
});

// ── POST /api/jobs/:id/pause ──────────────────────────────────────────────────

router.post('/jobs/:id/pause', requireLogin, (req, res) => {
  const { user } = req.session;
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(Number(req.params.id));
  assertOwner(job, user);

  if (job.status !== 'running') {
    return res.status(409).json({ error: `Job is not running (status: ${job.status})` });
  }

  downloadQueue.pause(job.id);
  res.json({ ok: true });
});

// ── POST /api/jobs/:id/resume ─────────────────────────────────────────────────

router.post('/jobs/:id/resume', requireLogin, (req, res) => {
  const { user } = req.session;
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(Number(req.params.id));
  assertOwner(job, user);

  if (job.status !== 'paused') {
    return res.status(409).json({ error: `Job is not paused (status: ${job.status})` });
  }

  downloadQueue.resume(job.id);
  downloadQueue.tick();
  res.json({ ok: true });
});

// ── DELETE /api/jobs/:id ──────────────────────────────────────────────────────

router.delete('/jobs/:id', requireLogin, (req, res) => {
  const { user } = req.session;
  const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(Number(req.params.id));
  assertOwner(job, user);

  if (['running', 'paused'].includes(job.status)) {
    return res.status(409).json({ error: 'Cannot delete a running or paused job. Cancel it first.' });
  }

  db.prepare('DELETE FROM download_jobs WHERE id = ?').run(job.id);

  logEvent(db, {
    userId:   user.id,
    username: user.username,
    action:   'JOB_DELETED',
    target:   String(job.id),
    status:   'SUCCESS',
    ip:       req.ip,
  });

  res.json({ ok: true });
});

export default router;
