import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { Database } from './db/client.js';
import { migrate } from './db/migrate.js';
import { SqliteMessageRepo, SqliteSessionRepo } from './repo/sqlite.js';
import { dispatch } from './http.js';

export interface ServerDeps {
  readonly config: Config;
  readonly db: Database;
  readonly logger: Logger;
}

export interface RunningServer {
  readonly port: number;
  stop(drain?: boolean): Promise<void>;
}

export function createServer(deps: ServerDeps): RunningServer {
  const { config, db, logger } = deps;

  // Run migrations synchronously before binding the socket.
  migrate(db);

  const msgRepo = new SqliteMessageRepo(db);
  const sessRepo = new SqliteSessionRepo(db);
  const ctx = { msgRepo, sessRepo, logger, db };

  const server = Bun.serve({
    port: config.port,
    fetch: (req) => dispatch(req, ctx),
    error: (err) => {
      logger.error('unhandled', { err: String(err) });
      return new Response('internal error', { status: 500 });
    },
  });

  return {
    get port() { return server.port as number; },
    stop: (drain = true) => server.stop(drain),
  };
}
