import type { Database } from './client.js';
import { SCHEMA_SQL } from './schema.js';

// TODO(P1): introduce schema_version table. IF NOT EXISTS in SCHEMA_SQL
// silently skips column/constraint drift on re-runs against older DBs.
export function migrate(db: Database): void {
  db.exec(SCHEMA_SQL);
}
