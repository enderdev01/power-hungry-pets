/**
 * Real NestJS Socket.IO game gateway (Milestone 6 server work unit 4).
 *
 * Contract:
 * - Client events `room:create`, `room:join`, `room:leave`, `room:start`, and
 *   one `game:command` carrying the exact engine TurnCommand; `system:ping`
 *   retained.
 * - Every request answers a typed AckEnvelope `{ok:true,data}` or
 *   `{ok:false,error:{code,message,engineCode?}}`. Malformed payloads fail at
 *   the gateway boundary with `INVALID_PAYLOAD`, never a raw TypeError.
 * - Socket identity — never payload actor/room identity — authorizes
 *   membership: the gateway resolves each socket's seat through the registry.
 * - Command flow: resolve the authenticated room/player, reject spoofing
 *   through the session, delegate exact semantics, broadcast sanitized
 *   `game:event`, then a fresh `game:public-state` to the room and
 *   `game:private-state` individually to each connected seat. Canonical
 *   state, TurnCommand payloads, reconnect tokens, and private views are
 *   never broadcast to the room.
 */
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ProjectionError,
  type TurnCommand,
  type TurnErrorCode,
} from '@power-hungry-pets/game-engine';
import type { Server, Socket } from 'socket.io';
import type { HandleCommandResult } from '../session/session.types';
import { GameSessionService } from '../session/game-session.service';
import { GameSessionError } from '../session/session.errors';
import { RoomRegistry } from '../room/room.registry';
import { RoomError, RoomErrorCode } from '../room/room.errors';
import { RoomStatus, type RoomSnapshot } from '../room/room.types';
import { PublicEventError } from '../projection/public-events';
import { JoinRateLimitError, JoinRateLimiter } from './join-rate-limiter';
import type { PublicEvent } from '../projection/public-events';
import {
  ackFailure,
  ackSuccess,
  ClientEvents,
  ServerEvents,
  type AckEnvelope,
  type AckErrorCode,
  type GameCommandData,
  type RoomCreateData,
  type RoomJoinData,
  type RoomLeaveData,
  type RoomReturnToLobbyData,
  type RoomStartData,
  type SystemPingData,
  type SystemPingRequest,
} from './contracts';

/** Socket.IO channel name for one room's broadcasts. */
function roomChannel(code: string): string {
  return `room:${code.trim().toUpperCase()}`;
}

/** Narrow runtime guard: a plain JSON object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Gateway-boundary TurnCommand validation: shape only, never semantics.
 * Returns a fresh canonical command object (client payload is never passed
 * through) or `undefined` when the shape is unusable.
 */
function parseCommand(raw: unknown): TurnCommand | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string' || typeof raw.actorId !== 'string') {
    return undefined;
  }
  const actorId = raw.actorId;
  switch (raw.type) {
    case 'DRAW_CARD':
      return { type: 'DRAW_CARD', actorId };
    case 'PLAY_CARD': {
      if (typeof raw.cardInstanceId !== 'string') {
        return undefined;
      }
      if (raw.targetId !== undefined && typeof raw.targetId !== 'string') {
        return undefined;
      }
      return {
        type: 'PLAY_CARD',
        actorId,
        cardInstanceId: raw.cardInstanceId,
        ...(raw.targetId !== undefined ? { targetId: raw.targetId } : {}),
      };
    }
    case 'CHOOSE_TARGET':
      return typeof raw.targetId === 'string'
        ? { type: 'CHOOSE_TARGET', actorId, targetId: raw.targetId }
        : undefined;
    case 'SUBMIT_GUESS':
      return typeof raw.value === 'number' && Number.isInteger(raw.value)
        ? { type: 'SUBMIT_GUESS', actorId, value: raw.value }
        : undefined;
    case 'CHOOSE_HIDDEN_SWAP':
      return typeof raw.swap === 'boolean'
        ? { type: 'CHOOSE_HIDDEN_SWAP', actorId, swap: raw.swap }
        : undefined;
    case 'CHOOSE_DECK_POSITION':
      return typeof raw.index === 'number' && Number.isInteger(raw.index)
        ? { type: 'CHOOSE_DECK_POSITION', actorId, index: raw.index }
        : undefined;
    default:
      return undefined;
  }
}

/** The seat a socket must be bound to in the target room, or a typed failure. */
interface RequiredBinding {
  code: string;
  playerId: string;
}

