/**
 * Room-flow controller contract against a scripted fake gateway: membership
 * acks, typed ack failures, seat restoration, and transport-driven rebinds.
 * No sockets, no React, no server — pure orchestration behavior.
 */
import {
  createMemoryStores,
  createRoomFlowController,
  type MembershipAck,
  type RoomFlowGateway,
} from '@/lib/room-flow/controller';
import type { RoomSnapshot, TurnCommand } from '@power-hungry-pets/protocol';

function ackOf(
  code: string,
  playerId: string,
  seatNumber: number,
  room: RoomSnapshot,
): MembershipAck {
  return { roomId: 'room-1', code, playerId, seatNumber, room };
}

function roomSnapshot(
  code: string,
  players: Array<{ playerId: string; displayName: string; isHost?: boolean }>,
): RoomSnapshot {
  return {
    roomId: 'room-1',
    code,
    status: 'LOBBY',
    hostPlayerId: players.find((p) => p.isHost)?.playerId ?? players[0].playerId,
    createdAt: 1,
    players: players.map((p, i) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      seatNumber: i + 1,
      connected: true,
      isHost: p.isHost ?? false,
      joinedAt: i,
    })),
  };
}

/** Scriptable fake: queued result factories per call kind plus manual pumps. */
class FakeGateway implements RoomFlowGateway {
  connectionCbs: Array<(status: 'connected' | 'disconnected' | 'connecting') => void> = [];
  roomUpdatedCbs: Array<(room: RoomSnapshot) => void> = [];
  createQueue: Array<() => Promise<MembershipAck & { reconnectToken: string }>> = [];
  joinQueue: Array<() => Promise<MembershipAck & { reconnectToken: string | null }>> = [];
  startQueue: Array<() => Promise<{ room: RoomSnapshot }>> = [];
  leaveQueue: Array<() => Promise<{ room: RoomSnapshot | null }>> = [];
  calls: Array<{ kind: string; input: unknown }> = [];

  connect(): void {
    this.calls.push({ kind: 'connect', input: undefined });
    this.emitConnection('connected');
  }

  disconnect(): void {
    this.calls.push({ kind: 'disconnect', input: undefined });
  }

  emitConnection(status: 'connected' | 'disconnected' | 'connecting'): void {
    for (const cb of [...this.connectionCbs]) cb(status);
  }

  emitRoomUpdated(room: RoomSnapshot): void {
    for (const cb of [...this.roomUpdatedCbs]) cb(room);
  }

  createRoom(input: { displayName: string }): Promise<MembershipAck & { reconnectToken: string }> {
    this.calls.push({ kind: 'room:create', input });
    const next = this.createQueue.shift();
    if (!next) throw new Error('no scripted room:create result');
    return next();
  }

  joinRoom(input: {
    code: string;
    displayName?: string;
    reconnectToken?: string;
  }): Promise<MembershipAck & { reconnectToken: string | null }> {
    this.calls.push({ kind: 'room:join', input });
    const next = this.joinQueue.shift();
    if (!next) throw new Error('no scripted room:join result');
    return next();
  }

  startMatch(input: { code: string }): Promise<{ room: RoomSnapshot }> {
    this.calls.push({ kind: 'room:start', input });
    const next = this.startQueue.shift();
    if (!next) throw new Error('no scripted room:start result');
    return next();
  }

  leaveRoom(input: { code: string }): Promise<{ room: RoomSnapshot | null }> {
    this.calls.push({ kind: 'room:leave', input });
    const next = this.leaveQueue.shift();
    if (!next) throw new Error('no scripted room:leave result');
    return next();
  }

  sendGameCommand(input: { code: string; command: TurnCommand }): Promise<never> {
    this.calls.push({ kind: 'game:command', input });
    return Promise.reject(new Error('not scripted'));
  }

  onRoomUpdated(cb: (room: RoomSnapshot) => void): () => void {
    this.roomUpdatedCbs.push(cb);
    return () => {
      this.roomUpdatedCbs = this.roomUpdatedCbs.filter((x) => x !== cb);
    };
  }

  onConnectionChange(
    cb: (status: 'connected' | 'disconnected' | 'connecting') => void,
  ): () => void {
    this.connectionCbs.push(cb);
    return () => {
      this.connectionCbs = this.connectionCbs.filter((x) => x !== cb);
    };
  }
}

/** Rejection shaped like the socket adapter's typed ack error. */
function ackError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { name: 'GatewayAckError', code });
}

const LOBBY = roomSnapshot('ABC12', [
  { playerId: 'p-host', displayName: 'Ana', isHost: true },
  { playerId: 'p-2', displayName: 'Bruno' },
]);

