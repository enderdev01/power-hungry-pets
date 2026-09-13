/**
 * Game-flow controller contract: the room-flow controller must capture the
 * initial public view from the room:start acknowledgement, subscribe to the
 * game broadcasts through the injected gateway seam, ignore private state
 * addressed to a different seat or an unseated tab, and ignore game payloads
 * for a different room code.
 */
import {
  createMemoryStores,
  createRoomFlowController,
  type RoomFlowController,
} from '@/lib/room-flow/controller';
import type { RoomFlowState } from '@/lib/room-flow/reducer';
import type {
  GameEventBroadcast,
  GamePrivateStateBroadcast,
  GamePublicStateBroadcast,
  MatchEndedBroadcast,
  PublicGameView,
  RoomSnapshot,
} from '@power-hungry-pets/protocol';
import {
  privateView,
  publicView,
  roomSnapshotInMatch,
  SELF_ID,
  OTHER_ID,
} from './helpers/game-views';

/** Scriptable fake over the full room-flow gateway seam. */
class FakeGateway {
  connectionCbs: Array<(status: 'connected' | 'disconnected' | 'connecting') => void> = [];
  roomUpdatedCbs: Array<(room: RoomSnapshot) => void> = [];
  publicStateCbs: Array<(payload: GamePublicStateBroadcast) => void> = [];
  privateStateCbs: Array<(payload: GamePrivateStateBroadcast) => void> = [];
  gameEventCbs: Array<(payload: GameEventBroadcast) => void> = [];
  matchEndedCbs: Array<(payload: MatchEndedBroadcast) => void> = [];
  startQueue: Array<() => Promise<{ room: RoomSnapshot; publicView: PublicGameView }>> = [];

  connect(): void {
    for (const cb of [...this.connectionCbs]) cb('connected');
  }

  disconnect(): void {}

  createRoom(): Promise<never> {
    return Promise.reject(new Error('not scripted'));
  }

  joinRoom(): Promise<never> {
    return Promise.reject(new Error('not scripted'));
  }

  startMatch(): Promise<{ room: RoomSnapshot; publicView: PublicGameView }> {
    const next = this.startQueue.shift();
    if (!next) throw new Error('no scripted room:start result');
    return next();
  }

