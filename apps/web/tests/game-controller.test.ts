/**
 * Game-flow controller contract: the room-flow controller must capture the
 * initial public view from the room:start acknowledgement, subscribe to the
 * game broadcasts through the injected gateway seam, ignore private state
 * addressed to a different seat or an unseated tab, ignore game payloads for a
 * different room code, and send exact server-authoritative game commands
 * (WU6/WU7)
 * without ever mutating game state locally.
 */
import {
  createMemoryStores,
  createRoomFlowController,
  type GameCommandAck,
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
  TurnCommand,
} from '@power-hungry-pets/protocol';
import {
  privateView,
  publicView,
  roomSnapshotInMatch,
  SELF_ID,
  OTHER_ID,
} from './helpers/game-views';

function commandAck(): GameCommandAck {
  return { events: [], roundAdvanced: false, matchEnded: false, publicView: publicView() };
}

/** Rejection shaped like the socket adapter's typed ack error. */
function ackError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { name: 'GatewayAckError', code });
}

/** Scriptable fake over the full room-flow gateway seam. */
class FakeGateway {
  connectionCbs: Array<(status: 'connected' | 'disconnected' | 'connecting') => void> = [];
  roomUpdatedCbs: Array<(room: RoomSnapshot) => void> = [];
  publicStateCbs: Array<(payload: GamePublicStateBroadcast) => void> = [];
  privateStateCbs: Array<(payload: GamePrivateStateBroadcast) => void> = [];
  gameEventCbs: Array<(payload: GameEventBroadcast) => void> = [];
  matchEndedCbs: Array<(payload: MatchEndedBroadcast) => void> = [];
  startQueue: Array<() => Promise<{ room: RoomSnapshot; publicView: PublicGameView }>> = [];
  commandQueue: Array<() => Promise<GameCommandAck>> = [];
  commandResults: Array<GameCommandAck & { input: { code: string; command: TurnCommand } }> = [];

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

