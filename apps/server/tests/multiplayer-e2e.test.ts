/**
 * Milestone 6 final socket acceptance: a real Socket.IO client harness proving
 * 2, 3, 4, 5, and 6 simulated clients can each complete a full match.
 *
 * The harness drives every match exclusively through the public socket
 * contract — it never inspects canonical state or imports `runMatch` to choose
 * commands. For each player count it creates a room, joins every seat, has the
 * host start, then loops: read the authenticated seats' latest
 * `game:private-state.legalActions`, require exactly one seat to be authorized,
 * and echo one exact TurnCommand through `game:command`. Each match is bounded
 * by a wall-clock timeout and a command budget with room/playerCount/step
 * diagnostics.
 *
 * Exit criteria asserted per match: every ack succeeds, one and only one seat
 * is authorized per command, `ack.matchEnded` and `match:ended` eventually
 * occur, the room reaches FINISHED with nonempty in-roster winners,
 * public/`game:event` payloads carry no instanceId/reconnectToken/private
 * pending/commands, every private fanout's viewerId matches its socket seat,
 * and no client ever receives another seat's private hand identities.
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
  type RoomStartData,
  type RoomUpdatedEvent,
} from '../src/gateway/contracts';
import {
  closeRoom,
  collectEvents,
  createLobbyRoom,
  emitAck,
  sleep,
  waitForCount,
  type RoomFixture,
  type SeatFixture,
} from './helpers/socket-client';

/** Wall-clock bound for one full match. */
const MATCH_WALL_CLOCK_TIMEOUT_MS = 120_000;

/** Maximum commands the harness will echo in one match before declaring failure. */
const COMMAND_BUDGET = 1_000;

/** How long the harness keeps polling for an authorized seat before failing. */
const SELECTION_TIMEOUT_MS = 5_000;

/**
 * Substrings that must never appear in any public-facing payload. Quoted key
 * forms avoid false positives (`hiddenCardCount` is public; `hiddenCard` is
 * not).
 */
const FORBIDDEN_PUBLIC_SUBSTRINGS = [
  'instanceId',
  'reconnectToken',
  'cardInstanceId',
  '"pendingDecision"',
  '"legalActions"',
  '"hiddenCard"',
] as const;

/** Per-seat collector of `game:private-state` broadcasts. */
type PrivateCollector = GamePrivateStateBroadcast[];

/** Diagnostic context baked into every harness failure message. */
interface MatchContext {
  room: string;
  playerCount: number;
}

function tag(context: MatchContext, step: number): string {
  return `[room ${context.room} players ${context.playerCount} step ${step}]`;
}

/**
 * Resolves the single seat currently authorized to act and the exact first
 * canonical command it may send, reading only the latest private fanout of
 * each seat. Lockstep generation alignment guarantees every collector already
 * holds the fanout produced by the previous command, so the observation is
 * never stale.
 */
function observeAuthorizedSeat(
  fixture: RoomFixture,
  collectors: Record<string, PrivateCollector>,
  generation: number,
): { seat: SeatFixture; command: TurnCommand } | { conflict: SeatFixture[] } | undefined {
  const authorized: { seat: SeatFixture; command: TurnCommand }[] = [];
  for (const seat of fixture.seats) {
    const latest = collectors[seat.playerId]![collectors[seat.playerId]!.length - 1];
    // The seat's fanout for the current generation has not landed yet; it is
    // simply not observable yet and the caller keeps polling.
    if (latest === undefined || collectors[seat.playerId]!.length < generation) {
      continue;
    }
    const actions = latest.privateView.legalActions;
    if (actions.length > 0) {
      authorized.push({ seat, command: actions[0]! });
    }
  }
  if (authorized.length === 1) {
    return authorized[0]!;
  }
  if (authorized.length > 1) {
    return { conflict: authorized.map((entry) => entry.seat) };
  }
  return undefined;
}

/**
 * Polls until exactly one seat is authorized to act, or fails with rich
 * diagnostics. Zero authorized seats for the whole window is a harness failure
 * (a live round must always offer its current actor or pending actor a legal
 * command); more than one at the same generation is a gateway privacy or
 * state-consistency failure.
 */
