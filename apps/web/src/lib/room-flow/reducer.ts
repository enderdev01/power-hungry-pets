/**
 * Room-flow state: pure, framework-free reducer for the Milestone 7 vertical
 * slice (create/join/lobby). React renders this state and never makes
 * game-rule decisions; the server stays authoritative for legality.
 *
 * The reducer also derives the room's textual confirmation log: every
 * connection action produces an immediate, visible sentence.
 */
import { describeAckError } from './ack-errors';
import { createInitialGameState, gameReducer, type GameState } from '@/lib/game/game-reducer';
import type { RoomSnapshot } from '@power-hungry-pets/protocol';

/** Transport overlay states this tab can be in. */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export type NoticeTone = 'info' | 'success' | 'error';

/** One textual confirmation line in the room notice log. */
export interface FlowNotice {
  id: number;
  text: string;
  tone: NoticeTone;
}

/** This tab's seat in a room. Never carries token material. */
export interface SeatIdentity {
  playerId: string;
  seatNumber: number;
}

/** Action kinds this tab can attempt (and retry after a failure). */
export type AttemptAction =
  | 'create'
  | 'join'
  | 'rebind'
  | 'start'
  | 'leave'
  | 'return-lobby'
  | 'draw'
  | 'play'
  | 'choose-target'
  | 'submit-guess'
  | 'choose-hidden-swap'
  | 'choose-deck-position';

/** What the player should do next after a failed attempt. */
export type ErrorRecovery = 'retry' | 'edit-input' | 'rejoin' | 'none';

/** The last attempt, kept so a recovery control can replay it. */
export interface Attempt {
  action: AttemptAction;
  code?: string;
  displayName?: string;
  /** Exact card instance id for a retried play command. */
  cardInstanceId?: string;
  /** Exact target id for a retried targeted play or choose-target command. */
  targetId?: string;
  /** Exact guess value for a retried submit-guess command. */
  value?: number;
  /** Exact swap answer for a retried choose-hidden-swap command. */
  swap?: boolean;
  /** Exact deck index for a retried choose-deck-position command. */
  index?: number;
}

/** A typed, human-facing server failure. */
export interface FlowError {
  action: AttemptAction;
  code: string;
  message: string;
  sentence: string;
  recovery: ErrorRecovery;
}

/** Membership result as this tab may hold it — never includes token material. */
export interface MembershipResult {
  roomId: string;
  code: string;
  playerId: string;
  seatNumber: number;
  room: RoomSnapshot;
}

export interface RoomFlowState {
  connection: ConnectionStatus;
  room: RoomSnapshot | null;
  /** Room code this tab is seated in, if any. */
  roomCode: string | null;
  self: SeatIdentity | null;
  busy: AttemptAction | null;
  error: FlowError | null;
  pendingAttempt: Attempt | null;
  notices: FlowNotice[];
  nextNoticeId: number;
  /** Game-table projections for the seated room; server-authored only. */
  game: GameState;
}

export type RoomFlowAction =
  | { type: 'connection/status'; status: ConnectionStatus }
  | { type: 'membership/created'; membership: MembershipResult }
  | { type: 'membership/joined'; membership: MembershipResult; rejoined: boolean }
  | { type: 'room/updated'; room: RoomSnapshot }
  | { type: 'room/left'; room: RoomSnapshot | null }
  | { type: 'ack/failed'; attempt: Attempt; code: string; message: string }
  | { type: 'seat/invalidated' }
  | { type: 'room/switched' }
  | { type: 'busy/started'; action: AttemptAction }
  | { type: 'busy/cleared' }
  | { type: 'error/cleared' }
  | import('@/lib/game/game-reducer').GameAction;

const NOTICE_LOG_LIMIT = 30;

export function createInitialRoomFlowState(): RoomFlowState {
  return {
    connection: 'idle',
    room: null,
    roomCode: null,
    self: null,
    busy: null,
    error: null,
    pendingAttempt: null,
    notices: [],
    nextNoticeId: 1,
    game: createInitialGameState(),
  };
}

/** Appends a textual confirmation, keeping the log bounded. */
function withNotice(state: RoomFlowState, text: string, tone: NoticeTone): RoomFlowState {
  const notice: FlowNotice = { id: state.nextNoticeId, text, tone };
  return {
    ...state,
    notices: [...state.notices, notice].slice(-NOTICE_LOG_LIMIT),
    nextNoticeId: state.nextNoticeId + 1,
  };
}

/**
 * Lobby diff notices: turns a fresh room snapshot into human sentences about
 * what visibly changed for this tab (arrivals, transport overlays, host
 * transfers, departures, lifecycle status).
 */
