/**
 * Room-flow controller: the gateway-agnostic orchestration between UI and
 * transport. It owns the reducer, maps typed ack failures onto recoverable
 * errors, persists room-scoped reconnect material through injected stores,
 * and rebinds the seat automatically when the transport comes back.
 *
 * React components call it and render its state; neither decides anything
 * about game rules.
 */
import type {
  GameEventBroadcast,
  GamePrivateStateBroadcast,
  GamePublicStateBroadcast,
  MatchEndedBroadcast,
  PublicGameView,
  RoomSnapshot,
  TurnCommand,
} from '@power-hungry-pets/protocol';
import {
  createInitialRoomFlowState,
  roomFlowReducer,
  type Attempt,
  type MembershipResult,
  type RoomFlowState,
} from './reducer';

// -- Gateway seam -------------------------------------------------------------

export interface MembershipAck {
  roomId: string;
  code: string;
  playerId: string;
  seatNumber: number;
  room: RoomSnapshot;
}

export interface CreateMembershipAck extends MembershipAck {
  /** Raw reconnect token, handed to this client exactly once. */
  reconnectToken: string;
}

export interface JoinMembershipAck extends MembershipAck {
  /** Raw reconnect token for a new seat; `null` on a token rebind. */
  reconnectToken: string | null;
}

export interface StartMatchAck {
  room: RoomSnapshot;
  /** Initial public view of the first deal; legacy/test seams may rely on the broadcast instead. */
  publicView?: PublicGameView;
}

/**
 * Client-safe mirror of a successful `game:command` acknowledgement. The
 * server keeps authority: broadcasts, never this payload, update game state.
 */
export interface GameCommandAck {
  /** Sanitized public events emitted by the command, in emission order. */
  events: import('@power-hungry-pets/protocol').GamePublicEvent[];
  /** True when the command ended a round and a new round was auto-set-up. */
  roundAdvanced: boolean;
  /** True when the command ended the whole match. */
  matchEnded: boolean;
  /** Fresh public view after the command. */
  publicView: PublicGameView;
}

export interface LeaveRoomAck {
  room: RoomSnapshot | null;
}

export type ConnectionEvent = 'connected' | 'disconnected' | 'connecting';

/** Transport seam every room-flow interaction goes through. */
export interface RoomFlowGateway {
  connect(): void;
  disconnect(): void;
  createRoom(input: { displayName: string }): Promise<CreateMembershipAck>;
  joinRoom(input: {
    code: string;
    displayName?: string;
    reconnectToken?: string;
  }): Promise<JoinMembershipAck>;
  startMatch(input: { code: string }): Promise<StartMatchAck>;
  sendGameCommand(input: { code: string; command: TurnCommand }): Promise<GameCommandAck>;
  leaveRoom(input: { code: string }): Promise<LeaveRoomAck>;
  onRoomUpdated(callback: (room: RoomSnapshot) => void): () => void;
  onConnectionChange(callback: (status: ConnectionEvent) => void): () => void;
  /** Subscribes to the shared public game projection for the seated room. */
  onPublicState?(callback: (payload: GamePublicStateBroadcast) => void): () => void;
  /** Subscribes to private projections addressed to this tab's socket. */
  onPrivateState?(callback: (payload: GamePrivateStateBroadcast) => void): () => void;
  /** Subscribes to the animation-only sanitized public event feed. */
  onGameEvent?(callback: (payload: GameEventBroadcast) => void): () => void;
  /** Subscribes to the one-shot match completion broadcast. */
  onMatchEnded?(callback: (payload: MatchEndedBroadcast) => void): () => void;
}

// -- Client-only persistence seams ----------------------------------------------

/** Room-scoped reconnect-token storage (never rendered, never logged). */
export interface ReconnectTokenSink {
  save(code: string, token: string): void;
  load(code: string): string | null;
  clear(code: string): void;
}

/** Room-scoped seat identity storage. */
export interface SeatStore {
  save(code: string, seat: { playerId: string; seatNumber: number }): void;
  load(code: string): { playerId: string; seatNumber: number } | null;
  clear(code: string): void;
}

/** Remembered display name (not room-scoped). */
export interface NameStore {
  save(name: string): void;
  load(): string | null;
}

export interface RoomFlowStores {
  tokenSink: ReconnectTokenSink;
  seatStore: SeatStore;
  nameStore: NameStore;
}

