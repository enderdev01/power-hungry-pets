/**
 * Acknowledgement error handling: every server error code a room-flow client
 * can observe maps to a human sentence and a recovery path. Legality stays
 * server-side; this only explains the server's verdict to the player.
 */
import type { ErrorRecovery } from './reducer';

export interface DescribedAckError {
  sentence: string;
  recovery: ErrorRecovery;
}

const DESCRIPTIONS: Record<string, DescribedAckError> = {
  INVALID_PAYLOAD: {
    sentence: 'The server rejected the request shape — try again.',
    recovery: 'retry',
  },
  INTERNAL_ERROR: {
    sentence: 'Unexpected server error — try again.',
    recovery: 'retry',
  },
  RATE_LIMITED: {
    sentence: 'Too many join attempts — wait a minute and try again.',
    recovery: 'retry',
  },
  NOT_IMPLEMENTED: {
    sentence: 'That part is not built yet.',
    recovery: 'none',
  },
  ROOM_NOT_FOUND: {
    sentence: 'No live room with that code — check the code or pin a new room.',
    recovery: 'edit-input',
  },
  ROOM_FULL: {
    sentence: 'That room already holds the maximum of 6 players.',
    recovery: 'edit-input',
  },
  DUPLICATE_SOCKET: {
    sentence: 'This tab already holds a seat — leave the current room first.',
    recovery: 'none',
  },
  INVALID_RECONNECT_TOKEN: {
    sentence: 'Your seat could not be restored — join the room again.',
    recovery: 'edit-input',
  },
  INVALID_DISPLAY_NAME: {
    sentence: 'Pick a display name of 1–24 characters.',
    recovery: 'edit-input',
  },
  INVALID_ROOM_TRANSITION: {
    sentence: 'That move is not allowed for the room right now.',
    recovery: 'none',
  },
  NOT_HOST: {
    sentence: 'Only the room host can start the match.',
    recovery: 'none',
  },
  PLAYER_NOT_FOUND: {
    sentence: 'Your seat is not part of this room.',
    recovery: 'edit-input',
  },
  SOCKET_NOT_BOUND: {
    sentence: 'This tab lost its seat binding — join the room again.',
    recovery: 'edit-input',
  },
  ROOM_CODE_GENERATION_FAILED: {
    sentence: 'The server could not mint a room code — try again.',
    recovery: 'retry',
  },
  INVALID_ROOM_CODE: {
    sentence: 'That room code is not usable.',
    recovery: 'edit-input',
  },
  SESSION_NOT_FOUND: {
    sentence: 'No live match session for this room — start it from the lobby.',
    recovery: 'retry',
  },
  SESSION_ALREADY_EXISTS: {
    sentence: 'A match session already runs for this room.',
    recovery: 'none',
  },
  INVALID_ROOM_STATUS: {
    sentence: 'The room is not in the stage that action needs.',
    recovery: 'retry',
  },
  INVALID_ROSTER: {
    sentence: 'The room roster is not valid for that action.',
    recovery: 'retry',
  },
  INVALID_SEED: {
    sentence: 'The server could not seed the match — try again.',
    recovery: 'retry',
  },
  ACTOR_NOT_AUTHENTICATED: {
    sentence: 'This tab is not authorized for that action.',
    recovery: 'edit-input',
  },
  ENGINE_REJECTED: {
    sentence: 'The game rules rejected that move.',
    recovery: 'none',
  },
  NO_ACTIVE_ROUND: {
    sentence: 'No live round is running right now.',
    recovery: 'none',
  },
  UNKNOWN_EVENT_TYPE: {
    sentence: 'The server refused an unknown event type.',
    recovery: 'retry',
  },
  UNKNOWN_PUBLIC_EVENT: {
    sentence: 'The server refused a malformed game event.',
    recovery: 'retry',
  },
  PLAYER_NOT_IN_GAME: {
    sentence: 'Your seat is not part of the live match.',
    recovery: 'edit-input',
  },
  UNKNOWN_PENDING_INTERACTION: {
    sentence: 'The pending decision is no longer open.',
    recovery: 'retry',
  },
};

/** Maps a stable server error code to a human sentence and recovery path. */
export function describeAckError(code: string): DescribedAckError {
  return (
    DESCRIPTIONS[code] ?? {
      sentence: `The server refused the request (${code}) — try again.`,
      recovery: 'retry',
    }
  );
}
