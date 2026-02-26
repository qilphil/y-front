import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/files', requireLogin, (req, res) => {
  res.render('files', { title: 'Files', dir: req.query.dir || '' });
});

export default router;
