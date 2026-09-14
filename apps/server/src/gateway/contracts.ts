/**
 * Typed contracts shared between the Socket.IO gateway and its clients.
 * Every server-to-client acknowledgement uses the {@link AckEnvelope} shape.
 *
 * Canonical seam (Milestone 7): the client-safe room-flow contracts — event
 * names, room snapshots, create/join/leave/start request-data shapes, and the
 * ack envelope — live in `@power-hungry-pets/protocol` and are re-exported
 * here unchanged, so web clients never import from `apps/server`. This file
 * keeps the game-level payloads (`game:command`, broadcast views) and the
 * server-facing helpers, plus compile-time drift witnesses asserting the
 * server's domain types AND constant values stay equal to the client-safe
 * mirrors (finding 6: no silent protocol drift).
 */
import type { ProjectionErrorCode, TurnErrorCode } from '@power-hungry-pets/game-engine';
import type { PublicEvent, PublicEventErrorCode } from '../projection/public-events';
import type { RoomErrorCode } from '../room/room.errors';
import {
  MAX_DISPLAY_NAME_LENGTH as ServerMaxDisplayNameLength,
  MAX_SEATS_PER_ROOM as ServerMaxSeatsPerRoom,
  MIN_SEATS_TO_START_MATCH as ServerMinSeatsToStartMatch,
  ROOM_CODE_ALPHABET as ServerRoomCodeAlphabet,
  ROOM_CODE_LENGTH as ServerRoomCodeLength,
} from '../room/room.types';
import type {
  RoomPlayerView,
  RoomSnapshot,
  RoomStatus as ServerRoomStatus,
} from '../room/room.types';
import type { GameSessionErrorCode } from '../session/session.errors';
import {
  MAX_DISPLAY_NAME_LENGTH as ProtocolMaxDisplayNameLength,
  MAX_SEATS_PER_ROOM as ProtocolMaxSeatsPerRoom,
  MIN_SEATS_TO_START_MATCH as ProtocolMinSeatsToStartMatch,
  ROOM_CODE_ALPHABET as ProtocolRoomCodeAlphabet,
  ROOM_CODE_LENGTH as ProtocolRoomCodeLength,
} from '@power-hungry-pets/protocol';
import type {
  AckEnvelope as RoomFlowAckEnvelope,
  AckErrorCode,
  ClientEventName,
  GameEventBroadcast as ProtocolGameEventBroadcast,
  GamePrivateStateBroadcast as ProtocolGamePrivateStateBroadcast,
  GamePublicStateBroadcast as ProtocolGamePublicStateBroadcast,
  MatchEndedBroadcast as ProtocolMatchEndedBroadcast,
  PrivateGameView as ProtocolPrivateGameView,
  PublicGameView as ProtocolPublicGameView,
  RoomStartData as RoomFlowRoomStartData,
  RoomPlayerView as ProtocolRoomPlayerView,
  RoomSnapshot as ProtocolRoomSnapshot,
  RoomStatus as ProtocolRoomStatus,
  ServerEventName,
} from '@power-hungry-pets/protocol';

// -- Canonical client-safe seam re-exports ------------------------------------

export {
  ClientEvents,
  ServerEvents,
  MAX_SEATS_PER_ROOM,
  MIN_SEATS_TO_START_MATCH,
  MAX_DISPLAY_NAME_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  RoomStatus,
} from '@power-hungry-pets/protocol';
export type {
  ClientEventName,
  ServerEventName,
  RoomFlowErrorCode,
  RoomPlayerView as ProtocolRoomPlayerView,
  RoomSnapshot as ProtocolRoomSnapshot,
  RoomCreateRequest,
  RoomJoinRequest,
  RoomLeaveRequest,
  RoomStartRequest,
} from '@power-hungry-pets/protocol';

import type {
  PrivateGameView as EnginePrivateGameView,
  PublicGameView as EnginePublicGameView,
  TurnCommand,
} from '@power-hungry-pets/game-engine';

export type SystemPingRequest = import('@power-hungry-pets/protocol').SystemPingRequest;
export type SystemPingData = import('@power-hungry-pets/protocol').SystemPingData;
export type RoomCreateData = import('@power-hungry-pets/protocol').RoomCreateData;
export type RoomJoinData = import('@power-hungry-pets/protocol').RoomJoinData;
export type RoomLeaveData = import('@power-hungry-pets/protocol').RoomLeaveData;
export type RoomReturnToLobbyData = import('@power-hungry-pets/protocol').RoomReturnToLobbyData;
export type RoomUpdatedEvent = import('@power-hungry-pets/protocol').RoomUpdatedEvent;

/**
 * Server-side game-view aliases: the canonical engine projection types. The
 * client-safe protocol mirrors must stay structurally equal to these; the
 * game projection drift witnesses below fail the build on any divergence.
 */
export type PublicGameView = EnginePublicGameView;
export type PrivateGameView = EnginePrivateGameView;

/**
 * Data returned in a successful `room:start` acknowledgement: the fresh room
 * snapshot plus the game-level initial public view. The base seam carries
 * `publicView` too; the drift witnesses keep the two shapes exactly equal.
 */
export interface RoomStartData {
  /** Fresh room snapshot at IN_MATCH status. */
  room: RoomSnapshot;
  /** Fresh public view of the initial deal. */
  publicView: PublicGameView;
}

// -- Game-level contracts (not part of the room-flow seam) ----------------------

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

/** `game:event` broadcast payload: sanitized public events only. */
export type GameEventBroadcast = ProtocolGameEventBroadcast;

/** `game:public-state` broadcast payload: the shared public view. */
export type GamePublicStateBroadcast = ProtocolGamePublicStateBroadcast;

