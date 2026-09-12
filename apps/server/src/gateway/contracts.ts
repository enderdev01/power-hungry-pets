/**
 * Typed contracts shared between the Socket.IO gateway and its clients.
 * Every server-to-client acknowledgement uses the {@link AckEnvelope} shape.
 */
import type {
  PrivateGameView,
  ProjectionErrorCode,
  PublicGameView,
  TurnCommand,
  TurnErrorCode,
} from '@power-hungry-pets/game-engine';
import type { PublicEvent, PublicEventErrorCode } from '../projection/public-events';
import type { RoomErrorCode } from '../room/room.errors';
import type { RoomSnapshot } from '../room/room.types';
import type { GameSessionErrorCode } from '../session/session.errors';

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

/** Data returned in a successful `room:start` acknowledgement. */
export interface RoomStartData {
  /** Room snapshot at IN_MATCH status. */
  room: RoomSnapshot;
  /** Fresh public view of the initial deal. */
  publicView: PublicGameView;
}

/** Payload sent by a client for the `game:command` event. */
export interface GameCommandRequest {
  code: string;
  /** The exact engine TurnCommand; validated at the gateway boundary. */
  command: TurnCommand;
}

/** Data returned in a successful `game:command` acknowledgement. */
export interface GameCommandData {
  /** Sanitized public events emitted by the command, in emission order. */
  events: PublicEvent[];
  /** True when the command ended a round and a new round was auto-set-up. */
  roundAdvanced: boolean;
  /** True when the command ended the whole match. */
  matchEnded: boolean;
  /** Fresh public view after the command. */
  publicView: PublicGameView;
}

/** `room:updated` broadcast payload: safe room snapshot, no token material. */
export interface RoomUpdatedEvent {
  room: RoomSnapshot;
}

/** `game:event` broadcast payload: sanitized public events only. */
export interface GameEventBroadcast {
  roomCode: string;
  events: PublicEvent[];
}

/** `game:public-state` broadcast payload: the shared public view. */
export interface GamePublicStateBroadcast {
  roomCode: string;
  publicView: PublicGameView;
}

/** `game:private-state` payload: emitted individually to one connected seat. */
export interface GamePrivateStateBroadcast {
  roomCode: string;
  playerId: string;
  privateView: PrivateGameView;
}

/** `match:ended` broadcast payload, emitted once when the match completes. */
export interface MatchEndedBroadcast {
  roomCode: string;
  winners: string[];
  /** Room snapshot at FINISHED status. */
  room: RoomSnapshot;
}

/**
 * Error code for a failed acknowledgement: gateway-boundary failures plus the
 * stable domain codes of every typed server failure (room, session, public
 * event, and engine projection). Codes are part of the public error contract.
 */
export type AckErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | RoomErrorCode
  | GameSessionErrorCode
  | PublicEventErrorCode
  | ProjectionErrorCode;

/** Discriminated union for every server acknowledgement. */
export type AckEnvelope<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: { code: AckErrorCode; message: string; engineCode?: TurnErrorCode } };

/** Builds a success acknowledgement envelope. */
export function ackSuccess<TData>(data: TData): AckEnvelope<TData> {
  return { ok: true, data };
}

/** Builds a failure acknowledgement envelope. */
export function ackFailure(
  code: AckErrorCode,
  message: string,
  engineCode?: TurnErrorCode,
): AckEnvelope<never> {
  return engineCode === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, engineCode } };
}
