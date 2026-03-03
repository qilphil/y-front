import 'dotenv/config';
import app from './app.js';
import { db } from './db.js';
import downloadQueue from './services/downloadQueue.js';
import { hookJobEvents, startScheduler } from './services/subscriptionService.js';
import config from './config.js';

const server = app.listen(config.PORT, '::', () => {
  console.log(`[SERVER] Listening on port ${config.PORT} (IPv4+IPv6)`);
});

downloadQueue.start();
hookJobEvents(downloadQueue.getEmitter());
startScheduler();

const shutdown = async (signal) => {
  console.log(`[SHUTDOWN] Received ${signal}. Closing server...`);
  await downloadQueue.shutdown();
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed.');
    db.close();
    console.log('[SHUTDOWN] Database connection closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