/** `game:private-state` payload: emitted individually to one connected seat. */
export type GamePrivateStateBroadcast = ProtocolGamePrivateStateBroadcast;

/** `match:ended` broadcast payload, emitted once when the match completes. */
export type MatchEndedBroadcast = ProtocolMatchEndedBroadcast;

// -- Ack envelope and error code ------------------------------------------------

/**
 * Error code for a failed acknowledgement: the canonical room-flow mirror
 * plus the stable domain codes of every typed server failure (room, session,
 * public event, and engine projection). Codes are part of the public error
 * contract; {@link AckErrorCode} is kept equal to this union by the
 * compile-time witnesses below.
 */
export type { AckErrorCode };

/**
 * Discriminated union for every server acknowledgement. Game-level failures
 * additionally carry the optional `engineCode` detail — a server-side game
 * contract layered onto the canonical room-flow envelope.
 */
export type AckEnvelope<TData> = RoomFlowAckEnvelope<
  TData,
  AckErrorCode,
  { engineCode?: TurnErrorCode }
>;

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

// -- Compile-time drift guards ---------------------------------------------------

/**
 * Witnesses tying the server domain unions, snapshot views, and constant
 * values to the client-safe protocol seam. If a server error code is added, a
 * room view field changes, or a constant value changes without updating
 * `packages/protocol`, the build fails here instead of letting the two
 * contracts drift apart.
 */
type AssertEqual<A, B> = [A, B] extends [B, A] ? true : never;

export type ProtocolSeamCompat = {
  roomSnapshot: AssertEqual<RoomSnapshot, ProtocolRoomSnapshot>;
  roomPlayerView: AssertEqual<RoomPlayerView, ProtocolRoomPlayerView>;
  roomErrorCodes: AssertEqual<RoomErrorCode, Extract<AckErrorCode, RoomErrorCode>>;
  sessionErrorCodes: AssertEqual<GameSessionErrorCode, Extract<AckErrorCode, GameSessionErrorCode>>;
  publicEventErrorCodes: AssertEqual<
    PublicEventErrorCode,
    Extract<AckErrorCode, PublicEventErrorCode>
  >;
  projectionErrorCodes: AssertEqual<
    ProjectionErrorCode,
    Extract<AckErrorCode, ProjectionErrorCode>
  >;
  /**
   * The server start-data payload stays exactly equal to the seam shape:
   * room snapshot plus the game-level public view.
   */
  startExtendsBase: AssertEqual<RoomStartData, RoomFlowRoomStartData>;

  // Constant-value witnesses: the values must not drift either.

  maxSeatsPerRoom: AssertEqual<typeof ServerMaxSeatsPerRoom, typeof ProtocolMaxSeatsPerRoom>;
  minSeatsToStartMatch: AssertEqual<
    typeof ServerMinSeatsToStartMatch,
    typeof ProtocolMinSeatsToStartMatch
  >;
  maxDisplayNameLength: AssertEqual<
    typeof ServerMaxDisplayNameLength,
    typeof ProtocolMaxDisplayNameLength
  >;
  roomCodeLength: AssertEqual<typeof ServerRoomCodeLength, typeof ProtocolRoomCodeLength>;
  roomCodeAlphabet: AssertEqual<typeof ServerRoomCodeAlphabet, typeof ProtocolRoomCodeAlphabet>;
  roomStatusValues: AssertEqual<ServerRoomStatus, ProtocolRoomStatus>;
  /**
   * Game projection drift guards: the engine's public/private game views
   * and every broadcast payload shape must stay structurally equal to the
   * client-safe protocol mirrors. A server-side view field change without
   * updating `packages/protocol` fails the build here.
   */
  gamePublicView: AssertEqual<PublicGameView, ProtocolPublicGameView>;
  gamePrivateView: AssertEqual<PrivateGameView, ProtocolPrivateGameView>;
  gameEventBroadcast: AssertEqual<GameEventBroadcast, ProtocolGameEventBroadcast>;
  gamePublicStateBroadcast: AssertEqual<GamePublicStateBroadcast, ProtocolGamePublicStateBroadcast>;
  gamePrivateStateBroadcast: AssertEqual<
    GamePrivateStateBroadcast,
    ProtocolGamePrivateStateBroadcast
  >;
  matchEndedBroadcast: AssertEqual<MatchEndedBroadcast, ProtocolMatchEndedBroadcast>;
  clientEventNames: AssertEqual<
    ClientEventName,
    | 'system:ping'
    | 'room:create'
    | 'room:join'
    | 'room:leave'
    | 'room:start'
    | 'room:return-to-lobby'
    | 'game:command'
  >;
  serverEventNames: AssertEqual<
    ServerEventName,
    | 'system:notice'
    | 'room:updated'
    | 'game:event'
    | 'game:public-state'
    | 'game:private-state'
    | 'match:ended'
  >;
};

export const PROTOCOL_SEAM_COMPAT: ProtocolSeamCompat = {
  roomSnapshot: true,
  roomPlayerView: true,
  roomErrorCodes: true,
  sessionErrorCodes: true,
  publicEventErrorCodes: true,
  projectionErrorCodes: true,
  startExtendsBase: true,
  maxSeatsPerRoom: true,
  minSeatsToStartMatch: true,
  maxDisplayNameLength: true,
  roomCodeLength: true,
  roomCodeAlphabet: true,
  roomStatusValues: true,
  gamePublicView: true,
  gamePrivateView: true,
  gameEventBroadcast: true,
  gamePublicStateBroadcast: true,
  gamePrivateStateBroadcast: true,
  matchEndedBroadcast: true,
  clientEventNames: true,
  serverEventNames: true,
};
