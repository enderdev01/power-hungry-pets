/**
 * Real Socket.IO adapter for the room-flow gateway seam. Translates typed
 * ack envelopes and server broadcasts into controller-ready results, and
 * fails closed on malformed acks instead of leaking raw errors.
 */
import { io, type Socket } from 'socket.io-client';
import {
  ClientEvents,
  ServerEvents,
  type GameEventBroadcast,
  type GamePrivateStateBroadcast,
  type GamePublicStateBroadcast,
  type MatchEndedBroadcast,
  type RoomCreateData,
  type RoomJoinData,
  type RoomLeaveData,
  type RoomSnapshot,
  type RoomStartData,
  type SystemPingData,
} from '@power-hungry-pets/protocol';
import type {
  ConnectionEvent,
  CreateMembershipAck,
  JoinMembershipAck,
  LeaveRoomAck,
  RoomFlowGateway,
  StartMatchAck,
} from '@/lib/room-flow/controller';

/** Typed rejection surfaced by a failed acknowledgement envelope. */
export class GatewayAckError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GatewayAckError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Light structural guard over trusted server broadcasts; fails safe. */
function roomFromPayload(payload: unknown): RoomSnapshot | null {
  if (!isRecord(payload) || !isRecord(payload.room)) {
    return null;
  }
  const room = payload.room as unknown as RoomSnapshot;
  return Array.isArray(room.players) ? room : null;
}

