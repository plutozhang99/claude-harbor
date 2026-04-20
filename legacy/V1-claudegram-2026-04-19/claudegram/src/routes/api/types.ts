import type { SessionListItem, Message } from '../../repo/types.js';

export interface ApiSessionsResponse {
  readonly ok: true;
  readonly sessions: readonly SessionListItem[];
}

export interface ApiMessagesResponse {
  readonly ok: true;
  readonly messages: readonly Message[];
  readonly has_more: boolean;
}

export interface ApiMeResponse {
  readonly ok: true;
  readonly email: string;
}

export interface ApiError {
  readonly ok: false;
  readonly error: string;
  readonly issues?: readonly unknown[];
}