  sendGameCommand(input: { code: string; command: TurnCommand }): Promise<GameCommandAck> {
    this.commandResults.push({ ...commandAck(), input });
    const next = this.commandQueue.shift();
    if (!next) throw new Error('no scripted game:command result');
    return next();
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

describe('game commands (WU6)', () => {
  it('sends the exact DRAW_CARD command for this seat and clears busy on success', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    const ok = await f.controller.drawCard();

    expect(ok).toBe(true);
    expect(f.gateway.commandResults[0]).toMatchObject({
      input: {
        code: 'ABC12',
        command: { type: 'DRAW_CARD', actorId: SELF_ID },
      },
    });
    expect(f.state().busy).toBeNull();
  });

  it('sends the exact targetless PLAY_CARD command tied to the card instance id', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    const ok = await f.controller.playCard('own-instance-1');

    expect(ok).toBe(true);
    // Targetless parity (WU7): the sent command is exactly the targetless shape
    // — toEqual proves no extra keys, and the `in` check proves no latent
    // `targetId: undefined` property is carried on the wire object.
    const sent = f.gateway.commandResults[0]?.input.command;
    expect(sent).toEqual({ type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' });
    expect(sent !== undefined && !('targetId' in sent)).toBe(true);
    expect(f.state().busy).toBeNull();
  });

  it('never mutates game state from the acknowledgement — broadcasts stay the only source', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    await f.controller.drawCard();

    // The untouched initial projection proves no optimistic or ack-fed mutation.
    expect(f.state().game.publicView).toBeNull();
    expect(f.state().game.privateView).toBeNull();
  });

  it('sends no command while this tab is unseated', async () => {
    const f = fixture();

    expect(await f.controller.drawCard()).toBe(false);
    expect(await f.controller.playCard('own-instance-1')).toBe(false);
    expect(f.gateway.commandResults).toHaveLength(0);
    expect(f.state().busy).toBeNull();
  });

  it('surfaces a typed engine rejection and leaves a retryable draw attempt', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    const ok = await f.controller.drawCard();

    expect(ok).toBe(false);
    expect(f.state().busy).toBeNull();
    expect(f.state().error?.code).toBe('ENGINE_REJECTED');
    expect(f.state().pendingAttempt).toEqual({ action: 'draw', code: 'ABC12' });
  });

  it('keeps the exact card instance in a retryable play failure', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.playCard('own-instance-2')).toBe(false);
    expect(f.state().pendingAttempt).toEqual({
      action: 'play',
      code: 'ABC12',
      cardInstanceId: 'own-instance-2',
    });
  });

  it('retries a failed draw through the pending attempt', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('INTERNAL_ERROR', 'boom')));
    await f.controller.drawCard();

    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    expect(await f.controller.retry()).toBe(true);
    expect(f.gateway.commandResults[1]).toMatchObject({
      input: { command: { type: 'DRAW_CARD', actorId: SELF_ID } },
    });
  });

  it('retries a failed play with the same exact card instance id', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('INTERNAL_ERROR', 'boom')));
    await f.controller.playCard('own-instance-2');

    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    expect(await f.controller.retry()).toBe(true);
    expect(f.gateway.commandResults[1]).toMatchObject({
      input: { command: { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-2' } },
    });
  });

  it('ignores a late game-command acknowledgement after navigation', async () => {
    const f = fixture();
    await f.seat();
    let resolveCommand!: (value: GameCommandAck) => void;
    f.gateway.commandQueue.push(
      () =>
        new Promise<GameCommandAck>((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const drawing = f.controller.drawCard();
    f.controller.enterRoom('ZZZZ9');
    resolveCommand(commandAck());

    expect(await drawing).toBe(false);
    expect(f.state().roomCode).toBeNull();
    expect(f.state().busy).toBeNull();
    expect(f.state().game.publicView).toBeNull();
  });

  it('sends the exact targeted PLAY_CARD command with actorId, cardInstanceId, and targetId', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    const ok = await f.controller.playCard('own-instance-2', OTHER_ID);

    expect(ok).toBe(true);
    expect(f.gateway.commandResults[0]).toMatchObject({
      input: {
        code: 'ABC12',
        command: {
          type: 'PLAY_CARD',
          actorId: SELF_ID,
          cardInstanceId: 'own-instance-2',
          targetId: OTHER_ID,
        },
      },
    });
    expect(f.state().busy).toBeNull();
  });

  it('keeps the exact card instance and target in a retryable targeted play failure', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.playCard('own-instance-2', OTHER_ID)).toBe(false);
    expect(f.state().pendingAttempt).toEqual({
      action: 'play',
      code: 'ABC12',
      cardInstanceId: 'own-instance-2',
      targetId: OTHER_ID,
    });
  });

  it('retries a failed targeted play with the identical targeted command', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('INTERNAL_ERROR', 'boom')));
    await f.controller.playCard('own-instance-2', OTHER_ID);

    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    expect(await f.controller.retry()).toBe(true);
    expect(f.gateway.commandResults[1]).toMatchObject({
      input: {
        command: {
          type: 'PLAY_CARD',
          actorId: SELF_ID,
          cardInstanceId: 'own-instance-2',
          targetId: OTHER_ID,
        },
      },
    });
  });

  it('omits targetId entirely from the attempt on a targetless play', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.playCard('own-instance-2')).toBe(false);
    const attempt = f.state().pendingAttempt;
    expect(attempt).toEqual({
      action: 'play',
      code: 'ABC12',
      cardInstanceId: 'own-instance-2',
    });
    // targetId must be truly absent, not merely undefined-valued.
    expect(attempt !== null && !('targetId' in attempt)).toBe(true);
  });

  it('clears a stale error once a later command succeeds', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'no')));
    await f.controller.drawCard();
    expect(f.state().error).not.toBeNull();

    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    await f.controller.drawCard();
    expect(f.state().error).toBeNull();
  });
});