async function waitForAuthorizedSeat(
  fixture: RoomFixture,
  collectors: Record<string, PrivateCollector>,
  generation: number,
  context: MatchContext,
  step: number,
): Promise<{ seat: SeatFixture; command: TurnCommand }> {
  const deadline = Date.now() + SELECTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const observed = observeAuthorizedSeat(fixture, collectors, generation);
    if (observed !== undefined) {
      if ('conflict' in observed) {
        throw new Error(
          `${tag(context, step)} ${observed.conflict.length} seats simultaneously authorized: ${observed.conflict
            .map((seat) => seat.playerId)
            .join(', ')}`,
        );
      }
      return observed;
    }
    await sleep(20);
  }
  const latestBySeat = fixture.seats.map((seat) => {
    const latest = collectors[seat.playerId]![collectors[seat.playerId]!.length - 1];
    return `${seat.playerId}: actions=${latest?.privateView.legalActions.length ?? 'none'}`;
  });
  throw new Error(
    `${tag(context, step)} no seat held legal actions within ${SELECTION_TIMEOUT_MS}ms; ${latestBySeat.join('; ')}`,
  );
}

/** Waits until every seat's private collector reaches `generation` entries. */
async function waitForGeneration(
  fixture: RoomFixture,
  collectors: Record<string, PrivateCollector>,
  generation: number,
  context: MatchContext,
  step: number,
): Promise<void> {
  const deadline = Date.now() + SELECTION_TIMEOUT_MS;
  for (const seat of fixture.seats) {
    while (collectors[seat.playerId]!.length < generation) {
      if (Date.now() > deadline) {
        throw new Error(
          `${tag(context, step)} private fanout for generation ${generation} did not reach seat ${seat.playerId} within ${SELECTION_TIMEOUT_MS}ms`,
        );
      }
      await sleep(15);
    }
  }
}

/** Result of one harness-driven match. */
interface DriveResult {
  /** Number of commands echoed (the final one ended the match). */
  steps: number;
  /** Every successful `game:command` ack payload, in send order. */
  acks: GameCommandData[];
}

/**
 * Drives one match to completion by echoing canonical legal actions through
 * real sockets. Every failure carries the room, playerCount, and step.
 */
async function driveMatchToCompletion(
  fixture: RoomFixture,
  collectors: Record<string, PrivateCollector>,
  context: MatchContext,
): Promise<DriveResult> {
  const deadline = Date.now() + MATCH_WALL_CLOCK_TIMEOUT_MS;
  const acks: GameCommandData[] = [];
  let generation = 1; // after room:start, every seat holds exactly one fanout
  for (let step = 1; step <= COMMAND_BUDGET; step += 1) {
    if (Date.now() > deadline) {
      throw new Error(
        `${tag(context, step)} match exceeded the ${MATCH_WALL_CLOCK_TIMEOUT_MS}ms wall-clock budget after ${acks.length} commands`,
      );
    }
    const { seat, command } = await waitForAuthorizedSeat(
      fixture,
      collectors,
      generation,
      context,
      step,
    );
    const ack = await emitAck<GameCommandData>(seat.socket, ClientEvents.gameCommand, {
      code: fixture.code,
      command,
    });
    if (!ack.ok) {
      throw new Error(
        `${tag(context, step)} ${command.type} by ${seat.playerId} rejected: ${ack.error.code}${ack.error.engineCode ? `/${ack.error.engineCode}` : ''} ${ack.error.message}`,
      );
    }
    acks.push(ack.data);
    if (ack.data.matchEnded) {
      return { steps: step, acks };
    }
    generation += 1;
    await waitForGeneration(fixture, collectors, generation, context, step);
  }
  throw new Error(
    `${tag(context, COMMAND_BUDGET)} command budget of ${COMMAND_BUDGET} exhausted without a match end`,
  );
}

