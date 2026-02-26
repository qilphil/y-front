import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/add', requireLogin, (req, res) => {
  res.render('add', { title: 'Add Download' });
});

export default router;
