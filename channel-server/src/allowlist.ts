import type { PermissionCategory } from '@claudegram/shared'

// ─── Session-scoped permission allowlist ─────────────────────────────────────

/**
 * Abstract contract for the per-session "yes_all" allowlist.
 *
 * Defined as a separate interface so that Phase 2D unit tests can inject a
 * mock implementation into PermissionContext without depending on the
 * concrete in-memory class.
 */
export interface ISessionPermissionAllowlist {
  has(category: PermissionCategory): boolean
  add(category: PermissionCategory): void
  size(): number
  toArray(): readonly PermissionCategory[]
}

/**
 * In-memory allowlist for "yes_all" decisions within a single session.
 *
 * Rules:
 * - Entries are added when the user approves all future requests for a category.
 * - There is no removal — the allowlist persists for the entire session lifetime.
 * - There is no serialisation — if the channel-server process restarts, the
 *   allowlist resets (per Phase 4B v0.2 decision: nothing persists).
 */
export class SessionPermissionAllowlist implements ISessionPermissionAllowlist {
  private readonly allowed = new Set<PermissionCategory>()

  /** Returns true if the given category has been granted blanket approval. */
  has(category: PermissionCategory): boolean {
    return this.allowed.has(category)
  }

  /** Adds a category to the allowlist.  Idempotent — safe to call multiple times. */
  add(category: PermissionCategory): void {
    this.allowed.add(category)
  }

  /** Number of categories currently in the allowlist. */
  size(): number {
    return this.allowed.size
  }

  /** Returns a readonly snapshot of the current allowlist entries. */
  toArray(): readonly PermissionCategory[] {
    return Array.from(this.allowed)
  }
}