/** In-memory store set for tests and non-browser runtimes. */
export function createMemoryStores(): RoomFlowStores {
  const tokens = new Map<string, string>();
  const seats = new Map<string, { playerId: string; seatNumber: number }>();
  let name: string | null = null;
  return {
    tokenSink: {
      save: (code, token) => {
        tokens.set(code.trim().toUpperCase(), token);
      },
      load: (code) => tokens.get(code.trim().toUpperCase()) ?? null,
      clear: (code) => {
        tokens.delete(code.trim().toUpperCase());
      },
    },
    seatStore: {
      save: (code, seat) => {
        seats.set(code.trim().toUpperCase(), seat);
      },
      load: (code) => seats.get(code.trim().toUpperCase()) ?? null,
      clear: (code) => {
        seats.delete(code.trim().toUpperCase());
      },
    },
    nameStore: {
      save: (value) => {
        name = value.trim();
      },
      load: () => name,
    },
  };
}

export type RestoreOutcome = 'restored' | 'not-seated' | 'rejected' | 'busy';

export interface RoomFlowController {
  getState(): RoomFlowState;
  subscribe(listener: () => void): () => void;
  /** Connects the transport (idempotent). */
  connect(): void;
  /** Lobby mount entry: connect and restore this room's seat if stored. */
  enterRoom(code: string): void;
  /** Creates a room; resolves the join code, or `null` on typed failure. */
  createRoom(displayName: string): Promise<string | null>;
  /** Joins as a brand-new seat; `true` on success. */
  joinRoom(code: string, displayName?: string): Promise<boolean>;
  /** Rebinds this tab's stored seat for a room via its reconnect token. */
  restoreSeat(code: string): Promise<RestoreOutcome>;
  /**
   * Rebinds a seat with an explicitly presented token (for example after a
   * stale-token rejection): typed rejection clears the stale state and
   * exposes a recoverable join path.
   */
  restoreSeatWithToken(code: string, token: string): Promise<RestoreOutcome>;
  /** Starts the match for the room this tab is seated in. */
  startMatch(): Promise<boolean>;
  /** Sends this viewer's authoritative `DRAW_CARD` command. */
  drawCard(): Promise<boolean>;
  /** Sends the exact targetless `PLAY_CARD` command for one hand card. */
  playCard(cardInstanceId: string): Promise<boolean>;
  /** Leaves the room this tab is seated in and clears its storage. */
  leaveRoom(): Promise<boolean>;
  /** Replays the pending attempt after a recoverable failure. */
  retry(): Promise<boolean>;
  clearError(): void;
  rememberedName(): string | null;
  disconnect(): void;
}

/** Rebind retry schedule after a replay rejection (sums well under 60s). */
const REBIND_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 10000];

function membershipOf(ack: MembershipAck): MembershipResult {
  return {
    roomId: ack.roomId,
    code: ack.code,
    playerId: ack.playerId,
    seatNumber: ack.seatNumber,
    room: ack.room,
  };
}

interface AckLikeError {
  code: string;
  message: string;
}

