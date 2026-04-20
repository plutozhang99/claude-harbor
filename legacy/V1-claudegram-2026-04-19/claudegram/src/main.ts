import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { openDatabase, closeDatabase } from './db/client.js';
import { createServer } from './server.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────

const config = loadConfig();
const logger = createLogger({ level: config.log_level });

// Ensure the data directory exists for file-based DBs.
if (config.db_path !== ':memory:') {
  mkdirSync(dirname(config.db_path), { recursive: true });
}

const db = openDatabase(config.db_path);
const server = createServer({ config, db, logger });

logger.info('server_ready', { port: server.port });

// ── Graceful shutdown ──────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('shutdown_start', { signal });

  try {
    await server.stop(true);
    closeDatabase(db);
    logger.info('shutdown_complete', {});
  } catch (err) {
    logger.error('shutdown_error', { err: String(err) });
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });
