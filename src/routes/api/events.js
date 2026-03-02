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

  const onProgress     = (d) => send('progress',      d);
  const onStarted      = (d) => send('job:started',   d);
  const onCompleted    = (d) => send('job:completed', d);
  const onFailed       = (d) => send('job:failed',    d);
  const onCancelled    = (d) => send('job:cancelled', d);
  const onFilesChanged  = (d) => send('files:changed',  d);
  const onYtdlpOutput   = (d) => send('ytdlp:output',   d);
  const onYtdlpDone     = (d) => send('ytdlp:done',     d);
  const onUvOutput      = (d) => send('uv:output',      d);
  const onUvDone        = (d) => send('uv:done',        d);

  emitter.on('progress',      onProgress);
  emitter.on('job:started',   onStarted);
  emitter.on('job:completed', onCompleted);
  emitter.on('job:failed',    onFailed);
  emitter.on('job:cancelled', onCancelled);
  emitter.on('files:changed', onFilesChanged);
  emitter.on('ytdlp:output',  onYtdlpOutput);
  emitter.on('ytdlp:done',    onYtdlpDone);
  emitter.on('uv:output',     onUvOutput);
  emitter.on('uv:done',       onUvDone);

  req.on('close', () => {
    clearInterval(ping);
    emitter.off('progress',      onProgress);
    emitter.off('job:started',   onStarted);
    emitter.off('job:completed', onCompleted);
    emitter.off('job:failed',    onFailed);
    emitter.off('job:cancelled', onCancelled);
    emitter.off('files:changed', onFilesChanged);
    emitter.off('ytdlp:output',  onYtdlpOutput);
    emitter.off('ytdlp:done',    onYtdlpDone);
    emitter.off('uv:output',     onUvOutput);
    emitter.off('uv:done',       onUvDone);
  });
});

export default router;