@WebSocketGateway({ cors: { origin: true } })
export class GameGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly registry: RoomRegistry,
    private readonly sessions: GameSessionService,
    private readonly joinLimiter: JoinRateLimiter,
  ) {}

  @SubscribeMessage(ClientEvents.systemPing)
  handleSystemPing(
    @ConnectedSocket() _client: Socket,
    @MessageBody() payload?: SystemPingRequest,
  ): AckEnvelope<SystemPingData> {
    return ackSuccess<SystemPingData>({
      pong: true,
      serverTime: Date.now(),
      ...(payload && typeof payload.sentAt === 'number' ? { echoedAt: payload.sentAt } : {}),
    });
  }

  // -- room lifecycle ---------------------------------------------------------

  @SubscribeMessage(ClientEvents.roomCreate)
  handleRoomCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): AckEnvelope<unknown> {
    return this.guarded(() => {
      if (!isRecord(payload) || typeof payload.displayName !== 'string') {
        return ackFailure('INVALID_PAYLOAD', 'room:create requires { displayName: string }');
      }
      const membership = this.registry.createRoom({
        displayName: payload.displayName,
        socketId: client.id,
      });
      // CREATED is the guarded pre-lobby state; the creator hosts the room
      // straight into LOBBY so a later `room:start` starts from a LOBBY room.
      this.registry.transitionRoom({
        code: membership.code,
        playerId: membership.playerId,
        nextStatus: RoomStatus.Lobby,
      });
      client.join(roomChannel(membership.code));
      const room = this.requireRoomSnapshot(membership.code);
      this.fanoutRoomState(membership.code);
      return ackSuccess<RoomCreateData>({
        roomId: membership.roomId,
        code: membership.code,
        playerId: membership.playerId,
        seatNumber: membership.seatNumber,
        reconnectToken: membership.reconnectToken,
        room,
      });
    });
  }

  @SubscribeMessage(ClientEvents.roomJoin)
  handleRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): AckEnvelope<unknown> {
    return this.guarded(() => {
      // Every room:join attempt counts against the per-connection join budget
      // (multiplayer spec §14), including malformed and invalid ones: the
      // limiter runs before any payload validation. It never touches
      // already-bound gameplay — no other handler consults it.
      this.joinLimiter.consume(client.id);

      if (!isRecord(payload) || typeof payload.code !== 'string') {
        return ackFailure('INVALID_PAYLOAD', 'room:join requires { code: string, ... }');
      }
      // A present reconnectToken must be a nonempty string: anything else is a
      // gateway-boundary failure and must never fall through to silently
      // creating a brand-new seat.
      const tokenProvided = payload.reconnectToken !== undefined;
      if (
        tokenProvided &&
        (typeof payload.reconnectToken !== 'string' ||
          (payload.reconnectToken as string).length === 0)
      ) {
        return ackFailure(
          'INVALID_PAYLOAD',
          'reconnectToken must be a nonempty string when present',
        );
      }
      const withToken = tokenProvided;
      if (!withToken && typeof payload.displayName !== 'string') {
        return ackFailure(
          'INVALID_PAYLOAD',
          'room:join requires a displayName or a reconnectToken',
        );
      }

      if (withToken) {
        const rebind = this.registry.reconnectSeat({
          code: payload.code,
          reconnectToken: payload.reconnectToken as string,
          socketId: client.id,
        });
        client.join(roomChannel(rebind.code));
        const room = this.requireRoomSnapshot(rebind.code);
        this.fanoutRoomState(rebind.code);
        return ackSuccess<RoomJoinData>({
          roomId: rebind.roomId,
          code: rebind.code,
          playerId: rebind.playerId,
          seatNumber: rebind.seatNumber,
          reconnectToken: null,
          room,
        });
      }

      const membership = this.registry.joinRoom({
        code: payload.code,
        displayName: payload.displayName as string,
        socketId: client.id,
      });
      client.join(roomChannel(membership.code));
      const room = this.requireRoomSnapshot(membership.code);
      this.fanoutRoomState(membership.code);
      return ackSuccess<RoomJoinData>({
        roomId: membership.roomId,
        code: membership.code,
        playerId: membership.playerId,
        seatNumber: membership.seatNumber,
        reconnectToken: membership.reconnectToken,
        room,
      });
    });
  }

  @SubscribeMessage(ClientEvents.roomLeave)
  handleRoomLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): AckEnvelope<unknown> {
    return this.guarded(() => {
      if (!isRecord(payload) || typeof payload.code !== 'string') {
        return ackFailure('INVALID_PAYLOAD', 'room:leave requires { code: string }');
      }
      const code = payload.code.trim().toUpperCase();
      const binding = this.registry.getSocketBinding(client.id);
      if (binding === undefined || binding.code !== code) {
        return ackFailure('SOCKET_NOT_BOUND', `socket is not bound to a seat in room ${code}`);
      }
      const remaining = this.registry.leaveRoom({ code, socketId: client.id });
      client.leave(roomChannel(code));
      if (remaining === null) {
        // The last seat left: the room is gone, so its match session must go.
        this.sessions.deleteSession(code);
        return ackSuccess<RoomLeaveData>({ room: null });
      }
      this.fanoutRoomState(code);
      return ackSuccess<RoomLeaveData>({ room: remaining });
    });
  }

  @SubscribeMessage(ClientEvents.roomStart)
  handleRoomStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): AckEnvelope<unknown> {
    return this.guarded(() => {
      if (!isRecord(payload) || typeof payload.code !== 'string') {
        return ackFailure('INVALID_PAYLOAD', 'room:start requires { code: string }');
      }
      const code = payload.code.trim().toUpperCase();
      const binding = this.requireBinding(client.id, code);
      if (!this.registry.isHost(code, binding.playerId)) {
        return ackFailure('NOT_HOST', 'only the room host may start the match');
      }

      const lobbyRoom = this.requireRoomSnapshot(code);
      // One session per room: start from the LOBBY snapshot first, then
      // transition the registry to IN_MATCH. A failed transition deletes the
      // just-created session so no orphan half-started match can survive.
      this.sessions.startSession(lobbyRoom);
      try {
        this.registry.transitionRoom({
          code,
          playerId: lobbyRoom.hostPlayerId,
          nextStatus: RoomStatus.InMatch,
        });
      } catch (error) {
        this.sessions.deleteSession(code);
        throw error;
      }

      const room = this.requireRoomSnapshot(code);
      this.fanoutRoomState(code);
      const publicView = this.sessions.getPublicView(code, room);
      return ackSuccess<RoomStartData>({ room, publicView });
    });
  }

  @SubscribeMessage(ClientEvents.roomReturnToLobby)
  handleRoomReturnToLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): AckEnvelope<unknown> {
    return this.guarded(() => {
      if (!isRecord(payload) || typeof payload.code !== 'string') {
        return ackFailure('INVALID_PAYLOAD', 'room:return-to-lobby requires { code: string }');
      }
      const code = payload.code.trim().toUpperCase();
      // Any seated player of the finished room may bring the table back; the
      // registry transition still runs under the server-internal host identity.
      this.requireBinding(client.id, code);
      const finished = this.requireRoomSnapshot(code);
      if (finished.status !== RoomStatus.Finished) {
        return ackFailure(
          'INVALID_ROOM_TRANSITION',
          `room ${code} can only return to its lobby after the match finished`,
        );
      }
      this.registry.transitionRoom({
        code,
        playerId: finished.hostPlayerId,
        nextStatus: RoomStatus.Lobby,
      });
      // The finished match is over: its session goes, so the next room:start
      // deals a brand-new match for the same seats.
      this.sessions.deleteSession(code);
      const room = this.requireRoomSnapshot(code);
      this.fanoutRoomState(code);
      return ackSuccess<RoomReturnToLobbyData>({ room });
    });
  }

  // -- game commands ----------------------------------------------------------

  @SubscribeMessage(ClientEvents.gameCommand)
  handleGameCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): AckEnvelope<unknown> {
    return this.guarded(() => {
      if (!isRecord(payload) || typeof payload.code !== 'string') {
        return ackFailure('INVALID_PAYLOAD', 'game:command requires { code, command }');
      }
      const command = parseCommand(payload.command);
      if (command === undefined) {
        return ackFailure('INVALID_PAYLOAD', 'command is not a valid engine TurnCommand');
      }
      const code = payload.code.trim().toUpperCase();
      const binding = this.requireBinding(client.id, code);

      const result: HandleCommandResult = this.sessions.handleCommand(
        code,
        binding.playerId,
        command,
      );
      if (!result.ok) {
        return ackFailure(result.error, result.message, result.engineCode ?? undefined);
      }

      this.broadcastGameEvents(code, result.events);
      const room = this.requireRoomSnapshot(code);
      if (result.matchEnded) {
        // The registry drives the terminal transition; the host identity is
        // server-internal here, never taken from the client payload.
        this.registry.transitionRoom({
          code,
          playerId: room.hostPlayerId,
          nextStatus: RoomStatus.Finished,
        });
      }
      const freshRoom = this.requireRoomSnapshot(code);
      this.fanoutGameState(code, freshRoom);
      if (result.matchEnded) {
        this.server.to(roomChannel(code)).emit(ServerEvents.matchEnded, {
          roomCode: code,
          winners: this.sessions.getSnapshot(code)?.match.winners ?? [],
          room: freshRoom,
        });
      }
      return ackSuccess<GameCommandData>({
        events: result.events,
        roundAdvanced: result.roundAdvanced,
        matchEnded: result.matchEnded,
        publicView: this.sessions.getPublicView(code, freshRoom),
      });
    });
  }

  // -- transport lifecycle ----------------------------------------------------

  /**
   * Marks the seat bound to the disconnecting socket as disconnected and
   * broadcasts the overlay update (room, public, private) to the remaining
   * connected seats. The seat itself is never eliminated: a reconnect token
   * can rebind it at any time.
   *
   * The socket's join-rate-limiter key is dropped first and unconditionally:
   * even when the seat lookup fails or seat cleanup throws, a finished
   * socket id must never keep holding limiter state.
   */
  handleDisconnect(client: Socket): void {
    this.joinLimiter.forget(client.id);
    const binding = this.registry.getSocketBinding(client.id);
    if (binding === undefined) {
      return;
    }
    try {
      this.registry.disconnectSeat({ code: binding.code, socketId: client.id });
      this.fanoutRoomState(binding.code);
    } catch (error) {
      this.logger.warn(`disconnect cleanup failed for socket ${client.id}: ${String(error)}`);
    }
  }

  // -- internals ---------------------------------------------------------------

  /** Wraps a handler body in the typed error mapping for the ack envelope. */
  private guarded(handler: () => AckEnvelope<unknown>): AckEnvelope<unknown> {
    try {
      return handler();
    } catch (error) {
      const mapped = this.mapError(error);
      return ackFailure(mapped.code, mapped.message, mapped.engineCode);
    }
  }

  /**
   * Maps typed domain failures to their stable public codes and folds anything
   * unknown into INTERNAL_ERROR without leaking stack traces or internals.
   */
  private mapError(error: unknown): {
    code: AckErrorCode;
    message: string;
    engineCode?: TurnErrorCode;
  } {
    if (error instanceof RoomError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof JoinRateLimitError) {
      return {
        code: 'RATE_LIMITED',
        message: `too many room:join attempts; retry after ${Math.ceil(error.retryAfterMs / 1000)}s`,
      };
    }
    if (error instanceof GameSessionError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof PublicEventError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof ProjectionError) {
      return { code: error.code, message: error.message };
    }
    // Stack details stay server-side: unknown failures never reach the client.
    this.logger.error(
      'unmapped gateway error',
      error instanceof Error ? error.stack : String(error),
    );
    return { code: 'INTERNAL_ERROR', message: 'unexpected server error' };
  }

  /** Resolves the seat a socket is bound to, rejecting room-code mismatches. */
  private requireBinding(socketId: string, code: string): RequiredBinding {
    const binding = this.registry.getSocketBinding(socketId);
    if (binding === undefined || binding.code !== code) {
      throw new RoomError(
        RoomErrorCode.SocketNotBound,
        `socket ${socketId} is not bound to a seat in room ${code}`,
      );
    }
    return binding;
  }

  private requireRoomSnapshot(code: string): RoomSnapshot {
    const room = this.registry.getRoom(code);
    if (room === undefined) {
      throw new RoomError(RoomErrorCode.RoomNotFound, `no live room with code ${code}`);
    }
    return room;
  }

  /**
   * Broadcasts the room snapshot and — when a match session exists for the
   * room — a fresh public state to the room and a fresh private state to each
   * connected seat individually. Used by join/reconnect/leave/disconnect/start.
   */
  private fanoutRoomState(code: string): void {
    const room = this.registry.getRoom(code);
    if (room === undefined) {
      return;
    }
    this.server.to(roomChannel(code)).emit(ServerEvents.roomUpdated, { room });
    if (this.sessions.getSnapshot(code) === undefined) {
      return;
    }
    this.fanoutGameState(code, room);
  }

  /** Public-state broadcast plus per-seat private-state fanout for a live match. */
  private fanoutGameState(code: string, room: RoomSnapshot): void {
    const publicView = this.sessions.getPublicView(code, room);
    this.server
      .to(roomChannel(code))
      .emit(ServerEvents.gamePublicState, { roomCode: code, publicView });
    for (const binding of this.registry.listConnectedBindings(code)) {
      const socket = this.server.sockets.sockets.get(binding.socketId);
      if (socket === undefined) {
        continue;
      }
      const privateView = this.sessions.getPrivateView(code, binding.playerId, room);
      socket.emit(ServerEvents.gamePrivateState, {
        roomCode: code,
        playerId: binding.playerId,
        privateView,
      });
    }
  }

  /** Broadcasts a batch of sanitized public events to the room channel. */
  private broadcastGameEvents(code: string, events: PublicEvent[]): void {
    if (events.length === 0) {
      return;
    }
    this.server.to(roomChannel(code)).emit(ServerEvents.gameEvent, { roomCode: code, events });
  }
}