describe('pending-decision commands (WU8)', () => {
  it('sends the exact CHOOSE_TARGET command with actorId and targetId', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    const ok = await f.controller.chooseTarget(OTHER_ID);

    expect(ok).toBe(true);
    const sent = f.gateway.commandResults[0]?.input.command;
    expect(sent).toEqual({ type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID });
    expect(
      sent !== undefined && !('value' in sent) && !('swap' in sent) && !('index' in sent),
    ).toBe(true);
    expect(f.state().busy).toBeNull();
  });

  it('sends the exact SUBMIT_GUESS command with actorId and value', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    const ok = await f.controller.submitGuess(7);

    expect(ok).toBe(true);
    const sent = f.gateway.commandResults[0]?.input.command;
    expect(sent).toEqual({ type: 'SUBMIT_GUESS', actorId: SELF_ID, value: 7 });
    expect(sent !== undefined && !('targetId' in sent)).toBe(true);
  });

  it('sends the exact CHOOSE_HIDDEN_SWAP command for both swap answers', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    expect(await f.controller.chooseHiddenSwap(false)).toBe(true);
    expect(await f.controller.chooseHiddenSwap(true)).toBe(true);

    expect(f.gateway.commandResults[0]?.input.command).toEqual({
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: SELF_ID,
      swap: false,
    });
    expect(f.gateway.commandResults[1]?.input.command).toEqual({
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: SELF_ID,
      swap: true,
    });
  });

  it('sends the exact CHOOSE_DECK_POSITION command with actorId and index', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    const ok = await f.controller.chooseDeckPosition(3);

    expect(ok).toBe(true);
    const sent = f.gateway.commandResults[0]?.input.command;
    expect(sent).toEqual({ type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 3 });
    expect(sent !== undefined && !('targetId' in sent) && !('value' in sent)).toBe(true);
  });

  it('sends no pending-decision command while this tab is unseated', async () => {
    const f = fixture();

    expect(await f.controller.chooseTarget(OTHER_ID)).toBe(false);
    expect(await f.controller.submitGuess(7)).toBe(false);
    expect(await f.controller.chooseHiddenSwap(true)).toBe(false);
    expect(await f.controller.chooseDeckPosition(0)).toBe(false);
    expect(f.gateway.commandResults).toHaveLength(0);
    expect(f.state().busy).toBeNull();
  });

  it('keeps the exact targetId in a retryable choose-target failure', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.chooseTarget(OTHER_ID)).toBe(false);
    expect(f.state().pendingAttempt).toEqual({
      action: 'choose-target',
      code: 'ABC12',
      targetId: OTHER_ID,
    });
  });

  it('keeps the exact guess value in a retryable submit-guess failure', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.submitGuess(7)).toBe(false);
    expect(f.state().pendingAttempt).toEqual({
      action: 'submit-guess',
      code: 'ABC12',
      value: 7,
    });
  });

  it('keeps the exact swap answer in a retryable choose-hidden-swap failure', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.chooseHiddenSwap(true)).toBe(false);
    expect(f.state().pendingAttempt).toEqual({
      action: 'choose-hidden-swap',
      code: 'ABC12',
      swap: true,
    });
  });

  it('keeps the exact deck index in a retryable choose-deck-position failure', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('ENGINE_REJECTED', 'not legal now')));

    expect(await f.controller.chooseDeckPosition(2)).toBe(false);
    expect(f.state().pendingAttempt).toEqual({
      action: 'choose-deck-position',
      code: 'ABC12',
      index: 2,
    });
  });

  it('retries a failed pending decision with the byte-identical command', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('INTERNAL_ERROR', 'boom')));
    await f.controller.chooseHiddenSwap(true);

    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    expect(await f.controller.retry()).toBe(true);
    expect(f.gateway.commandResults[1]?.input.command).toEqual({
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: SELF_ID,
      swap: true,
    });
  });

  it('retries a failed deck-position decision with the identical index', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.reject(ackError('INTERNAL_ERROR', 'boom')));
    await f.controller.chooseDeckPosition(0);

    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));
    expect(await f.controller.retry()).toBe(true);
    expect(f.gateway.commandResults[1]?.input.command).toEqual({
      type: 'CHOOSE_DECK_POSITION',
      actorId: SELF_ID,
      index: 0,
    });
  });

  it('never mutates game state from a pending-decision acknowledgement', async () => {
    const f = fixture();
    await f.seat();
    f.gateway.commandQueue.push(() => Promise.resolve(commandAck()));

    await f.controller.chooseTarget(OTHER_ID);

    expect(f.state().game.publicView).toBeNull();
    expect(f.state().game.privateView).toBeNull();
  });
});