function asAckError(error: unknown): AckLikeError {
  if (error instanceof Error && typeof (error as unknown as { code?: unknown }).code === 'string') {
    return { code: (error as unknown as { code: string }).code, message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createRoomFlowController(
  gateway: RoomFlowGateway,
  options?: { stores?: RoomFlowStores },
): RoomFlowController {
  const stores = options?.stores ?? createMemoryStores();
  let state = createInitialRoomFlowState();
  const listeners = new Set<() => void>();
  let activeRebind: Promise<RestoreOutcome> | null = null;
  let roomIntentRevision = 0;

  function dispatch(action: Parameters<typeof roomFlowReducer>[1]): void {
    state = roomFlowReducer(state, action);
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function fail(attempt: Attempt, code: string, message: string): void {
    dispatch({ type: 'ack/failed', attempt, code, message });
  }

  gateway.onRoomUpdated((room) => {
    // A socket can remain subscribed to a previous room after client-side
    // navigation. Never let an old room broadcast resurrect cleared state.
    if (state.roomCode === room.code) {
      dispatch({ type: 'room/updated', room });
    }
  });
  gateway.onPublicState?.(({ roomCode, publicView }) => {
    if (state.roomCode === roomCode && state.self !== null) {
      dispatch({ type: 'game/public-state', publicView });
    }
  });
  gateway.onPrivateState?.(({ roomCode, playerId, privateView }) => {
    // Fail closed: a private view is stored only when it is addressed to
    // this tab's seated identity in this tab's seated room.
    if (state.roomCode === roomCode && state.self !== null && state.self.playerId === playerId) {
      dispatch({ type: 'game/private-state', privateView });
    }
  });
  gateway.onGameEvent?.(({ roomCode, events }) => {
    if (state.roomCode === roomCode && state.self !== null) {
      dispatch({ type: 'game/events', events });
    }
  });
  gateway.onMatchEnded?.(({ roomCode, winners, room }) => {
    if (state.roomCode === roomCode && room.code === roomCode && state.self !== null) {
      dispatch({ type: 'game/match-ended', winners });
      dispatch({ type: 'room/updated', room });
    }
  });
  gateway.onConnectionChange((status) => {
    const previous = state.connection;
    dispatch({ type: 'connection/status', status });
    if (
      status === 'connected' &&
      previous === 'disconnected' &&
      state.roomCode !== null &&
      state.self !== null
    ) {
      void rebind(state.roomCode);
    }
  });

  async function executeRebind(
    code: string,
    explicitToken: string | undefined,
    intentRevision: number,
  ): Promise<RestoreOutcome> {
    const token = explicitToken ?? stores.tokenSink.load(code);
    if (token === null) {
      return 'not-seated';
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        dispatch({ type: 'busy/started', action: 'rebind' });
        dispatch({ type: 'connection/status', status: 'connecting' });
        const ack = await gateway.joinRoom({ code, reconnectToken: token });
        if (intentRevision !== roomIntentRevision) {
          return 'not-seated';
        }
        if (ack.reconnectToken !== null) {
          stores.tokenSink.save(ack.code, ack.reconnectToken);
        }
        stores.seatStore.save(ack.code, {
          playerId: ack.playerId,
          seatNumber: ack.seatNumber,
        });
        dispatch({
          type: 'membership/joined',
          membership: membershipOf(ack),
          rejoined: true,
        });
        dispatch({ type: 'connection/status', status: 'connected' });
        return 'restored';
      } catch (error) {
        if (intentRevision !== roomIntentRevision) {
          return 'not-seated';
        }
        const ackError = asAckError(error);
        if (ackError.code === 'INVALID_RECONNECT_TOKEN') {
          stores.tokenSink.clear(code);
          stores.seatStore.clear(code);
          dispatch({ type: 'seat/invalidated' });
          fail({ action: 'rebind', code }, ackError.code, ackError.message);
          return 'rejected';
        }
        if (ackError.code === 'DUPLICATE_SOCKET' && attempt < REBIND_RETRY_DELAYS_MS.length) {
          await delay(REBIND_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        fail({ action: 'rebind', code }, ackError.code, ackError.message);
        return 'busy';
      }
    }
  }

  function rebind(
    code: string,
    explicitToken?: string,
    intentRevision = roomIntentRevision,
  ): Promise<RestoreOutcome> {
    if (activeRebind !== null) {
      return activeRebind.then(() =>
        intentRevision === roomIntentRevision
          ? rebind(code, explicitToken, intentRevision)
          : 'not-seated',
      );
    }
    const pending = executeRebind(code, explicitToken, intentRevision);
    activeRebind = pending;
    void pending.finally(() => {
      if (activeRebind === pending) {
        activeRebind = null;
      }
    });
    return pending;
  }

  function sendCommand(
    command: TurnCommand,
    action: 'draw' | 'play',
    cardInstanceId?: string,
  ): Promise<boolean> {
    const code = state.roomCode;
    const actorId = state.self?.playerId;
    const intentRevision = roomIntentRevision;
    if (code === null || actorId === undefined) {
      return Promise.resolve(false);
    }
    const attempt: Attempt = {
      action,
      code,
      ...(cardInstanceId !== undefined ? { cardInstanceId } : {}),
    };
    dispatch({ type: 'busy/started', action });
    return (async () => {
      try {
        // The exact canonical command, byte-for-byte what the server expects:
        // no client-side legality, no normalization, no optimistic mutation.
        await gateway.sendGameCommand({ code, command });
        if (intentRevision !== roomIntentRevision || state.roomCode !== code) {
          return false;
        }
        dispatch({ type: 'busy/cleared' });
        dispatch({ type: 'error/cleared' });
        return true;
      } catch (error) {
        if (intentRevision !== roomIntentRevision || state.roomCode !== code) {
          return false;
        }
        const ackError = asAckError(error);
        fail(attempt, ackError.code, ackError.message);
        return false;
      }
    })();
  }

  const controller: RoomFlowController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    connect() {
      if (state.connection === 'connected' || state.connection === 'connecting') {
        return;
      }
      dispatch({ type: 'connection/status', status: 'connecting' });
      gateway.connect();
    },

    enterRoom(code) {
      const normalizedCode = code.trim().toUpperCase();
      controller.connect();
      if (state.roomCode !== normalizedCode || state.self === null) {
        roomIntentRevision += 1;
        const intentRevision = roomIntentRevision;
        if (state.roomCode !== null && state.roomCode !== normalizedCode) {
          dispatch({ type: 'room/switched' });
        }
        void rebind(normalizedCode, undefined, intentRevision);
      }
    },

    async createRoom(displayName) {
      const intentRevision = ++roomIntentRevision;
      dispatch({ type: 'busy/started', action: 'create' });
      const attempt: Attempt = { action: 'create', displayName };
      try {
        controller.connect();
        const ack = await gateway.createRoom({ displayName });
        if (intentRevision !== roomIntentRevision) {
          return null;
        }
        stores.tokenSink.save(ack.code, ack.reconnectToken);
        stores.seatStore.save(ack.code, {
          playerId: ack.playerId,
          seatNumber: ack.seatNumber,
        });
        stores.nameStore.save(displayName);
        dispatch({ type: 'membership/created', membership: membershipOf(ack) });
        return ack.code;
      } catch (error) {
        if (intentRevision !== roomIntentRevision) {
          return null;
        }
        const ackError = asAckError(error);
        fail(attempt, ackError.code, ackError.message);
        return null;
      }
    },

    async joinRoom(code, displayName) {
      const intentRevision = ++roomIntentRevision;
      dispatch({ type: 'busy/started', action: 'join' });
      const attempt: Attempt = { action: 'join', code, displayName };
      try {
        controller.connect();
        const ack = await gateway.joinRoom({
          code,
          ...(displayName !== undefined ? { displayName } : {}),
        });
        if (intentRevision !== roomIntentRevision) {
          return false;
        }
        if (ack.reconnectToken !== null) {
          stores.tokenSink.save(ack.code, ack.reconnectToken);
        }
        stores.seatStore.save(ack.code, {
          playerId: ack.playerId,
          seatNumber: ack.seatNumber,
        });
        if (displayName !== undefined) {
          stores.nameStore.save(displayName);
        }
        dispatch({
          type: 'membership/joined',
          membership: membershipOf(ack),
          rejoined: false,
        });
        return true;
      } catch (error) {
        if (intentRevision !== roomIntentRevision) {
          return false;
        }
        const ackError = asAckError(error);
        fail(attempt, ackError.code, ackError.message);
        return false;
      }
    },

    restoreSeat(code) {
      return rebind(code);
    },

    restoreSeatWithToken(code, token) {
      return rebind(code, token);
    },

    async startMatch() {
      const code = state.roomCode;
      const intentRevision = roomIntentRevision;
      if (code === null) {
        return false;
      }
      dispatch({ type: 'busy/started', action: 'start' });
      try {
        const ack = await gateway.startMatch({ code });
        if (intentRevision !== roomIntentRevision || state.roomCode !== code) {
          return false;
        }
        dispatch({ type: 'room/updated', room: ack.room });
        if (ack.publicView !== undefined) {
          dispatch({ type: 'game/public-state', publicView: ack.publicView });
        }
        dispatch({ type: 'busy/cleared' });
        return true;
      } catch (error) {
        if (intentRevision !== roomIntentRevision || state.roomCode !== code) {
          return false;
        }
        const ackError = asAckError(error);
        fail({ action: 'start', code }, ackError.code, ackError.message);
        return false;
      }
    },

    async drawCard(): Promise<boolean> {
      const actorId = state.self?.playerId;
      if (actorId === undefined) {
        return false;
      }
      return sendCommand({ type: 'DRAW_CARD', actorId }, 'draw');
    },

    async playCard(cardInstanceId: string): Promise<boolean> {
      const actorId = state.self?.playerId;
      if (actorId === undefined) {
        return false;
      }
      return sendCommand({ type: 'PLAY_CARD', actorId, cardInstanceId }, 'play', cardInstanceId);
    },

    async leaveRoom() {
      const code = state.roomCode;
      if (code === null) {
        return false;
      }
      const intentRevision = ++roomIntentRevision;
      dispatch({ type: 'busy/started', action: 'leave' });
      try {
        await gateway.leaveRoom({ code });
        if (intentRevision !== roomIntentRevision) {
          return true;
        }
        stores.tokenSink.clear(code);
        stores.seatStore.clear(code);
        dispatch({ type: 'room/left', room: null });
        return true;
      } catch (error) {
        if (intentRevision !== roomIntentRevision) {
          return false;
        }
        const ackError = asAckError(error);
        fail({ action: 'leave', code }, ackError.code, ackError.message);
        return false;
      }
    },

    async retry() {
      const attempt = state.pendingAttempt;
      if (attempt === null) {
        return false;
      }
      switch (attempt.action) {
        case 'create':
          return (await controller.createRoom(attempt.displayName ?? '')) !== null;
        case 'join':
          return controller.joinRoom(attempt.code ?? '', attempt.displayName);
        case 'rebind':
          return (await rebind(attempt.code ?? '')) === 'restored';
        case 'start':
          return controller.startMatch();
        case 'leave':
          return controller.leaveRoom();
        case 'draw':
          return controller.drawCard();
        case 'play':
          return controller.playCard(attempt.cardInstanceId ?? '');
      }
    },

    clearError() {
      dispatch({ type: 'error/cleared' });
    },

    rememberedName() {
      return stores.nameStore.load();
    },

    disconnect() {
      gateway.disconnect();
    },
  };

  return controller;
}
