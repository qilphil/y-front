import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validationResult } from 'express-validator';
import { requireLogin } from '../../middleware/auth.js';
import { analyseUrl } from '../../services/ytdlp.js';
import { validateAnalyseQuery } from '../../validators/jobValidators.js';
import config from '../../config.js';

const router = Router();

const analyseLimiter = rateLimit({
  windowMs: config.ANALYSE_RATE_LIMIT.windowMs,
  max:      config.ANALYSE_RATE_LIMIT.max,
  message:  'Too many analyse requests. Please slow down.',
  standardHeaders: true,
  legacyHeaders:   false,
});

router.get('/analyse', requireLogin, analyseLimiter, validateAnalyseQuery, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const result = await analyseUrl(req.query.url);
    res.json(result);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

export default router;
