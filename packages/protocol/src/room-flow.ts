/**
 * Client-safe canonical protocol seam for the Power Hungry Pets room flow
 * (Milestone 7 vertical slice).
 *
 * This package is the single source of truth for the Socket.IO contract that
 * web clients compile against. `apps/server/src/gateway/contracts.ts` stays
 * the server-side boundary: it re-exports this seam and keeps the game-specific
 * payloads (`game:command`, broadcast views) plus compile-time drift guards
 * that fail the build the moment the server domain types diverge from these
 * client-safe mirrors.
 *
 * Scope guard: this module contains only the room-flow contracts (rooms,
 * seats, lifecycle, create/join/leave/start, ack envelopes). Engine-level game
 * contracts (TurnCommand, public/private game views) stay server-side in
 * `apps/server` and are not imported here, so a web client never pulls in
 * game rules.
 */

// -- Room lifecycle constants -------------------------------------------------

/** Room lifecycle statuses, guarded forward transitions only. */
export const RoomStatus = {
  Created: 'CREATED',
  Lobby: 'LOBBY',
  InMatch: 'IN_MATCH',
  Finished: 'FINISHED',
  Expired: 'EXPIRED',
} as const;

export type RoomStatus = (typeof RoomStatus)[keyof typeof RoomStatus];

/** Maximum number of seats per room (2–6 players play; 6 is the hard cap). */
export const MAX_SEATS_PER_ROOM = 6;

/** Minimum seats that must be occupied before a room may enter IN_MATCH. */
export const MIN_SEATS_TO_START_MATCH = 2;

/** Safe upper bound for a normalized display name. */
export const MAX_DISPLAY_NAME_LENGTH = 24;

/** Length of generated room codes (5 chars over a 32-symbol alphabet). */
export const ROOM_CODE_LENGTH = 5;

/**
 * Unambiguous uppercase room-code alphabet: Crockford base32 — digits 0-9
 * plus A-Z without I, L, O, U. Room codes are matchmaking handles, not
 * security credentials.
 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// -- Room views ---------------------------------------------------------------

/** Public, safe view of one seat in a room. Never carries token material. */
export interface RoomPlayerView {
  /** Stable crypto-random player id; independent of socket ids. */
  playerId: string;
  /** Trimmed, whitespace-collapsed display name. */
  displayName: string;
  /** 1-based seat assignment order within the room. */
  seatNumber: number;
  /** Transport overlay: true only while a socket is currently bound. */
  connected: boolean;
  /** Whether this seat is the current room host. */
  isHost: boolean;
  /** Epoch-ms timestamp of when the seat joined. */
  joinedAt: number;
}

/** Deep-copied public snapshot of a room. Safe to hand to any client. */
export interface RoomSnapshot {
  /** Internal room id (not the join code). */
  roomId: string;
  /** Short uppercase unambiguous join code. */
  code: string;
  /** Current guarded lifecycle status. */
  status: RoomStatus;
  /** Player id of the current host. */
  hostPlayerId: string;
  /** Epoch-ms room creation timestamp. */
  createdAt: number;
  /** Seats ordered by join order. */
  players: RoomPlayerView[];
}

// -- Socket event names ---------------------------------------------------------

/** Event names sent by clients to the server. */
export const ClientEvents = {
  systemPing: 'system:ping',
  roomCreate: 'room:create',
  roomJoin: 'room:join',
  roomLeave: 'room:leave',
  roomStart: 'room:start',
  gameCommand: 'game:command',
} as const;

export type ClientEventName = (typeof ClientEvents)[keyof typeof ClientEvents];

/** Event names sent by the server to clients. */
export const ServerEvents = {
  systemNotice: 'system:notice',
  roomUpdated: 'room:updated',
  gameEvent: 'game:event',
  gamePublicState: 'game:public-state',
  gamePrivateState: 'game:private-state',
  matchEnded: 'match:ended',
} as const;

export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];

// -- Room-flow request/data contracts -------------------------------------------

/** Payload sent by a client for the `system:ping` event. */
export interface SystemPingRequest {
  /** Arbitrary client timestamp echoed back in the acknowledgement. */
  sentAt?: number;
}

/** Data returned in a successful `system:ping` acknowledgement. */
export interface SystemPingData {
  /** Always `true` on success; proves the round trip completed. */
  pong: boolean;
  /** Server clock in epoch milliseconds when the ping was handled. */
  serverTime: number;
  /** Echo of the client-provided `sentAt`, when present. */
  echoedAt?: number;
}

/** Payload sent by a client for the `room:create` event. */
export interface RoomCreateRequest {
  displayName: string;
}

/** Data returned in a successful `room:create` acknowledgement. */
export interface RoomCreateData {
  roomId: string;
  code: string;
  playerId: string;
  seatNumber: number;
  /** Raw reconnect token, handed to the creator exactly once. */
  reconnectToken: string;
  /** Fresh public room snapshot at LOBBY status. */
  room: RoomSnapshot;
}