function roomDiffNotices(prev: RoomSnapshot | null, next: RoomSnapshot): string[] {
  if (prev === null || prev.roomId !== next.roomId) {
    return [];
  }
  const notices: string[] = [];
  const prevById = new Map(prev.players.map((p) => [p.playerId, p]));
  for (const player of next.players) {
    const before = prevById.get(player.playerId);
    if (before === undefined) {
      notices.push(`${player.displayName} llegó (asiento ${player.seatNumber}).`);
      continue;
    }
    if (!before.connected && player.connected) {
      notices.push(`${player.displayName} volvió.`);
    }
    if (before.connected && !player.connected) {
      notices.push(`${player.displayName} se desconectó.`);
    }
    if (!before.isHost && player.isHost) {
      notices.push(`${player.displayName} ahora es el anfitrión de la sala.`);
    }
  }
  for (const player of prev.players) {
    if (!next.players.some((candidate) => candidate.playerId === player.playerId)) {
      notices.push(`${player.displayName} salió de la sala.`);
    }
  }
  if (prev.status !== next.status) {
    if (next.status === 'IN_MATCH') {
      notices.push('La partida comenzó.');
    } else if (next.status === 'FINISHED') {
      notices.push('La partida terminó.');
    }
  }
  return notices;
}

export function roomFlowReducer(state: RoomFlowState, action: RoomFlowAction): RoomFlowState {
  switch (action.type) {
    case 'game/public-state':
    case 'game/private-state':
    case 'game/events':
    case 'game/match-ended':
    case 'game/cleared':
      return { ...state, game: gameReducer(state.game, action) };

    case 'connection/status': {
      if (state.connection === action.status) {
        return state;
      }
      let next: RoomFlowState = { ...state, connection: action.status };
      if (action.status === 'connecting' && state.connection === 'idle') {
        next = withNotice(next, 'Conectando con el servidor del juego…', 'info');
      }
      if (action.status === 'connected') {
        next = withNotice(next, 'Conectado al tablero de juego.', 'success');
      }
      if (action.status === 'disconnected') {
        next = withNotice(
          next,
          'Se perdió la conexión. El tablero está intentando reconectarse al servidor.',
          'error',
        );
      }
      return next;
    }

    case 'membership/created': {
      const { membership } = action;
      const seated = {
        ...state,
        room: membership.room,
        roomCode: membership.code,
        self: { playerId: membership.playerId, seatNumber: membership.seatNumber },
        busy: null,
        error: null,
        pendingAttempt: null,
        game: createInitialGameState(),
      };
      return withNotice(
        seated,
        `La sala ${membership.code} está lista. Sos el anfitrión del asiento ${membership.seatNumber}.`,
        'success',
      );
    }

    case 'membership/joined': {
      const { membership, rejoined } = action;
      const seated = {
        ...state,
        room: membership.room,
        roomCode: membership.code,
        self: { playerId: membership.playerId, seatNumber: membership.seatNumber },
        busy: null,
        error: null,
        pendingAttempt: null,
        // Rebind keeps the latest authoritative snapshot. Fresh fanout may arrive
        // before the join acknowledgement; resetting here would erase it.
        game: rejoined ? state.game : createInitialGameState(),
      };
      const text = rejoined
        ? `Volviste a la sala ${membership.code} (asiento ${membership.seatNumber}).`
        : `Ingresaste a la sala ${membership.code} (asiento ${membership.seatNumber}).`;
      return withNotice(seated, text, 'success');
    }

    case 'room/updated': {
      const diffNotices = roomDiffNotices(state.room, action.room);
      // Back to the lobby after a match: the finished game's views, results,
      // and cues belong to that match only, so they are cleared.
      const backToLobby =
        action.room.status === 'LOBBY' &&
        (state.room?.status === 'IN_MATCH' || state.room?.status === 'FINISHED');
      let next: RoomFlowState = {
        ...state,
        room: action.room,
        ...(backToLobby ? { game: createInitialGameState() } : {}),
      };
      for (const text of diffNotices) {
        next = withNotice(next, text, 'info');
      }
      return next;
    }

    case 'room/left': {
      const code = state.roomCode;
      const cleared = {
        ...state,
        room: null,
        roomCode: null,
        self: null,
        busy: null,
        error: null,
        pendingAttempt: null,
        game: createInitialGameState(),
      };
      return code === null ? cleared : withNotice(cleared, `Saliste de la sala ${code}.`, 'info');
    }

    case 'ack/failed': {
      const described = describeAckError(action.code);
      // A give-up rebind means the server still marks the old connection
      // live: the honest recovery is to wait and rejoin, not to retry.
      const reboundDuplicate =
        action.attempt.action === 'rebind' && action.code === 'DUPLICATE_SOCKET';
      const sentence = reboundDuplicate
        ? 'El servidor todavía conserva tu conexión anterior. Esperá unos segundos e intentá de nuevo.'
        : described.sentence;
      const recovery = reboundDuplicate ? 'rejoin' : described.recovery;
      return withNotice(
        {
          ...state,
          busy: null,
          error: {
            action: action.attempt.action,
            code: action.code,
            message: action.message,
            sentence,
            recovery,
          },
          pendingAttempt: action.attempt,
        },
        sentence,
        'error',
      );
    }

    case 'busy/started':
      return { ...state, busy: action.action };

    case 'seat/invalidated':
    case 'room/switched': {
      // A rejected reconnect token or navigation to another room must never
      // leave the previous room, seat, or its confirmations rendered.
      return {
        ...state,
        room: null,
        roomCode: null,
        self: null,
        busy: null,
        error: null,
        pendingAttempt: null,
        notices: [],
        game: createInitialGameState(),
      };
    }

    case 'busy/cleared':
      return { ...state, busy: null };

    case 'error/cleared':
      return { ...state, error: null };

    default:
      return state;
  }
}