export class SocketRoomFlowGateway implements RoomFlowGateway {
  private socket: Socket | null = null;
  private readonly connectionCallbacks: Array<(status: ConnectionEvent) => void> = [];
  private readonly roomUpdatedCallbacks: Array<(room: RoomSnapshot) => void> = [];
  private readonly publicStateCallbacks: Array<(payload: GamePublicStateBroadcast) => void> = [];
  private readonly privateStateCallbacks: Array<(payload: GamePrivateStateBroadcast) => void> = [];
  private readonly gameEventCallbacks: Array<(payload: GameEventBroadcast) => void> = [];
  private readonly matchEndedCallbacks: Array<(payload: MatchEndedBroadcast) => void> = [];

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.socket !== null) {
      return;
    }
    const socket = io(this.url);
    this.socket = socket;
    socket.on('connect', () => {
      this.emitConnection('connected');
    });
    socket.on('disconnect', () => {
      this.emitConnection('disconnected');
    });
    socket.on('reconnect_attempt', () => {
      this.emitConnection('connecting');
    });
    socket.on(ServerEvents.roomUpdated, (payload: unknown) => {
      const room = roomFromPayload(payload);
      if (room !== null) {
        for (const callback of [...this.roomUpdatedCallbacks]) {
          callback(room);
        }
      }
    });
    socket.on(ServerEvents.gamePublicState, (payload: unknown) => {
      if (
        isRecord(payload) &&
        typeof payload.roomCode === 'string' &&
        isRecord(payload.publicView)
      ) {
        const broadcast = payload as unknown as GamePublicStateBroadcast;
        for (const callback of [...this.publicStateCallbacks]) {
          callback(broadcast);
        }
      }
    });
    socket.on(ServerEvents.gamePrivateState, (payload: unknown) => {
      if (
        isRecord(payload) &&
        typeof payload.roomCode === 'string' &&
        typeof payload.playerId === 'string' &&
        isRecord(payload.privateView)
      ) {
        const broadcast = payload as unknown as GamePrivateStateBroadcast;
        for (const callback of [...this.privateStateCallbacks]) {
          callback(broadcast);
        }
      }
    });
    socket.on(ServerEvents.gameEvent, (payload: unknown) => {
      if (
        isRecord(payload) &&
        typeof payload.roomCode === 'string' &&
        Array.isArray(payload.events)
      ) {
        const broadcast = payload as unknown as GameEventBroadcast;
        for (const callback of [...this.gameEventCallbacks]) {
          callback(broadcast);
        }
      }
    });
    socket.on(ServerEvents.matchEnded, (payload: unknown) => {
      const room = roomFromPayload(payload);
      if (
        room !== null &&
        isRecord(payload) &&
        typeof payload.roomCode === 'string' &&
        Array.isArray(payload.winners)
      ) {
        const broadcast = payload as unknown as MatchEndedBroadcast;
        for (const callback of [...this.matchEndedCallbacks]) {
          callback(broadcast);
        }
      }
    });
  }

  disconnect(): void {
    if (this.socket !== null) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  createRoom(input: { displayName: string }): Promise<CreateMembershipAck> {
    return this.request<RoomCreateData>(ClientEvents.roomCreate, input);
  }

  joinRoom(input: {
    code: string;
    displayName?: string;
    reconnectToken?: string;
  }): Promise<JoinMembershipAck> {
    return this.request<RoomJoinData>(ClientEvents.roomJoin, input);
  }

  startMatch(input: { code: string }): Promise<StartMatchAck> {
    return this.request<RoomStartData>(ClientEvents.roomStart, input);
  }

  leaveRoom(input: { code: string }): Promise<LeaveRoomAck> {
    return this.request<RoomLeaveData>(ClientEvents.roomLeave, input);
  }

  /** Keeps the transport warm with the retained ping seam. */
  async ping(sentAt?: number): Promise<SystemPingData> {
    return this.request<SystemPingData>(ClientEvents.systemPing, {
      ...(sentAt !== undefined ? { sentAt } : {}),
    });
  }

  onRoomUpdated(callback: (room: RoomSnapshot) => void): () => void {
    this.roomUpdatedCallbacks.push(callback);
    return () => {
      const index = this.roomUpdatedCallbacks.indexOf(callback);
      if (index >= 0) {
        this.roomUpdatedCallbacks.splice(index, 1);
      }
    };
  }

  onPublicState(callback: (payload: GamePublicStateBroadcast) => void): () => void {
    this.publicStateCallbacks.push(callback);
    return () => {
      const index = this.publicStateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.publicStateCallbacks.splice(index, 1);
      }
    };
  }

  onPrivateState(callback: (payload: GamePrivateStateBroadcast) => void): () => void {
    this.privateStateCallbacks.push(callback);
    return () => {
      const index = this.privateStateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.privateStateCallbacks.splice(index, 1);
      }
    };
  }

  onGameEvent(callback: (payload: GameEventBroadcast) => void): () => void {
    this.gameEventCallbacks.push(callback);
    return () => {
      const index = this.gameEventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.gameEventCallbacks.splice(index, 1);
      }
    };
  }

  onMatchEnded(callback: (payload: MatchEndedBroadcast) => void): () => void {
    this.matchEndedCallbacks.push(callback);
    return () => {
      const index = this.matchEndedCallbacks.indexOf(callback);
      if (index >= 0) {
        this.matchEndedCallbacks.splice(index, 1);
      }
    };
  }

  onConnectionChange(callback: (status: ConnectionEvent) => void): () => void {
    this.connectionCallbacks.push(callback);
    return () => {
      const index = this.connectionCallbacks.indexOf(callback);
      if (index >= 0) {
        this.connectionCallbacks.splice(index, 1);
      }
    };
  }

  private emitConnection(status: ConnectionEvent): void {
    for (const callback of [...this.connectionCallbacks]) {
      callback(status);
    }
  }

  /** Emits one request and unwraps the typed ack envelope, failing closed. */
  private request<TData>(event: string, payload: unknown): Promise<TData> {
    this.connect();
    const socket = this.socket;
    if (socket === null) {
      return Promise.reject(
        new GatewayAckError('INTERNAL_ERROR', 'The transport is not connected.'),
      );
    }
    return new Promise<TData>((resolve, reject) => {
      socket.timeout(10000).emit(event, payload, (timeoutError: Error | null, ack: unknown) => {
        if (timeoutError !== null) {
          reject(new GatewayAckError('INTERNAL_ERROR', 'The server did not answer in time.'));
          return;
        }
        if (!isRecord(ack)) {
          reject(new GatewayAckError('INTERNAL_ERROR', 'Malformed acknowledgement.'));
          return;
        }
        if (ack.ok === true) {
          resolve(ack.data as TData);
          return;
        }
        const error = isRecord(ack.error) ? ack.error : undefined;
        const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
        const message = typeof error?.message === 'string' ? error.message : 'Request failed.';
        reject(new GatewayAckError(code, message));
      });
    });
  }
}
