/**
 * Gateway game-session contract tests (Milestone 6 server work unit 4):
 * the exact private-vs-public fanout at the initial deal, legal command flow
 * with ack/event/state, out-of-turn and spoof rejection without mutation, and
 * a driven round transition over real sockets.
 */
import type { TurnCommand } from '@power-hungry-pets/game-engine';
import { createServer, type ServerHandles } from '../src/main';
import {
  ClientEvents,
  ServerEvents,
  type GameCommandData,
  type GameEventBroadcast,
  type GamePrivateStateBroadcast,
  type GamePublicStateBroadcast,
  type MatchEndedBroadcast,
  type RoomJoinData,
  type RoomLeaveData,
  type RoomStartData,
} from '../src/gateway/contracts';
import {
  closeRoom,
  collectEvents,
  connectClient,
  createLobbyRoom,
  emitAck,
  sleep,
  waitForCount,
  type RoomFixture,
  type SeatFixture,
} from './helpers/socket-client';

/** Latest private-state broadcast collected for a seat. */
type PrivateCollector = GamePrivateStateBroadcast[];

function latestPrivate(collector: PrivateCollector): GamePrivateStateBroadcast | undefined {
  return collector[collector.length - 1];
}

/** Starts a match from a lobby fixture and waits for the initial fanout. */
async function startMatch(
  port: number,
  fixture: RoomFixture,
): Promise<Record<string, PrivateCollector>> {
  const collectors: Record<string, PrivateCollector> = {};
  for (const seat of fixture.seats) {
    collectors[seat.playerId] = collectEvents<GamePrivateStateBroadcast>(
      seat.socket,
      ServerEvents.gamePrivateState,
    );
  }
  const startAck = await emitAck<RoomStartData>(fixture.host.socket, ClientEvents.roomStart, {
    code: fixture.code,
  });
  if (!startAck.ok) {
    throw new Error(`room:start failed: ${startAck.error.code} ${startAck.error.message}`);
  }
  await Promise.all(fixture.seats.map((seat) => waitForCount(collectors[seat.playerId]!, 1)));
  return collectors;
}

/** Finds the seat that currently owes a decision and its first canonical command. */
function nextLegalSeat(
  fixture: RoomFixture,
  collectors: Record<string, PrivateCollector>,
): { seat: SeatFixture; command: TurnCommand } | undefined {
  for (const seat of fixture.seats) {
    const latest = latestPrivate(collectors[seat.playerId]!);
    const actions = latest?.privateView.legalActions ?? [];
    if (actions.length > 0) {
      return { seat, command: actions[0]! };
    }
  }
  return undefined;
}

/** Waits until some seat holds a nonempty canonical legal-action list. */
async function waitForLegalSeat(
  fixture: RoomFixture,
  collectors: Record<string, PrivateCollector>,
  timeoutMs = 5_000,
): Promise<{ seat: SeatFixture; command: TurnCommand }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = nextLegalSeat(fixture, collectors);
    if (found !== undefined) {
      return found;
    }
    await sleep(20);
  }
  throw new Error('no seat held legal actions in time');
}

