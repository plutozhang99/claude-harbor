import path from 'node:path';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { Database } from './db/client.js';
import { migrate } from './db/migrate.js';
import { SqliteMessageRepo, SqliteSessionRepo } from './repo/sqlite.js';
import { dispatch } from './http.js';
import { InMemoryHub } from './ws/hub.js';
import type { Hub } from './ws/hub.js';

export interface ServerDeps {
  readonly config: Config;
  readonly db: Database;
  readonly logger: Logger;
  /** Optional hub — defaults to a new InMemoryHub. Pass your own for testing. */
  readonly hub?: Hub;
  /** Optional absolute path to the web root. Defaults to <cwd>/web. */
  readonly webRoot?: string;
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
  const hub = deps.hub ?? new InMemoryHub();
  const webRoot = path.resolve(deps.webRoot ?? path.join(process.cwd(), 'web'));
  const ctx = { msgRepo, sessRepo, logger, db, hub, config, webRoot };

  const server = Bun.serve({
    port: config.port,
    fetch: (req, bunServer) => {
      const url = new URL(req.url);
      if (
        url.pathname === '/user-socket' &&
        req.headers.get('upgrade')?.toLowerCase() === 'websocket'
      ) {
        const upgraded = bunServer.upgrade(req);
        // Bun's upgrade idiom: return undefined after successful upgrade; cast silences the Response return type.
        if (upgraded) return undefined as unknown as Response;
        return new Response('upgrade failed', { status: 400 });
      }
      return dispatch(req, ctx);
    },
    websocket: {
      open: (ws) => {
        hub.add(ws);
        logger.info('ws_open', { size: hub.size });
      },
      close: (ws) => {
        hub.remove(ws);
        logger.info('ws_close', { size: hub.size });
      },
      message: () => {
        // P1: ignore client → server messages. P2 will handle replies.
      },
    },
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
