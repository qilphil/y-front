import { Router } from 'express';
import { requireLogin } from '../../middleware/auth.js';
import downloadQueue from '../../services/downloadQueue.js';

const router = Router();

router.get('/events', requireLogin, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Keep-alive ping every 25 seconds
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  const emitter = downloadQueue.getEmitter();

  const send = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onProgress   = (d) => send('progress',      d);
  const onStarted    = (d) => send('job:started',   d);
  const onCompleted  = (d) => send('job:completed', d);
  const onFailed     = (d) => send('job:failed',    d);
  const onCancelled  = (d) => send('job:cancelled', d);

  emitter.on('progress',      onProgress);
  emitter.on('job:started',   onStarted);
  emitter.on('job:completed', onCompleted);
  emitter.on('job:failed',    onFailed);
  emitter.on('job:cancelled', onCancelled);

  req.on('close', () => {
    clearInterval(ping);
    emitter.off('progress',      onProgress);
    emitter.off('job:started',   onStarted);
    emitter.off('job:completed', onCompleted);
    emitter.off('job:failed',    onFailed);
    emitter.off('job:cancelled', onCancelled);
  });
});

export default router;