describe('room-flow controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a room, stores the token and seat, and reports the code', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.createQueue.push(() =>
      Promise.resolve({
        ...ackOf(
          'ABC12',
          'p-host',
          1,
          roomSnapshot('ABC12', [{ playerId: 'p-host', displayName: 'Ana', isHost: true }]),
        ),
        reconnectToken: 'tok-host',
      }),
    );

    const code = await controller.createRoom('Ana');

    expect(code).toBe('ABC12');
    expect(stores.tokenSink.load('ABC12')).toBe('tok-host');
    expect(stores.seatStore.load('ABC12')).toEqual({ playerId: 'p-host', seatNumber: 1 });
    expect(stores.nameStore.load()).toBe('Ana');
    expect(controller.getState().self).toEqual({ playerId: 'p-host', seatNumber: 1 });
    expect(controller.getState().roomCode).toBe('ABC12');
    expect(controller.getState().connection).toBe('connected');
  });

  it('leaves pending-attempt state behind a create that the server rejects', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.createQueue.push(() => Promise.reject(ackError('INVALID_DISPLAY_NAME', 'bad name')));

    const code = await controller.createRoom('   ');

    expect(code).toBeNull();
    const state = controller.getState();
    expect(state.error?.code).toBe('INVALID_DISPLAY_NAME');
    expect(state.pendingAttempt).toEqual({ action: 'create', displayName: '   ' });
    expect(state.busy).toBeNull();
  });

  it('retries the pending attempt on demand and clears the error on success', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.joinQueue.push(() => Promise.reject(ackError('ROOM_FULL', 'full')));
    await controller.joinRoom('ABC12');

    expect(controller.getState().error?.code).toBe('ROOM_FULL');
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );
    const retried = await controller.retry();

    expect(retried).toBe(true);
    const state = controller.getState();
    expect(state.error).toBeNull();
    expect(state.self).toEqual({ playerId: 'p-2', seatNumber: 2 });
  });

  it('reports join success and keeps the ack room snapshot', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );

    const ok = await controller.joinRoom('abc12', 'Bruno');

    expect(ok).toBe(true);
    expect(
      gateway.calls.some(
        (c) => c.kind === 'room:join' && (c.input as { code: string }).code === 'abc12',
      ),
    ).toBe(true);
    expect(controller.getState().room).toEqual(LOBBY);
    expect(stores.tokenSink.load('ABC12')).toBe('tok-2');
  });

  it('sends a start only for the room this tab is seated in', async () => {
    const gateway = new FakeGateway();
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    const started = await controller.startMatch();
    expect(started).toBe(false);
    expect(gateway.calls.filter((c) => c.kind === 'room:start')).toHaveLength(0);
  });

  it('surfaces a NOT_HOST rejection without clearing the seat', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );
    await controller.joinRoom('ABC12', 'Bruno');
    gateway.startQueue.push(() =>
      Promise.reject(ackError('NOT_HOST', 'only la persona anfitriona may start')),
    );

    const started = await controller.startMatch();

    expect(started).toBe(false);
    expect(controller.getState().error?.code).toBe('NOT_HOST');
    expect(controller.getState().self).not.toBeNull();
  });

  it('forwards start success as a room update so the lobby sees IN_MATCH', async () => {
    const gateway = new FakeGateway();
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-host', 1, LOBBY), reconnectToken: 'tok-1' }),
    );
    await controller.joinRoom('ABC12', 'Ana');
    gateway.startQueue.push(() =>
      Promise.resolve({ room: { ...LOBBY, status: 'IN_MATCH' as const } }),
    );

    await controller.startMatch();

    expect(controller.getState().room?.status).toBe('IN_MATCH');
    expect(controller.getState().notices.at(-1)?.text).toBe('La partida comenzó.');
  });

  it('acknowledges a leave, clears this room’s storage, and reports the code', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );
    await controller.joinRoom('ABC12', 'Bruno');
    gateway.leaveQueue.push(() => Promise.resolve({ room: LOBBY }));

    const ok = await controller.leaveRoom();

    expect(ok).toBe(true);
    expect(controller.getState().self).toBeNull();
    expect(stores.tokenSink.load('ABC12')).toBeNull();
    expect(stores.seatStore.load('ABC12')).toBeNull();
    expect(controller.getState().notices.at(-1)?.text).toContain('Saliste de la sala ABC12');
  });

  describe('seat restoration (reconnect token persistence)', () => {
    function controllerWithStoredSeat() {
      const gateway = new FakeGateway();
      const stores = createMemoryStores();
      stores.tokenSink.save('ABC12', 'tok-2');
      stores.seatStore.save('ABC12', { playerId: 'p-2', seatNumber: 2 });
      return { gateway, stores, controller: createRoomFlowController(gateway, { stores }) };
    }

    it('restores the seat from the stored room-scoped token', async () => {
      const { gateway, controller } = controllerWithStoredSeat();
      gateway.joinQueue.push(() =>
        Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: null }),
      );

      const restored = await controller.restoreSeat('ABC12');

      expect(restored).toBe('restored');
      expect(gateway.calls[0]).toMatchObject({
        kind: 'room:join',
        input: { code: 'ABC12', reconnectToken: 'tok-2' },
      });
      expect(controller.getState().self).toEqual({ playerId: 'p-2', seatNumber: 2 });
    });

    it('reports no stored seat without touching the socket', async () => {
      const gateway = new FakeGateway();
      const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
      expect(await controller.restoreSeat('ZZZZ9')).toBe('not-seated');
      expect(gateway.calls).toHaveLength(0);
    });

    it('retries a replay rejection while the old socket is still marked connected', async () => {
      const { gateway, controller } = controllerWithStoredSeat();
      gateway.joinQueue.push(() => Promise.reject(ackError('DUPLICATE_SOCKET', 'still connected')));
      const restoring = controller.restoreSeat('ABC12');
      await jest.advanceTimersByTimeAsync(0);
      // First failure schedules a retry 2s out.
      expect(controller.getState().connection).toBe('connecting');
      gateway.joinQueue.push(() =>
        Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: null }),
      );
      await jest.advanceTimersByTimeAsync(2000);
      expect(await restoring).toBe('restored');
      expect(gateway.calls.filter((c) => c.kind === 'room:join')).toHaveLength(2);
    });

    it('gives up after the retry budget with an honest error', async () => {
      const { gateway, controller } = controllerWithStoredSeat();
      for (let i = 0; i < 6; i += 1) {
        gateway.joinQueue.push(() =>
          Promise.reject(ackError('DUPLICATE_SOCKET', 'still connected')),
        );
      }
      const restoring = controller.restoreSeat('ABC12');
      await jest.advanceTimersByTimeAsync(60000);

      expect(await restoring).toBe('busy');
      expect(controller.getState().error?.code).toBe('DUPLICATE_SOCKET');
      expect(controller.getState().error?.recovery).toBe('rejoin');
    });

    it('clears stored seat material and asks for a rejoin on a bad token', async () => {
      const { gateway, stores, controller } = controllerWithStoredSeat();
      gateway.joinQueue.push(() => Promise.reject(ackError('INVALID_RECONNECT_TOKEN', 'no match')));

      const restored = await controller.restoreSeat('ABC12');

      expect(restored).toBe('rejected');
      expect(stores.tokenSink.load('ABC12')).toBeNull();
      expect(stores.seatStore.load('ABC12')).toBeNull();
      expect(controller.getState().error?.code).toBe('INVALID_RECONNECT_TOKEN');
    });
  });

  describe('transport-driven rebind', () => {
    it('rebinds with the stored token when the transport reconnects mid-lobby', async () => {
      const gateway = new FakeGateway();
      const stores = createMemoryStores();
      const controller = createRoomFlowController(gateway, { stores });
      gateway.joinQueue.push(() =>
        Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
      );
      await controller.joinRoom('ABC12', 'Bruno');

      gateway.emitConnection('disconnected');
      gateway.joinQueue.push(() =>
        Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: null }),
      );
      gateway.emitConnection('connected');
      await jest.advanceTimersByTimeAsync(0);

      const rebinds = gateway.calls.filter(
        (c) =>
          c.kind === 'room:join' &&
          (c.input as { reconnectToken?: string }).reconnectToken === 'tok-2',
      );
      expect(rebinds).toHaveLength(1);
      expect(controller.getState().connection).toBe('connected');
    });

    it('does not rebind on a fresh connect with no seat', async () => {
      const gateway = new FakeGateway();
      createRoomFlowController(gateway, { stores: createMemoryStores() });
      gateway.emitConnection('connected');
      await jest.advanceTimersByTimeAsync(0);
      expect(gateway.calls.filter((c) => c.kind === 'room:join')).toHaveLength(0);
    });

    it('pumps room:updated snapshots only for the seated room', async () => {
      const gateway = new FakeGateway();
      const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
      gateway.emitRoomUpdated(LOBBY);
      expect(controller.getState().room).toBeNull();

      gateway.joinQueue.push(() =>
        Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
      );
      await controller.joinRoom('ABC12', 'Bruno');
      const updated = { ...LOBBY, status: 'IN_MATCH' as const };
      gateway.emitRoomUpdated(updated);
      expect(controller.getState().room).toEqual(updated);
    });
  });
});

