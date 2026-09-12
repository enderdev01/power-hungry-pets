/**
 * Stable domain codes for every typed room failure. These values are part of
 * the server's public error contract and must never be renamed casually.
 */
export const RoomErrorCode = {
  /** Room code does not match any live room. */
  RoomNotFound: 'ROOM_NOT_FOUND',
  /** Join rejected because the room already holds the maximum number of seats. */
  RoomFull: 'ROOM_FULL',
  /** Socket id is already bound to a seat (in this or another room). */
  DuplicateSocket: 'DUPLICATE_SOCKET',
  /** Reconnect token does not match any seat in the room. */
  InvalidReconnectToken: 'INVALID_RECONNECT_TOKEN',
  /** Display name is blank, oversized, or otherwise unusable after normalization. */
  InvalidDisplayName: 'INVALID_DISPLAY_NAME',
  /** Room status transition is not allowed from the current status. */
  InvalidRoomTransition: 'INVALID_ROOM_TRANSITION',
  /** Operation requires the host and the caller is not the host. */
  NotHost: 'NOT_HOST',
  /** Player id does not match any seat in the room. */
  PlayerNotFound: 'PLAYER_NOT_FOUND',
  /**
   * Socket is not bound to a seat in the target room: unbound entirely or
   * bound to a different room. Used to authenticate explicit leaves.
   */
  SocketNotBound: 'SOCKET_NOT_BOUND',
  /**
   * Code generation failed: a generated candidate was invalid (wrong length
   * or disallowed symbol) or bounded collision retries were exhausted.
   */
  RoomCodeGenerationFailed: 'ROOM_CODE_GENERATION_FAILED',
} as const;

export type RoomErrorCode = (typeof RoomErrorCode)[keyof typeof RoomErrorCode];

/** Typed error carrying a stable {@link RoomErrorCode}. */
export class RoomError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}