describe('Milestone 6 final socket acceptance', () => {
  jest.setTimeout(600_000);
  let server: ServerHandles;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it.each([2, 3, 4, 5, 6])(
    'drives %i simulated clients through a full match over real sockets',
    async (playerCount) => {
      const fixture = await createLobbyRoom(server.port, playerCount - 1);
      const context: MatchContext = { room: fixture.code, playerCount };

      // Every collector attaches before room:start so no broadcast is missed.
      const collectors: Record<string, PrivateCollector> = {};
      const gameEvents: Record<string, GameEventBroadcast[]> = {};
      const publicStates: Record<string, GamePublicStateBroadcast[]> = {};
      const roomUpdates: Record<string, RoomUpdatedEvent[]> = {};
      const matchEndeds: Record<string, MatchEndedBroadcast[]> = {};
      for (const seat of fixture.seats) {
        collectors[seat.playerId] = collectEvents<GamePrivateStateBroadcast>(
          seat.socket,
          ServerEvents.gamePrivateState,
        );
        gameEvents[seat.playerId] = collectEvents<GameEventBroadcast>(
          seat.socket,
          ServerEvents.gameEvent,
        );
        publicStates[seat.playerId] = collectEvents<GamePublicStateBroadcast>(
          seat.socket,
          ServerEvents.gamePublicState,
        );
        roomUpdates[seat.playerId] = collectEvents<RoomUpdatedEvent>(
          seat.socket,
          ServerEvents.roomUpdated,
        );
        matchEndeds[seat.playerId] = collectEvents<MatchEndedBroadcast>(
          seat.socket,
          ServerEvents.matchEnded,
        );
      }

      try {
        const startAck = await emitAck<RoomStartData>(fixture.host.socket, ClientEvents.roomStart, {
          code: fixture.code,
        });
        if (!startAck.ok) {
          throw new Error(
            `${tag(context, 0)} room:start failed: ${startAck.error.code} ${startAck.error.message}`,
          );
        }
        expect(startAck.data.room.status).toBe('IN_MATCH');
        expect(startAck.data.publicView.round).not.toBeNull();
        await waitForGeneration(fixture, collectors, 1, context, 0);

        const result = await driveMatchToCompletion(fixture, collectors, context);

        // -- command-level contract -----------------------------------------
        expect(result.steps).toBeGreaterThan(0);
        expect(result.steps).toBeLessThanOrEqual(COMMAND_BUDGET);
        // Only the final command ends the match; the match spans several rounds,
        // so at least one auto round-advance must have occurred on the way.
        const finalAck = result.acks[result.acks.length - 1]!;
        expect(finalAck.matchEnded).toBe(true);
        for (const ack of result.acks.slice(0, -1)) {
          expect(ack.matchEnded).toBe(false);
        }
        expect(result.acks.some((ack) => ack.roundAdvanced)).toBe(true);

        // -- terminal broadcast contract ------------------------------------
        const rosterIds = new Set(fixture.seats.map((seat) => seat.playerId));
        for (const seat of fixture.seats) {
          const ended = matchEndeds[seat.playerId]!;
          await waitForCount(ended, 1);
          expect(ended).toHaveLength(1);
          expect(ended[0]!.roomCode).toBe(fixture.code);
          expect(ended[0]!.room.status).toBe('FINISHED');
          expect(ended[0]!.winners.length).toBeGreaterThan(0);
          for (const winnerId of ended[0]!.winners) {
            expect(rosterIds.has(winnerId)).toBe(true);
          }
        }

        // -- private fanout addressing and hand isolation --------------------
        // Every successful command fans out exactly one private broadcast per
        // connected seat (plus the initial deal), so all collectors must hold
        // the same number of generations.
        const generationCount = collectors[fixture.seats[0]!.playerId]!.length;
        expect(generationCount).toBe(1 + result.steps);
        for (const seat of fixture.seats) {
          const own = collectors[seat.playerId]!;
          expect(own.length).toBe(generationCount);
          for (const broadcast of own) {
            expect(broadcast.roomCode).toBe(fixture.code);
            expect(broadcast.playerId).toBe(seat.playerId);
            expect(broadcast.privateView.viewerId).toBe(seat.playerId);
          }
        }
        // Hand identities are disjoint across seats at every single generation:
        // no client ever holds another seat's private hand identities. Card
        // identities may legitimately migrate between seats across generations
        // (HANDS_SWAPPED), so disjointness is only asserted per generation.
        for (let index = 0; index < generationCount; index += 1) {
          const seen = new Set<string>();
          for (const seat of fixture.seats) {
            for (const card of collectors[seat.playerId]![index]!.privateView.hand) {
              expect(seen.has(card.instanceId)).toBe(false);
              seen.add(card.instanceId);
            }
          }
        }

        // -- public-channel privacy ------------------------------------------
        const publicPayloads: unknown[] = [
          ...result.acks.map((ack) => ({ events: ack.events, publicView: ack.publicView })),
        ];
        for (const seat of fixture.seats) {
          publicPayloads.push(...gameEvents[seat.playerId]!);
          publicPayloads.push(...publicStates[seat.playerId]!);
          publicPayloads.push(...roomUpdates[seat.playerId]!);
          publicPayloads.push(...matchEndeds[seat.playerId]!);
        }
        const serializedPublic = JSON.stringify(publicPayloads);
        for (const forbidden of FORBIDDEN_PUBLIC_SUBSTRINGS) {
          expect(serializedPublic).not.toContain(forbidden);
        }
      } finally {
        closeRoom(fixture);
      }
    },
  );
});