describe('stale room-state safety', () => {
  it('enterRoom on a different code clears the previous room and seat', async () => {
    const gateway = new FakeGateway();
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );
    await controller.joinRoom('ABC12', 'Bruno');
    expect(controller.getState().self).not.toBeNull();

    controller.enterRoom('ZZZZ9');
    await Promise.resolve();

    const state = controller.getState();
    expect(state.room).toBeNull();
    expect(state.roomCode).toBeNull();
    expect(state.self).toBeNull();
    expect(
      gateway.calls.filter(
        (c) => c.kind === 'room:join' && (c.input as { code?: string }).code === 'ZZZZ9',
      ),
    ).toHaveLength(0);
  });

  it('ignores late room updates from an abandoned room', async () => {
    const gateway = new FakeGateway();
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );
    await controller.joinRoom('ABC12', 'Bruno');

    controller.enterRoom('ZZZZ9');
    gateway.emitRoomUpdated({ ...LOBBY, status: 'IN_MATCH' });

    expect(controller.getState().room).toBeNull();
    expect(controller.getState().roomCode).toBeNull();
    expect(controller.getState().game.publicView).toBeNull();
  });

  it('cannot resurrect an old room when its rebind finishes after navigation', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-a' }),
    );
    await controller.joinRoom('ABC12', 'Bruno');

    let resolveOld!: (value: MembershipAck & { reconnectToken: string | null }) => void;
    gateway.emitConnection('disconnected');
    gateway.joinQueue.push(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    gateway.emitConnection('connected');
    await Promise.resolve();

    const roomB = { ...LOBBY, roomId: 'room-b', code: 'ZZZZ9' };
    stores.tokenSink.save('ZZZZ9', 'tok-b');
    stores.seatStore.save('ZZZZ9', { playerId: 'p-9', seatNumber: 1 });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ZZZZ9', 'p-9', 1, roomB), reconnectToken: null }),
    );
    controller.enterRoom('ZZZZ9');
    resolveOld({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: null });

    for (
      let attempt = 0;
      attempt < 20 && controller.getState().roomCode !== 'ZZZZ9';
      attempt += 1
    ) {
      await Promise.resolve();
    }
    expect(controller.getState().roomCode).toBe('ZZZZ9');
    expect(controller.getState().room?.roomId).toBe('room-b');

    gateway.emitRoomUpdated({ ...LOBBY, status: 'IN_MATCH' });
    expect(controller.getState().room?.roomId).toBe('room-b');
  });

  it('a rejected rebind clears the stale room and seat and exposes a join path', async () => {
    const gateway = new FakeGateway();
    const stores = createMemoryStores();
    const controller = createRoomFlowController(gateway, { stores });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-2', 2, LOBBY), reconnectToken: 'tok-2' }),
    );
    await controller.joinRoom('ABC12', 'Bruno');

    gateway.emitConnection('disconnected');
    gateway.joinQueue.push(() => Promise.reject(ackError('INVALID_RECONNECT_TOKEN', 'no match')));
    gateway.emitConnection('connected');
    await Promise.resolve();

    const state = controller.getState();
    expect(state.room).toBeNull();
    expect(state.roomCode).toBeNull();
    expect(state.self).toBeNull();
    expect(stores.tokenSink.load('ABC12')).toBeNull();
    expect(stores.seatStore.load('ABC12')).toBeNull();
    expect(state.error?.code).toBe('INVALID_RECONNECT_TOKEN');
    expect(state.error?.recovery).toBe('edit-input');
  });

  it('ignores a late room:start acknowledgement after navigation', async () => {
    const gateway = new FakeGateway();
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-host', 1, LOBBY), reconnectToken: 'tok-1' }),
    );
    await controller.joinRoom('ABC12', 'Ana');

    let resolveStart!: (value: { room: RoomSnapshot }) => void;
    gateway.startQueue.push(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    const starting = controller.startMatch();
    controller.enterRoom('ZZZZ9');
    resolveStart({ room: { ...LOBBY, status: 'IN_MATCH' } });

    expect(await starting).toBe(false);
    expect(controller.getState().room).toBeNull();
    expect(controller.getState().roomCode).toBeNull();
    expect(controller.getState().game.publicView).toBeNull();
  });

  it('clears busy after a successful room start', async () => {
    const gateway = new FakeGateway();
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    gateway.joinQueue.push(() =>
      Promise.resolve({ ...ackOf('ABC12', 'p-host', 1, LOBBY), reconnectToken: 'tok-1' }),
    );
    await controller.joinRoom('ABC12', 'Ana');
    gateway.startQueue.push(() =>
      Promise.resolve({ room: { ...LOBBY, status: 'IN_MATCH' as const } }),
    );

    await controller.startMatch();

    expect(controller.getState().busy).toBeNull();
  });
});
