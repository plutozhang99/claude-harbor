export interface Message {
  readonly session_id: string;
  readonly id: string;
  readonly direction: 'assistant' | 'user';
  readonly ts: number;
  readonly ingested_at: number;
  readonly content: string;
}

export interface Session {
  readonly id: string;
  readonly name: string;
  readonly first_seen_at: number;
  readonly last_seen_at: number;
}

export type MessageInsert = Omit<Message, 'ingested_at'> & { readonly ingested_at?: number };

export type SessionUpsert = Pick<Session, 'id' | 'name'> & { readonly now: number };

export interface MessageRepo {
  insert(msg: MessageInsert): void;
  findBySession(session_id: string, opts?: { before?: number; limit?: number }): ReadonlyArray<Message>;
}

export interface SessionRepo {
  upsert(s: SessionUpsert): void;
  findById(id: string): Readonly<Session> | null;
}