/** Payload sent by a client for the `room:join` event. */
export interface RoomJoinRequest {
  code: string;
  /** Required for a brand-new seat; ignored when `reconnectToken` is present. */
  displayName?: string;
  /** Present only when rebinding a disconnected seat (never creates a seat). */
  reconnectToken?: string;
}

/** Data returned in a successful `room:join` acknowledgement. */
export interface RoomJoinData {
  roomId: string;
  code: string;
  playerId: string;
  seatNumber: number;
  /** Raw reconnect token for a new seat; `null` on a token rebind. */
  reconnectToken: string | null;
  /** Fresh public room snapshot. */
  room: RoomSnapshot;
}

/** Payload sent by a client for the `room:leave` event. */
export interface RoomLeaveRequest {
  code: string;
}

/** Data returned in a successful `room:leave` acknowledgement. */
export interface RoomLeaveData {
  /** Remaining room snapshot, or `null` when the leaving seat was the last. */
  room: RoomSnapshot | null;
}

/** Payload sent by a client for the `room:start` event. */
export interface RoomStartRequest {
  code: string;
}

/**
 * Data returned in a successful `room:start` acknowledgement: the fresh room
 * snapshot at IN_MATCH status plus the initial public game view from the
 * client-safe game projection seam (`./game`).
 */
export interface RoomStartData {
  /** Room snapshot at IN_MATCH status. */
  room: RoomSnapshot;
  /** Initial public view of the first deal. */
  publicView: import('./game').PublicGameView;
}

/** `room:updated` broadcast payload: safe room snapshot, no token material. */
export interface RoomUpdatedEvent {
  room: RoomSnapshot;
}

// -- Error contract ---------------------------------------------------------------

/**
 * Mirror of the stable public error codes a room-flow client can observe on a
 * failed acknowledgement. Values must never be renamed casually; the server
 * boundary carries compile-time witnesses asserting this union stays in sync
 * with the server's own error unions.
 */
export const RoomFlowErrorCode = {
  // Gateway-boundary generic codes.
  InvalidPayload: 'INVALID_PAYLOAD',
  InternalError: 'INTERNAL_ERROR',
  RateLimited: 'RATE_LIMITED',
  NotImplemented: 'NOT_IMPLEMENTED',
  // Room domain codes.
  RoomNotFound: 'ROOM_NOT_FOUND',
  RoomFull: 'ROOM_FULL',
  DuplicateSocket: 'DUPLICATE_SOCKET',
  InvalidReconnectToken: 'INVALID_RECONNECT_TOKEN',
  InvalidDisplayName: 'INVALID_DISPLAY_NAME',
  InvalidRoomTransition: 'INVALID_ROOM_TRANSITION',
  NotHost: 'NOT_HOST',
  PlayerNotFound: 'PLAYER_NOT_FOUND',
  SocketNotBound: 'SOCKET_NOT_BOUND',
  RoomCodeGenerationFailed: 'ROOM_CODE_GENERATION_FAILED',
  // Game-session codes observable through room-flow acks.
  SessionNotFound: 'SESSION_NOT_FOUND',
  SessionAlreadyExists: 'SESSION_ALREADY_EXISTS',
  InvalidRoomCode: 'INVALID_ROOM_CODE',
  InvalidRoomStatus: 'INVALID_ROOM_STATUS',
  InvalidRoster: 'INVALID_ROSTER',
  InvalidSeed: 'INVALID_SEED',
  ActorNotAuthenticated: 'ACTOR_NOT_AUTHENTICATED',
  EngineRejected: 'ENGINE_REJECTED',
  NoActiveRound: 'NO_ACTIVE_ROUND',
  // Public-event sanitizer codes.
  UnknownEventType: 'UNKNOWN_EVENT_TYPE',
  UnknownPublicEvent: 'UNKNOWN_PUBLIC_EVENT',
  // Engine projection codes.
  PlayerNotInGame: 'PLAYER_NOT_IN_GAME',
  UnknownPendingInteraction: 'UNKNOWN_PENDING_INTERACTION',
} as const;

export type RoomFlowErrorCode = (typeof RoomFlowErrorCode)[keyof typeof RoomFlowErrorCode];

/** Client-facing alias for the room-flow acknowledgement error union. */
export type AckErrorCode = RoomFlowErrorCode;

/**
 * Discriminated union for every server acknowledgement.
 *
 * `Extra` is a server-side extension point: the game gateway widens the
 * failure error with the optional engine detail `engineCode`, which stays a
 * game contract in `apps/server` and never reaches this room-flow seam.
 */
export type AckEnvelope<
  TData,
  E extends string = RoomFlowErrorCode,
  Extra extends object = Record<never, never>,
> = { ok: true; data: TData } | { ok: false; error: { code: E; message: string } & Extra };