  leaveRoom(): Promise<{ room: RoomSnapshot | null }> {
    return Promise.resolve({ room: null });
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

  onPublicState(cb: (payload: GamePublicStateBroadcast) => void): () => void {
    this.publicStateCbs.push(cb);
    return () => {
      this.publicStateCbs = this.publicStateCbs.filter((x) => x !== cb);
    };
  }

  onPrivateState(cb: (payload: GamePrivateStateBroadcast) => void): () => void {
    this.privateStateCbs.push(cb);
    return () => {
      this.privateStateCbs = this.privateStateCbs.filter((x) => x !== cb);
    };
  }

  onGameEvent(cb: (payload: GameEventBroadcast) => void): () => void {
    this.gameEventCbs.push(cb);
    return () => {
      this.gameEventCbs = this.gameEventCbs.filter((x) => x !== cb);
    };
  }

  onMatchEnded(cb: (payload: MatchEndedBroadcast) => void): () => void {
    this.matchEndedCbs.push(cb);
    return () => {
      this.matchEndedCbs = this.matchEndedCbs.filter((x) => x !== cb);
    };
  }

  emitPublicState(payload: GamePublicStateBroadcast): void {
    for (const cb of [...this.publicStateCbs]) cb(payload);
  }

  emitPrivateState(payload: GamePrivateStateBroadcast): void {
    for (const cb of [...this.privateStateCbs]) cb(payload);
  }

  emitGameEvent(payload: GameEventBroadcast): void {
    for (const cb of [...this.gameEventCbs]) cb(payload);
  }

  emitMatchEnded(payload: MatchEndedBroadcast): void {
    for (const cb of [...this.matchEndedCbs]) cb(payload);
  }
}

interface Fixture {
  gateway: FakeGateway;
  controller: RoomFlowController;
  state: () => RoomFlowState;
  seat: () => Promise<void>;
}

function fixture(): Fixture {
  const gateway = new FakeGateway();
  const controller = createRoomFlowController(
    gateway as unknown as import('@/lib/room-flow/controller').RoomFlowGateway,
    { stores: createMemoryStores() },
  );
  const seat = async (): Promise<void> => {
    gateway.joinRoom = () =>
      Promise.resolve({
        roomId: 'room-1',
        code: 'ABC12',
        playerId: SELF_ID,
        seatNumber: 1,
        room: roomSnapshotInMatch(),
        reconnectToken: 'tok',
      });
    await controller.joinRoom('ABC12', 'Ana');
  };
  return {
    gateway,
    controller,
    state: controller.getState,
    seat,
  };
}

describe('game-flow controller', () => {
  it('captures the initial public view from the room:start acknowledgement', async () => {
    const f = fixture();
    await f.seat();
    const initial = publicView();
    f.gateway.startQueue.push(() =>
      Promise.resolve({ room: roomSnapshotInMatch(), publicView: initial }),
    );

    expect(await f.controller.startMatch()).toBe(true);
    expect(f.state().game.publicView).toBe(initial);
  });

  it('stores a public-state broadcast for the seated room', async () => {
    const f = fixture();
    await f.seat();
    const view = publicView();

    f.gateway.emitPublicState({ roomCode: 'ABC12', publicView: view });
    expect(f.state().game.publicView).toBe(view);
  });

  it('ignores public-state broadcasts for a different room code', async () => {
    const f = fixture();
    await f.seat();

    f.gateway.emitPublicState({ roomCode: 'ZZZ99', publicView: publicView() });
    expect(f.state().game.publicView).toBeNull();
  });

  it('stores the private-state broadcast addressed to this seat', async () => {
    const f = fixture();
    await f.seat();
    const view = privateView(SELF_ID);

    f.gateway.emitPrivateState({ roomCode: 'ABC12', playerId: SELF_ID, privateView: view });
    expect(f.state().game.privateView).toBe(view);
  });

  it('never stores private state addressed to another seat', async () => {
    const f = fixture();
    await f.seat();

    f.gateway.emitPrivateState({
      roomCode: 'ABC12',
      playerId: OTHER_ID,
      privateView: privateView(OTHER_ID),
    });
    expect(f.state().game.privateView).toBeNull();
  });

  it('never stores private state while this tab is unseated', async () => {
    const f = fixture();

    f.gateway.emitPrivateState({
      roomCode: 'ABC12',
      playerId: SELF_ID,
      privateView: privateView(SELF_ID),
    });
    expect(f.state().game.privateView).toBeNull();
  });

  it('keeps a bounded animation-only event feed from game:event', async () => {
    const f = fixture();
    await f.seat();

    f.gateway.emitGameEvent({
      roomCode: 'ABC12',
      events: [{ type: 'CARD_DRAWN', playerId: SELF_ID }],
    });
    expect(f.state().game.recentEvents).toEqual([{ type: 'CARD_DRAWN', playerId: SELF_ID }]);
    // Events are never authoritative: projections stay null.
    expect(f.state().game.publicView).toBeNull();
  });

  it('records match:ended with the room snapshot and winners', async () => {
    const f = fixture();
    await f.seat();
    const finishedRoom: RoomSnapshot = { ...roomSnapshotInMatch(), status: 'FINISHED' };

    f.gateway.emitMatchEnded({
      roomCode: 'ABC12',
      winners: [SELF_ID],
      room: finishedRoom,
    });
    expect(f.state().game.matchEnded).toBe(true);
    expect(f.state().game.matchWinners).toEqual([SELF_ID]);
    expect(f.state().room?.status).toBe('FINISHED');
  });
});