describe('gateway game sessions', () => {
  jest.setTimeout(120_000);
  let server: ServerHandles;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('the initial deal fans out public state to the room and private state per seat', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const hostPublic = collectEvents<GamePublicStateBroadcast>(
        fixture.host.socket,
        ServerEvents.gamePublicState,
      );
      const guestPublic = collectEvents<GamePublicStateBroadcast>(
        fixture.guests[0]!.socket,
        ServerEvents.gamePublicState,
      );

      const collectors = await startMatch(server.port, fixture);

      // One seat never receives another seat's private view: every private
      // broadcast addressed to a seat is authored for that seat only, and no
      // seat's hand instance ids ever leak into another seat's stream.
      const serializedPerSeat = fixture.seats.map((seat) =>
        JSON.stringify(collectors[seat.playerId]),
      );
      for (const seat of fixture.seats) {
        const own = collectors[seat.playerId]!;
        expect(own.length).toBeGreaterThan(0);
        for (const broadcast of own) {
          expect(broadcast.playerId).toBe(seat.playerId);
          expect(broadcast.privateView.viewerId).toBe(seat.playerId);
        }
        const ownHandIds = (latestPrivate(collectors[seat.playerId]!)!.privateView.hand ?? []).map(
          (card) => card.instanceId,
        );
        for (const [index, other] of fixture.seats.entries()) {
          if (other === seat) {
            continue;
          }
          for (const id of ownHandIds) {
            // Quoted so near-miss ids (card-7-1 vs card-7-11) never collide.
            expect(serializedPerSeat[index]).not.toContain(`"${id}"`);
          }
        }
      }

      expect(latestPrivate(collectors[fixture.host.playerId]!)).toBeDefined();
      for (const seat of fixture.seats) {
        const broadcast = latestPrivate(collectors[seat.playerId]!)!;
        expect(broadcast.playerId).toBe(seat.playerId);
        expect(broadcast.privateView.viewerId).toBe(seat.playerId);
        expect(broadcast.privateView.hand).toHaveLength(1);
        expect(typeof broadcast.privateView.hand[0]!.instanceId).toBe('string');
        expect(Array.isArray(broadcast.privateView.legalActions)).toBe(true);
        expect(broadcast.privateView.pendingDecision).toBeNull();
      }

      await waitForCount(hostPublic, 1);
      await waitForCount(guestPublic, 1);
      expect(hostPublic).toHaveLength(1);
      expect(guestPublic).toHaveLength(1);
      expect(hostPublic[0]!.publicView).toEqual(guestPublic[0]!.publicView);
      expect(hostPublic[0]!.publicView.round).not.toBeNull();
      expect(hostPublic[0]!.publicView.round!.drawPileCount).toBeGreaterThan(0);

      // The public stream never carries card identities or private fields.
      const publicSerialized = JSON.stringify([hostPublic[0], guestPublic[0]]);
      expect(publicSerialized).not.toContain('instanceId');
      expect(publicSerialized).not.toContain('pendingDecision');
    } finally {
      closeRoom(fixture);
    }
  });

  it('a legal command acks, emits sanitized events, and refreshes every seat state', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      // Both collectors attach before the start so every fanout lands.
      const actorEvents = collectEvents<GameEventBroadcast>(
        fixture.guests[0]!.socket,
        ServerEvents.gameEvent,
      );
      const hostPublicCollector = collectEvents<GamePublicStateBroadcast>(
        fixture.host.socket,
        ServerEvents.gamePublicState,
      );
      const collectors = await startMatch(server.port, fixture);
      await waitForCount(hostPublicCollector, 1);

      const { seat, command } = await waitForLegalSeat(fixture, collectors);
      expect(command.type).toBe('DRAW_CARD');
      const ack = await emitAck<GameCommandData>(seat.socket, ClientEvents.gameCommand, {
        code: fixture.code,
        command,
      });
      expect(ack.ok).toBe(true);
      if (!ack.ok) {
        throw new Error(ack.error.message);
      }
      expect(ack.data.events).toHaveLength(1);
      expect(ack.data.events[0]!.type).toBe('CARD_DRAWN');
      expect(ack.data.publicView.round!.phase).toBe('PLAY_REQUIRED');

      await waitForCount(actorEvents, 1);
      const serialized = JSON.stringify(actorEvents[0]);
      expect(serialized).not.toContain('instanceId');
      expect(actorEvents[0]!.events[0]!.type).toBe('CARD_DRAWN');

      // Fresh public + private fanout after the command.
      await waitForCount(hostPublicCollector, 2);
      await waitForCount(collectors[seat.playerId]!, 2);
      const actorPrivate = latestPrivate(collectors[seat.playerId]!)!;
      expect(actorPrivate.privateView.hand).toHaveLength(2);
      const otherSeat = fixture.seats.find((candidate) => candidate !== seat)!;
      await waitForCount(collectors[otherSeat.playerId]!, 2);
      expect(latestPrivate(collectors[otherSeat.playerId]!)!.privateView.hand).toHaveLength(1);
    } finally {
      closeRoom(fixture);
    }
  });

  it('out-of-turn and spoofed commands are rejected without mutating state', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const hostPublic = collectEvents<GamePublicStateBroadcast>(
        fixture.host.socket,
        ServerEvents.gamePublicState,
      );
      await startMatch(server.port, fixture);
      await waitForCount(hostPublic, 1);
      const baseline = hostPublic[0]!.publicView;
      const currentPlayerId = baseline.round!.currentPlayerId;
      const currentSeat = fixture.seats.find((seat) => seat.playerId === currentPlayerId)!;
      const otherSeat = fixture.seats.find((seat) => seat !== currentSeat)!;

      // Out-of-turn: the wrong seat draws under its own identity.
      const outOfTurn = await emitAck<GameCommandData>(otherSeat.socket, ClientEvents.gameCommand, {
        code: fixture.code,
        command: { type: 'DRAW_CARD', actorId: otherSeat.playerId },
      });
      expect(outOfTurn.ok).toBe(false);
      if (!outOfTurn.ok) {
        expect(outOfTurn.error.code).toBe('ENGINE_REJECTED');
        expect(outOfTurn.error.engineCode).toBe('NOT_YOUR_TURN');
      }

      // Spoof: the current seat forges the other player's actor id.
      const spoof = await emitAck<GameCommandData>(currentSeat.socket, ClientEvents.gameCommand, {
        code: fixture.code,
        command: { type: 'DRAW_CARD', actorId: otherSeat.playerId },
      });
      expect(spoof.ok).toBe(false);
      if (!spoof.ok) {
        expect(spoof.error.code).toBe('ACTOR_NOT_AUTHENTICATED');
        expect(spoof.error.engineCode).toBeUndefined();
      }

      // No broadcast fanout happened and the public state is unchanged.
      expect(hostPublic).toHaveLength(1);
      expect(hostPublic[0]!.publicView).toEqual(baseline);
    } finally {
      closeRoom(fixture);
    }
  });

  it('drives canonical legal actions over sockets until the match truly ends', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      // Attached before the start so the match:ended broadcast is captured.
      const matchEnded = collectEvents<MatchEndedBroadcast>(
        fixture.host.socket,
        ServerEvents.matchEnded,
      );
      const collectors = await startMatch(server.port, fixture);

      let sawRoundEnded = false;
      let sawRoundAdvanced = false;
      let ended = false;
      for (let index = 0; index < 700; index += 1) {
        const { seat, command } = await waitForLegalSeat(fixture, collectors, 5_000);
        const expectedPrivates = collectors[seat.playerId]!.length + 1;
        const ack = await emitAck<GameCommandData>(seat.socket, ClientEvents.gameCommand, {
          code: fixture.code,
          command,
        });
        if (!ack.ok) {
          throw new Error(
            `canonical command rejected: ${ack.error.code} ${ack.error.engineCode ?? ''} ${ack.error.message}`,
          );
        }
        if (ack.data.events.some((event) => event.type === 'ROUND_ENDED')) {
          sawRoundEnded = true;
        }
        if (ack.data.roundAdvanced) {
          sawRoundAdvanced = true;
        }
        if (ack.data.matchEnded) {
          ended = true;
          break;
        }
        // Let the acting seat's fresh private state arrive before the next turn.
        await waitForCount(collectors[seat.playerId]!, expectedPrivates);
      }

      // The loop must genuinely reach the match end, not stop silently.
      expect(ended).toBe(true);
      expect(sawRoundEnded).toBe(true);
      expect(sawRoundAdvanced).toBe(true);

      // Socket-level match-ended contract: a match:ended broadcast carrying the
      // winners and the room snapshot after the registry's FINISHED transition.
      await waitForCount(matchEnded, 1);
      expect(matchEnded[0]!.roomCode).toBe(fixture.code);
      expect(matchEnded[0]!.room.status).toBe('FINISHED');
      expect(matchEnded[0]!.winners.length).toBeGreaterThan(0);

      // Last-seat leave after FINISHED is allowed and cleans up the session:
      // the room disappears and nothing is left to join.
      const hostLeave = await emitAck<RoomLeaveData>(fixture.host.socket, ClientEvents.roomLeave, {
        code: fixture.code,
      });
      expect(hostLeave.ok).toBe(true);
      if (!hostLeave.ok) {
        throw new Error(hostLeave.error.message);
      }
      expect(hostLeave.data.room).not.toBeNull();

      const guestLeave = await emitAck<RoomLeaveData>(
        fixture.guests[0]!.socket,
        ClientEvents.roomLeave,
        { code: fixture.code },
      );
      expect(guestLeave.ok).toBe(true);
      if (!guestLeave.ok) {
        throw new Error(guestLeave.error.message);
      }
      expect(guestLeave.data.room).toBeNull();

      const fresh = await connectClient(server.port);
      try {
        const join = await emitAck<RoomJoinData>(fresh, ClientEvents.roomJoin, {
          code: fixture.code,
          displayName: 'Late',
        });
        expect(join.ok).toBe(false);
        if (!join.ok) {
          expect(join.error.code).toBe('ROOM_NOT_FOUND');
        }
      } finally {
        fresh.close();
      }
    } finally {
      closeRoom(fixture);
    }
  });
});
