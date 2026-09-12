/**
 * Typed room domain contracts for the in-memory room registry.
 *
 * These types are the public surface of the registry: snapshots are plain,
 * deep-copied views that never contain reconnect tokens or token hashes.
 */

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
 * plus A-Z without I, L, O, U. Exactly 32 symbols, and every glyph maps to
 * exactly one symbol because all lookalikes (O vs 0, I/L vs 1, U vs V) are
 * excluded. Room codes are matchmaking handles, not security credentials.
 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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

/** Deep-copied public snapshot of a room. Safe to hand to any caller. */
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

/** Result of a successful create or join: what only the acting client gets. */
export interface RoomMembership {
  /** Internal room id. */
  roomId: string;
  /** Room join code. */
  code: string;
  /** Stable crypto-random player id for the new seat. */
  playerId: string;
  /** 1-based seat number assigned to the new player. */
  seatNumber: number;
  /**
   * Raw reconnect token, returned exactly once to the joining client.
   * The registry retains only its SHA-256 hash.
   */
  reconnectToken: string;
}

/** Result of a successful reconnect seat rebind (no new token is issued). */
export interface ReconnectResult {
  roomId: string;
  code: string;
  /** Player id of the rebind seat (unchanged from the original join). */
  playerId: string;
  seatNumber: number;
}

/** Input for creating a room. */
export interface CreateRoomInput {
  displayName: string;
  socketId: string;
}

/** Input for joining an existing room by code. */
export interface JoinRoomInput {
  code: string;
  displayName: string;
  socketId: string;
}

/** Input for rebinding a disconnected seat via its reconnect token. */
export interface ReconnectSeatInput {
  code: string;
  /** Raw reconnect token issued at create/join time. */
  reconnectToken: string;
  /** New socket id to bind to the existing seat. */
  socketId: string;
}

/** Input for marking a bound socket disconnected. */
export interface DisconnectSeatInput {
  code: string;
  socketId: string;
}

/**
 * Input for an explicit seat leave, authenticated by the socket currently
 * bound to a seat in the target room — never by a caller-supplied public
 * playerId, so one player cannot evict another.
 */
export interface LeaveRoomInput {
  code: string;
  /** Socket id of the leaver; must be bound to a seat in this room. */
  socketId: string;
}

/** Input for a host-driven room status transition. */
export interface TransitionRoomInput {
  code: string;
  /** Caller player id; must be the current host. */
  playerId: string;
  nextStatus: RoomStatus;
}

/**
 * Safe view of one socket-to-seat binding for server-internal fanout. Never
 * carries token material — the registry retains only token hashes.
 */
export interface SocketBindingView {
  socketId: string;
  code: string;
  playerId: string;
}

/**
 * Injectable factories used by tests to force code collisions and token
 * shapes deterministically. Production defaults are crypto-strong and are
 * never weakened by these hooks.
 */
export interface RoomRegistryOptions {
  /** Room-code generator; must return codes comparable to live room codes. */
  generateRoomCode?: () => string;
  /** Reconnect-token generator; must return high-entropy opaque strings. */
  generateReconnectToken?: () => string;
}
