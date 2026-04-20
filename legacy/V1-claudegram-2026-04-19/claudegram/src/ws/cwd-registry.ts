/**
 * CwdRegistry — in-memory map from fakechat process cwd to claudegram session_id.
 *
 * Populated by the `register` frame on /session-socket when fakechat includes
 * its `cwd`. Consumed by the /internal/statusline route to translate a Claude
 * Code statusline POST (keyed by the CC session UUID + cwd) into the
 * claudegram-side session_id so the broadcast reaches the right PWA session.
 *
 * Not persisted — lives for the lifetime of the process. On process restart,
 * fakechat re-registers and repopulates the map.
 */
export interface CwdRegistry {
  /** Associate `cwd` with `session_id`. Replaces any prior mapping for that cwd. */
  set(cwd: string, session_id: string): void;
  /** Resolve `cwd` back to the most recently registered session_id. */
  lookup(cwd: string): string | undefined;
  /** Drop any mapping that points at `session_id` (called on /session-socket close). */
  clearBySession(session_id: string): void;
  readonly size: number;
}

export class InMemoryCwdRegistry implements CwdRegistry {
  private readonly byCwd = new Map<string, string>();

  set(cwd: string, session_id: string): void {
    this.byCwd.set(cwd, session_id);
  }

  lookup(cwd: string): string | undefined {
    return this.byCwd.get(cwd);
  }

  clearBySession(session_id: string): void {
    for (const [cwd, sid] of this.byCwd) {
      if (sid === session_id) {
        this.byCwd.delete(cwd);
      }
    }
  }

  get size(): number {
    return this.byCwd.size;
  }
}
