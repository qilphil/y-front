import { Router } from 'express';
import { readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();

router.get('/filesystem', requireAdmin, async (req, res) => {
  const rawPath = (req.query.path || '/').toString();
  const absPath = resolve(rawPath); // normalises .. etc.

  try {
    const dirents = await readdir(absPath, { withFileTypes: true });

    const entries = dirents
      .filter((d) => !d.isSymbolicLink()) // never follow symlinks
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? 'directory' : 'file',
        path: join(absPath, d.name),
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const parent = dirname(absPath);

    res.json({
      path:    absPath,
      parent:  parent === absPath ? null : parent, // null at filesystem root
      entries,
    });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Path not found' });
    }
    if (err.code === 'ENOTDIR') {
      return res.status(400).json({ error: 'Not a directory' });
    }
    throw err;
  }
});

export default router;
