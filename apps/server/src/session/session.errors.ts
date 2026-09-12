/**
 * Stable domain codes for every typed game-session failure. These values are
 * part of the server's public error contract and must never be renamed casually.
 */

/** Why a session start or lookup failed. */
export const GameSessionErrorCode = {
  /** No live session exists for the room code. */
  SessionNotFound: 'SESSION_NOT_FOUND',
  /** A session is already running for the room code; one session per room. */
  SessionAlreadyExists: 'SESSION_ALREADY_EXISTS',
  /** Room code is blank or otherwise unusable after normalization. */
  InvalidRoomCode: 'INVALID_ROOM_CODE',
  /** The room snapshot is not in the pre-match status a session start requires. */
  InvalidRoomStatus: 'INVALID_ROOM_STATUS',
  /** The room roster is outside 2-6 seats or has duplicate/blank identities. */
  InvalidRoster: 'INVALID_ROSTER',
  /** The injected seed factory did not produce a nonnegative integer seed. */
  InvalidSeed: 'INVALID_SEED',
  /** The command's actor does not match the authenticated player. */
  ActorNotAuthenticated: 'ACTOR_NOT_AUTHENTICATED',
  /** The engine rejected the command semantically; see `engineCode`. */
  EngineRejected: 'ENGINE_REJECTED',
  /** No live round is attached (between rounds or after MATCH_END). */
  NoActiveRound: 'NO_ACTIVE_ROUND',
} as const;

export type GameSessionErrorCode = (typeof GameSessionErrorCode)[keyof typeof GameSessionErrorCode];

/** Typed error carrying a stable {@link GameSessionErrorCode}. */
export class GameSessionError extends Error {
  readonly code: GameSessionErrorCode;

  constructor(code: GameSessionErrorCode, message: string) {
    super(message);
    this.name = 'GameSessionError';
    this.code = code;
  }
}
