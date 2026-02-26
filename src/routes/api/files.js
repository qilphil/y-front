import { Router } from 'express';
import { existsSync, statSync, readdirSync, createReadStream, unlinkSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';
import { requireLogin } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/auth.js';
import { db } from '../../db.js';

const router = Router();

const getBase = () => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_download_path'").get();
  return resolve(row?.value || '/');
};

const safeResolve = (base, rel) => {
  const abs = resolve(join(base, rel || ''));
  const norm = base.endsWith('/') ? base : base + '/';
  if (abs !== base && !abs.startsWith(norm)) throw new Error('Path outside download directory');
  return abs;
};

// ── GET /api/files/list?dir= ──────────────────────────────────────────────────

router.get('/files/list', requireLogin, (req, res) => {
  try {
    const base = getBase();
    const abs  = safeResolve(base, req.query.dir || '');
    if (!existsSync(abs)) return res.status(404).json({ error: 'Directory not found' });
    const st = statSync(abs);
    if (!st.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile() || e.isDirectory())
      .flatMap((e) => {
        const fp = join(abs, e.name);
        try {
          const s = statSync(fp);
          if (e.isDirectory()) {
            let count = 0;
            try { count = readdirSync(fp).length; } catch {}
            return [{ name: e.name, type: 'dir', size: null, mtime: s.mtimeMs, count }];
          }
          return [{ name: e.name, type: 'file', size: s.size, mtime: s.mtimeMs, count: null }];
        } catch { return []; }
      });

    res.json({
      dir:    relative(base, abs) || '',
      parent: abs === base ? null : (relative(base, resolve(abs, '..')) || ''),
      entries,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/files/recent ─────────────────────────────────────────────────────

router.get('/files/recent', requireLogin, (req, res) => {
  try {
    const base = getBase();
    if (!existsSync(base)) return res.json({ files: [] });

    const files = [];

    const scanDir = (dirAbs, prefix) => {
      try {
        readdirSync(dirAbs, { withFileTypes: true }).forEach((e) => {
          const fp  = join(dirAbs, e.name);
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          try {
            if (e.isFile()) {
              const s = statSync(fp);
              files.push({ name: e.name, path: rel, size: s.size, mtime: s.mtimeMs });
            } else if (e.isDirectory() && !prefix) {
              scanDir(fp, e.name); // one level deep only
            }
          } catch {}
        });
      } catch {}
    };

    scanDir(base, '');
    files.sort((a, b) => b.mtime - a.mtime);
    res.json({ files: files.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/files/download?path= ─────────────────────────────────────────────

router.get('/files/download', requireLogin, (req, res) => {
  try {
    const base = getBase();
    const abs  = safeResolve(base, req.query.path || '');
    if (!existsSync(abs)) return res.status(404).json({ error: 'File not found' });
    const st = statSync(abs);
    if (!st.isFile()) return res.status(400).json({ error: 'Not a file' });

    const name = basename(abs);
    res.setHeader('Content-Type',        'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Length',      st.size);

    const stream = createReadStream(abs);
    stream.on('error', () => { if (!res.destroyed) res.destroy(); });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/files/delete?path= ───────────────────────────────────────────

router.delete('/files/delete', requireAdmin, (req, res) => {
  try {
    const base = getBase();
    const abs  = safeResolve(base, req.query.path || '');
    if (!existsSync(abs)) return res.status(404).json({ error: 'File not found' });
    const st = statSync(abs);
    if (!st.isFile()) return res.status(400).json({ error: 'Only files can be deleted' });
    unlinkSync(abs);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
