/**
 * In-memory authoritative game-session aggregate (Milestone 6 server work
 * unit 3; multiplayer spec §§5,6,8; engine spec §§9,15,16,21).
 *
 * Normative design under test:
 * - One session per room code, started from a 2-6-seat room roster with stable
 *   ids/names; duplicate start and invalid room status are rejected.
 * - The session owns exactly one per-session engine RNG stream derived from an
 *   injected/default nonnegative seed factory and passes it to `setupRound` and
 *   every `applyTurnCommand` (Card 7 is safe without caller-supplied RNG).
 * - Authoritative `handleCommand(roomCode, authenticatedPlayerId, command)`
 *   rejects actor spoofing before the engine, delegates semantic validation to
 *   `applyTurnCommand`, never partially mutates on rejection, and returns typed
 *   error details.
 * - After a successful command the session asserts engine invariants; on
 *   ROUND_END it immediately applies the round result, then either auto-sets up
 *   the next round with a random starter from the same engine RNG or retains
 *   the ended round at MATCH_END for reveal/discard projection.
 * - Read-only/copy snapshots and projected public/private views overlay
 *   RoomSnapshot transport connectivity onto copied match/round players by id
 *   without mutating engine state; private projection keeps the engine's
 *   PLAYER_NOT_IN_GAME behavior.
 */
import type { RoundState, TurnCommand, TurnErrorCode } from '@power-hungry-pets/game-engine';
import { ProjectionError } from '@power-hungry-pets/game-engine';
import * as engineModule from '@power-hungry-pets/game-engine';
import { PublicEventError, PublicEventErrorCode } from '../src/projection/public-events';
import * as publicEventsModule from '../src/projection/public-events';
import { GameSessionError, GameSessionErrorCode } from '../src/session/session.errors';
import { GameSessionService } from '../src/session/game-session.service';
import type {
  GameSessionSnapshot,
  HandleCommandResult,
  SeedFactory,
} from '../src/session/session.types';
import { RoomStatus, type RoomSnapshot } from '../src/room/room.types';

// -- fixtures -----------------------------------------------------------------

function roomFixture(
  seats = 3,
  status: RoomStatus = RoomStatus.Lobby,
  code = 'ABCDE',
): RoomSnapshot {
  return {
    roomId: 'room-1111-2222',
    code,
    status,
    hostPlayerId: 'player-1',
    createdAt: 0,
    players: Array.from({ length: seats }, (_, index) => ({
      playerId: `player-${index + 1}`,
      displayName: `Player ${index + 1}`,
      seatNumber: index + 1,
      connected: true,
      isHost: index === 0,
      joinedAt: index,
    })),
  };
}

interface Harness {
  readonly service: GameSessionService;
  readonly roomCode: string;
}

function startSession(seed: number, room: RoomSnapshot): Harness {
  const seedFactory: SeedFactory = () => seed;
  const service = new GameSessionService({ seedFactory });
  service.startSession(room);
  return { service, roomCode: room.code };
}

function snapshotOf(harness: Harness): GameSessionSnapshot {
  const snapshot = harness.service.getSnapshot(harness.roomCode);
  if (snapshot === undefined) {
    throw new Error(`session for room ${harness.roomCode} disappeared unexpectedly`);
  }
  return snapshot;
}

function roundOf(harness: Harness): RoundState {
  const snapshot = snapshotOf(harness);
  if (snapshot.round === null) {
    throw new Error('expected a live round, but no round is attached');
  }
  return snapshot.round;
}

function expectSessionError(code: GameSessionErrorCode, run: () => unknown): GameSessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GameSessionError);
    const sessionError = error as GameSessionError;
    expect(sessionError.code).toBe(code);
    return sessionError;
  }
  throw new Error(`expected GameSessionError with code ${code}, but nothing was thrown`);
}

function expectRejection(
  result: HandleCommandResult,
  error: GameSessionErrorCode,
  engineCode: TurnErrorCode | null = null,
): void {
  if (result.ok) {
    throw new Error(`expected a rejected command (${error}), but it succeeded`);
  }
  expect(result.error).toBe(error);
  expect(result.engineCode).toBe(engineCode);
}

function expectSuccess(result: HandleCommandResult): Extract<HandleCommandResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a successful command, got ${result.error} (${result.engineCode})`);
  }
  return result;
}

/**
 * Finds the smallest seed whose round-1 deal satisfies the predicate. The scan
 * reuses the same started session it inspected, so the returned harness
 * continues from the exact scanned RNG state.
 */
function findSeed(predicate: (round: RoundState) => boolean, seats = 3): Harness {
  for (let seed = 0; seed < 500; seed += 1) {
    const harness = startSession(seed, roomFixture(seats));
    if (predicate(roundOf(harness))) {
      return harness;
    }
  }
  throw new Error('no satisfying seed found within 500 tries');
}

function currentPlayerOf(round: RoundState) {
  const player = round.players.find((candidate) => candidate.id === round.currentPlayerId);
  if (player === undefined) {
    throw new Error('round has no current player');
  }
  return player;
}

/**
 * Deterministic legal driver: reads the authoritative (server-owned) snapshot
 * and always issues the first canonical legal action, resolving pending stages
 * mechanically. Stops after the command that advanced or ended the match.
 */
function driveRoundToEnd(harness: Harness, maxSteps = 3000) {
  for (let step = 0; step < maxSteps; step += 1) {
    const round = roundOf(harness);
    const command = nextDriverCommand(round);
    const result = harness.service.handleCommand(harness.roomCode, command.actorId, command);
    if (!result.ok) {
      if (result.error === GameSessionErrorCode.EngineRejected) {
        throw new Error(`driver command was rejected by the engine: ${result.engineCode}`);
      }
      throw new Error(`driver command failed unexpectedly: ${result.error}`);
    }
    if (result.roundAdvanced || result.matchEnded) {
      return result;
    }
  }
  throw new Error('driver did not reach a round end within the step budget');
}

function nextDriverCommand(round: RoundState): TurnCommand {
  const pending = round.pendingInteraction;
  if (pending !== null) {
    switch (pending.type) {
      case 'PECERA_TARGET': {
        const target = round.players.find(
          (candidate) =>
            candidate.id !== pending.actorId && !candidate.eliminated && !candidate.protected,
        );
        if (target === undefined) {
          throw new Error('driver: no legal Pecera target exists');
        }
        return { type: 'CHOOSE_TARGET', actorId: pending.actorId, targetId: target.id };
      }
      case 'PECERA_GUESS': {
        const target = round.players.find((candidate) => candidate.id === pending.targetId);
        const actual = target?.hand[0]?.value ?? 0;
        return {
          type: 'SUBMIT_GUESS',
          actorId: pending.actorId,
          value: actual === 1 ? 0 : actual,
        };
      }
      case 'RATON_INSERT_POSITION':
        return { type: 'CHOOSE_DECK_POSITION', actorId: pending.actorId, index: 0 };
      case 'SAQUEADOG_SWAP':
        return { type: 'CHOOSE_HIDDEN_SWAP', actorId: pending.actorId, swap: false };
    }
  }
  if (round.phase === 'DRAW_REQUIRED') {
    return { type: 'DRAW_CARD', actorId: round.currentPlayerId };
  }
  const actor = currentPlayerOf(round);
  const others = round.players.filter(
    (candidate) => candidate.id !== actor.id && !candidate.eliminated && !candidate.protected,
  );
  const target = others[0];
  // Prefer a non-Ratón card so the detached pending card keeps cycling through
  // the pile instead of living in a hand; Ratón is played only when mandatory.
  const card =
    actor.hand.find((candidate) => candidate.type !== 'RATON_TRAMPERO') ?? actor.hand[0]!;
  const needsTarget =
    card.type === 'ERMITANO_BUSCA_CASA' ||
    card.type === 'CONEJITO_GUERRILLERO' ||
    card.type === 'SERPIENTE_ENCANTADORA';
  return {
    type: 'PLAY_CARD',
    actorId: actor.id,
    cardInstanceId: card.instanceId,
    targetId: needsTarget ? target?.id : undefined,
  };
}

// -- session lifecycle --------------------------------------------------------

describe('GameSessionService — start', () => {
  it('starts one deterministic session per room code from the room roster', () => {
    const room = roomFixture();
    const first = startSession(7, room);
    const second = startSession(7, roomFixture());

    const a = snapshotOf(first);
    const b = snapshotOf(second);
    expect(a).toEqual(b);

    const roster = a.match.players;
    expect(roster.map((player) => player.id)).toEqual(['player-1', 'player-2', 'player-3']);
    expect(roster.map((player) => player.name)).toEqual(['Player 1', 'Player 2', 'Player 3']);
    expect(a.match.status).toBe('LOBBY');
    expect(a.match.roundNumber).toBe(0);
    expect(a.match.winners).toEqual([]);
    expect(a.round?.status).toBe('ROUND_ACTIVE');
    expect(a.round?.roundNumber).toBe(1);
    expect(a.round?.players.every((player) => player.hand.length === 1)).toBe(true);
    expect(a.lastRound).toBeNull();
  });

  it('rejects a duplicate start for the same room code and keeps the original session', () => {
    const room = roomFixture();
    const harness = startSession(7, room);
    const before = snapshotOf(harness);

    expectSessionError(GameSessionErrorCode.SessionAlreadyExists, () => {
      harness.service.startSession(roomFixture());
    });
    expect(snapshotOf(harness)).toEqual(before);
  });

  it('rejects a start from a room snapshot that is not in LOBBY status', () => {
    for (const status of [
      RoomStatus.Created,
      RoomStatus.InMatch,
      RoomStatus.Finished,
      RoomStatus.Expired,
    ]) {
      expectSessionError(GameSessionErrorCode.InvalidRoomStatus, () => {
        startSession(7, roomFixture(3, status));
      });
    }
  });

  it('rejects rosters outside the 2-6 seat range or with duplicate/blank identities', () => {
    expectSessionError(GameSessionErrorCode.InvalidRoster, () => {
      startSession(7, roomFixture(1));
    });
    expectSessionError(GameSessionErrorCode.InvalidRoster, () => {
      startSession(7, roomFixture(7));
    });

    const duplicated = roomFixture(3);
    duplicated.players[2]!.playerId = duplicated.players[0]!.playerId;
    expectSessionError(GameSessionErrorCode.InvalidRoster, () => {
      startSession(7, duplicated);
    });

    const blank = roomFixture(3);
    blank.players[1]!.displayName = '   ';
    expectSessionError(GameSessionErrorCode.InvalidRoster, () => {
      startSession(7, blank);
    });
  });

  it('rejects a seed factory that does not produce a nonnegative integer', () => {
    for (const badSeed of [-1, 1.5, Number.NaN]) {
      const service = new GameSessionService({ seedFactory: () => badSeed });
      expectSessionError(GameSessionErrorCode.InvalidSeed, () => {
        service.startSession(roomFixture());
      });
    }
  });

  it('exposes no snapshot for an unknown room code and normalizes lookups', () => {
    expect(new GameSessionService().getSnapshot('ZZZZZ')).toBeUndefined();
    const harness = startSession(7, roomFixture(3, RoomStatus.Lobby, 'abcde'));
    expect(snapshotOf(harness)).toEqual(harness.service.getSnapshot('  AbCdE '));
  });
});

// -- authorization ------------------------------------------------------------

describe('GameSessionService — handleCommand authorization', () => {
  it('rejects actor spoofing with a typed error before the engine sees the command', () => {
    const harness = startSession(7, roomFixture());
    const before = snapshotOf(harness);
    const current = roundOf(harness).currentPlayerId;
    const impostor = current === 'player-1' ? 'player-2' : 'player-1';

    // The spoofed actor IS the current player: the engine itself would have
    // accepted this command, so a typed rejection here proves the session's
    // pre-engine authorization check runs before the engine ever sees it.
    expectRejection(
      harness.service.handleCommand(harness.roomCode, impostor, {
        type: 'DRAW_CARD',
        actorId: current,
      }),
      GameSessionErrorCode.ActorNotAuthenticated,
    );
    expect(snapshotOf(harness)).toEqual(before);
  });

  it('rejects commands for a session that does not exist', () => {
    const harness = startSession(7, roomFixture());
    const before = snapshotOf(harness);

    expectRejection(
      harness.service.handleCommand('ZZZZZ', 'player-1', {
        type: 'DRAW_CARD',
        actorId: 'player-1',
      }),
      GameSessionErrorCode.SessionNotFound,
    );
    expect(snapshotOf(harness)).toEqual(before);
  });

  it('rejects commands once the match has ended with no active round', () => {
    const harness = findSeedForMatchEnd();
    driveAllRounds(harness);
    expect(snapshotOf(harness).match.status).toBe('MATCH_END');

    expectRejection(
      harness.service.handleCommand(harness.roomCode, 'player-1', {
        type: 'DRAW_CARD',
        actorId: 'player-1',
      }),
      GameSessionErrorCode.NoActiveRound,
    );
  });
});

// -- engine delegation --------------------------------------------------------

describe('GameSessionService — handleCommand engine delegation', () => {
  it('applies a real draw transition and returns the sanitized CARD_DRAWN event', () => {
    const harness = startSession(7, roomFixture());
    const current = roundOf(harness).currentPlayerId;

    const result = harness.service.handleCommand(harness.roomCode, current, {
      type: 'DRAW_CARD',
      actorId: current,
    });

    const success = expectSuccess(result);
    expect(success.events).toStrictEqual([{ type: 'CARD_DRAWN', playerId: current }]);
    expect(success.roundAdvanced).toBe(false);
    expect(success.matchEnded).toBe(false);

    const round = roundOf(harness);
    expect(round.phase).toBe('PLAY_REQUIRED');
    expect(round.players.find((player) => player.id === current)?.hand).toHaveLength(2);
    expect(round.drawPile).toHaveLength(16); // 21-card deck - 3 hands - 1 hidden - 1 draw
  });

  it('returns the engine rejection code unchanged and leaves the state untouched', () => {
    const harness = startSession(7, roomFixture());
    const current = roundOf(harness).currentPlayerId;
    const other = roundOf(harness).players.find((player) => player.id !== current)!;
    const foreignCardId = other.hand[0]!.instanceId;
    harness.service.handleCommand(harness.roomCode, current, {
      type: 'DRAW_CARD',
      actorId: current,
    });
    const before = snapshotOf(harness);

    expectRejection(
      harness.service.handleCommand(harness.roomCode, current, {
        type: 'PLAY_CARD',
        actorId: current,
        cardInstanceId: foreignCardId, // in another player's hand, never the actor's
      }),
      GameSessionErrorCode.EngineRejected,
      'CARD_NOT_IN_HAND',
    );
    expect(snapshotOf(harness)).toEqual(before);

    expectRejection(
      harness.service.handleCommand(harness.roomCode, other.id, {
        type: 'DRAW_CARD',
        actorId: other.id,
      }),
      GameSessionErrorCode.EngineRejected,
      'NOT_YOUR_TURN',
    );
    expect(snapshotOf(harness)).toEqual(before);
  });

  it('rejects a play in the draw phase with the engine UNEXPECTED_COMMAND code', () => {
    const harness = startSession(7, roomFixture());
    const current = roundOf(harness).currentPlayerId;
    const ownCardId = roundOf(harness).players.find((player) => player.id === current)!.hand[0]!
      .instanceId;
    const before = snapshotOf(harness);

    expectRejection(
      harness.service.handleCommand(harness.roomCode, current, {
        type: 'PLAY_CARD',
        actorId: current,
        cardInstanceId: ownCardId,
      }),
      GameSessionErrorCode.EngineRejected,
      'UNEXPECTED_COMMAND',
    );
    expect(snapshotOf(harness)).toEqual(before);
  });
});

// -- Card 7 RNG ownership -----------------------------------------------------

describe('GameSessionService — per-session engine RNG (Card 7 safe)', () => {
  it('plays Card 7 successfully with the session-owned RNG and re-deals every hand', () => {
    const harness = findSeed(
      (round) =>
        round.players.find((player) => player.id === round.currentPlayerId)!.hand[0]!.type ===
        'MALABARISTA_DE_OCHO_PATAS',
    );
    const actor = roundOf(harness).currentPlayerId;
    const malabaristaId = roundOf(harness).players.find((p) => p.id === actor)!.hand[0]!.instanceId;

    const drawn = harness.service.handleCommand(harness.roomCode, actor, {
      type: 'DRAW_CARD',
      actorId: actor,
    });
    expectSuccess(drawn);

    const played = harness.service.handleCommand(harness.roomCode, actor, {
      type: 'PLAY_CARD',
      actorId: actor,
      cardInstanceId: malabaristaId,
    });
    const success = expectSuccess(played);
    // MISSING_RNG must never surface: the session always supplies its own RNG.
    expect(success.events.some((event) => event.type === 'HANDS_REDEALT')).toBe(true);
    expect(JSON.stringify(success.events)).not.toContain('instanceId');

    const round = roundOf(harness);
    expect(round.status).toBe('ROUND_ACTIVE');
    expect(round.players.every((player) => player.hand.length === 1)).toBe(true);
  });

  it('is reproducible: identical seeds produce identical command sequences', () => {
    const seed = 7;
    const harnessA = startSession(seed, roomFixture());
    const harnessB = startSession(seed, roomFixture(3, RoomStatus.Lobby, 'BCDFG'));

    const currentA = roundOf(harnessA).currentPlayerId;
    const currentB = roundOf(harnessB).currentPlayerId;
    expect(currentA).toEqual(currentB);

    harnessA.service.handleCommand(harnessA.roomCode, currentA, {
      type: 'DRAW_CARD',
      actorId: currentA,
    });
    harnessB.service.handleCommand(harnessB.roomCode, currentB, {
      type: 'DRAW_CARD',
      actorId: currentB,
    });

    const a = JSON.stringify(snapshotOf(harnessA).round);
    const b = JSON.stringify(snapshotOf(harnessB).round);
    expect(a).toEqual(b);
  });
});

// -- pending interactions and private views -----------------------------------

describe('GameSessionService — private views and pending restoration', () => {
  it('restores the Saqueadog pending decision privately for the pending actor only', () => {
    const harness = findSeed(
      (round) =>
        round.players.find((player) => player.id === round.currentPlayerId)!.hand[0]!.type ===
        'SAQUEADOG_DE_TUMBAS',
    );
    const actor = roundOf(harness).currentPlayerId;
    const saqueadogId = roundOf(harness).players.find((p) => p.id === actor)!.hand[0]!.instanceId;
    harness.service.handleCommand(harness.roomCode, actor, { type: 'DRAW_CARD', actorId: actor });
    const played = harness.service.handleCommand(harness.roomCode, actor, {
      type: 'PLAY_CARD',
      actorId: actor,
      cardInstanceId: saqueadogId,
    });
    expectSuccess(played);
    expect(roundOf(harness).pendingInteraction).toMatchObject({
      type: 'SAQUEADOG_SWAP',
      actorId: actor,
    });

    const observer = roundOf(harness).players.find((player) => player.id !== actor)!;
    const actorView = harness.service.getPrivateView(harness.roomCode, actor, roomFixture());
    expect(actorView.pendingDecision).toMatchObject({ type: 'SAQUEADOG_SWAP', actorId: actor });
    expect(actorView.pendingDecision).toHaveProperty('hiddenCard.instanceId');
    expect(actorView.hand).toHaveLength(1);

    const observerView = harness.service.getPrivateView(
      harness.roomCode,
      observer.id,
      roomFixture(),
    );
    expect(observerView.pendingDecision).toBeNull();

    // Copy isolation: tampering with the restored pending data cannot touch the
    // authoritative session state.
    (actorView.pendingDecision as unknown as { hiddenCard: { value: number } }).hiddenCard.value =
      999;
    actorView.hand[0]!.instanceId = 'tampered';
    expect(roundOf(harness).pendingInteraction).toMatchObject({
      type: 'SAQUEADOG_SWAP',
      actorId: actor,
    });
  });

  it('overlays transport connectivity onto the private view without mutating engine state', () => {
    const harness = startSession(7, roomFixture());
    const overlay = roomFixture();
    for (const player of overlay.players) {
      player.connected = player.playerId === 'player-1';
    }

    const view = harness.service.getPrivateView(harness.roomCode, 'player-2', overlay);
    const connectedById = new Map(
      view.publicView.players.map((player) => [player.id, player.connected]),
    );
    expect(connectedById.get('player-1')).toBe(true);
    expect(connectedById.get('player-2')).toBe(false);
    expect(connectedById.get('player-3')).toBe(false);

    // The overlay is applied to copies: the authoritative snapshot keeps its
    // engine-derived connected flags.
    const round = roundOf(harness);
    expect(round.players.every((player) => player.connected)).toBe(true);
    expect(snapshotOf(harness).match.players.every((player) => player.connected)).toBe(true);
  });

  it('fails closed with PLAYER_NOT_IN_GAME for a viewer outside the roster', () => {
    const harness = startSession(7, roomFixture());

    expect(() =>
      harness.service.getPrivateView(harness.roomCode, 'intruder', roomFixture()),
    ).toThrow(ProjectionError);
    try {
      harness.service.getPrivateView(harness.roomCode, 'intruder', roomFixture());
    } catch (error) {
      expect((error as ProjectionError).code).toBe('PLAYER_NOT_IN_GAME');
    }
  });
});

// -- round transition and match end ------------------------------------------

describe('GameSessionService — round transition and match end', () => {
  it('auto-sets-up the next round with a random starter when a round ends without match end', () => {
    const harness = startSession(7, roomFixture(3));
    const result = driveRoundToEnd(harness);

    expect(result.roundAdvanced).toBe(true);
    expect(result.matchEnded).toBe(false);

    const snapshot = snapshotOf(harness);
    expect(snapshot.match.status).toBe('ROUND_END');
    expect(snapshot.round).not.toBeNull();
    expect(snapshot.round?.status).toBe('ROUND_ACTIVE');
    expect(snapshot.round?.roundNumber).toBe(2);
    expect(snapshot.round?.winners).toEqual([]);
    expect(snapshot.round?.turnOrder).toEqual(['player-1', 'player-2', 'player-3']);

    expect(snapshot.lastRound).not.toBeNull();
    expect(snapshot.lastRound?.status).toBe('ROUND_END');
    expect(snapshot.lastRound?.roundNumber).toBe(1);
    expect(snapshot.lastRound?.winners.length).toBeGreaterThan(0);
    expect(snapshot.lastRound?.players.some((player) => player.discards.length > 0)).toBe(true);

    // Every round winner received exactly one victory token on the match.
    for (const winnerId of snapshot.lastRound!.winners) {
      const winner = snapshot.match.players.find((player) => player.id === winnerId);
      expect(winner?.victoryTokens).toBe(1);
    }
    expect(snapshot.match.roundNumber).toBe(1);
  });

  it('retains the ended round and stops advancing when the match ends', () => {
    const harness = findSeedForMatchEnd();
    driveAllRounds(harness);

    const snapshot = snapshotOf(harness);
    expect(snapshot.match.status).toBe('MATCH_END');
    expect(snapshot.match.winners.length).toBeGreaterThan(0);
    expect(snapshot.round).toBeNull();

    // The final round is retained for reveal/discard projection.
    expect(snapshot.lastRound).not.toBeNull();
    expect(snapshot.lastRound?.status).toBe('ROUND_END');
    expect(snapshot.lastRound?.roundNumber).toBe(snapshot.match.roundNumber);
    expect(snapshot.lastRound?.winners.length).toBeGreaterThan(0);

    // The threshold is met by every match winner.
    const threshold = snapshot.match.players.length <= 3 ? 3 : 2;
    for (const winnerId of snapshot.match.winners) {
      const winner = snapshot.match.players.find((player) => player.id === winnerId);
      expect(winner?.victoryTokens ?? 0).toBeGreaterThanOrEqual(threshold);
    }
  });

  it('carries MATCH_ENDED and TOKEN_AWARDED in the sanitized result events', () => {
    const harness = findSeedForMatchEnd();
    const finalResult = driveAllRounds(harness);

    expect(finalResult.matchEnded).toBe(true);
    expect(finalResult.roundAdvanced).toBe(false);
    expect(finalResult.events.some((event) => event.type === 'ROUND_ENDED')).toBe(true);
    expect(
      finalResult.events.filter((event) => event.type === 'TOKEN_AWARDED').length,
    ).toBeGreaterThan(0);
    const matchEnded = finalResult.events.find((event) => event.type === 'MATCH_ENDED');
    expect(matchEnded).toBeDefined();
    expect(JSON.stringify(finalResult.events)).not.toContain('instanceId');
  });
});

// -- purity and copy isolation -------------------------------------------------

describe('GameSessionService — snapshot purity', () => {
  it('returns fresh deep copies: tampering with a snapshot cannot corrupt the session', () => {
    const harness = startSession(7, roomFixture());
    const before = snapshotOf(harness);
    const copy = snapshotOf(harness);

    expect(copy).not.toBe(before);
    copy.match.players[0]!.name = 'hacked';
    copy.match.players[0]!.victoryTokens = 999;
    copy.round!.turnOrder.push('player-999');
    copy.round!.pendingInteraction = { type: 'SAQUEADOG_SWAP', actorId: 'player-1' };

    expect(snapshotOf(harness)).toEqual(before);
  });

  it('overlays connectivity on copies: projecting never mutates the authoritative state', () => {
    const harness = startSession(7, roomFixture());
    const before = snapshotOf(harness);
    const overlay = roomFixture();
    for (const player of overlay.players) {
      player.connected = false;
    }

    harness.service.getPublicView(harness.roomCode, overlay);
    expect(snapshotOf(harness)).toEqual(before);
  });
});

// -- transactional command processing (state + RNG rollback) -------------------

describe('GameSessionService — transactional handleCommand', () => {
  /** Finds a seed whose round-1 current player holds Card 7 (RNG-consuming play). */
  function findCardSevenSeed(): number {
    for (let seed = 0; seed < 500; seed += 1) {
      const probe = startSession(seed, roomFixture());
      const round = roundOf(probe);
      if (
        round.players.find((player) => player.id === round.currentPlayerId)!.hand[0]!.type ===
        'MALABARISTA_DE_OCHO_PATAS'
      ) {
        return seed;
      }
    }
    throw new Error('no Card 7 seed found within 500 tries');
  }

  interface FailureScenario {
    readonly name: string;
    /** Installs a safe Jest spy that forces the failure; returns its uninstaller. */
    readonly installFailure: () => () => void;
    readonly expectThrown: (error: unknown) => void;
  }

  const scenarios: FailureScenario[] = [
    {
      name: 'a post-engine round-invariant failure',
      installFailure: () => {
        const spy = jest.spyOn(engineModule, 'assertRoundInvariants').mockImplementation(() => {
          throw new Error('forced round invariant failure');
        });
        return () => spy.mockRestore();
      },
      expectThrown: (error) => {
        expect((error as Error).message).toBe('forced round invariant failure');
      },
    },
    {
      name: 'a post-engine public-event sanitizer failure',
      installFailure: () => {
        const spy = jest
          .spyOn(publicEventsModule, 'sanitizePublicEvents')
          .mockImplementation(() => {
            throw new PublicEventError(
              PublicEventErrorCode.UnknownPublicEvent,
              'forced sanitizer failure',
            );
          });
        return () => spy.mockRestore();
      },
      expectThrown: (error) => {
        expect(error).toBeInstanceOf(PublicEventError);
        expect((error as PublicEventError).code).toBe(PublicEventErrorCode.UnknownPublicEvent);
      },
    },
  ];

  for (const scenario of scenarios) {
    it(`rolls back state and the RNG stream on ${scenario.name}, then retries deterministically like a fresh session`, () => {
      const seed = findCardSevenSeed();
      const harness = startSession(seed, roomFixture());
      // Fresh deterministic control: same seed, same command sequence, no failure.
      const control = startSession(seed, roomFixture());

      // Drive the control session cleanly: draw, then play Card 7 (consumes RNG).
      const controlActor = roundOf(control).currentPlayerId;
      expectSuccess(
        control.service.handleCommand(control.roomCode, controlActor, {
          type: 'DRAW_CARD',
          actorId: controlActor,
        }),
      );
      const controlCardId = roundOf(control).players.find((p) => p.id === controlActor)!.hand[0]!
        .instanceId;
      const controlPlayed = expectSuccess(
        control.service.handleCommand(control.roomCode, controlActor, {
          type: 'PLAY_CARD',
          actorId: controlActor,
          cardInstanceId: controlCardId,
        }),
      );

      // Drive the observed session to the identical pre-play point.
      const actor = roundOf(harness).currentPlayerId;
      expectSuccess(
        harness.service.handleCommand(harness.roomCode, actor, {
          type: 'DRAW_CARD',
          actorId: actor,
        }),
      );
      const cardId = roundOf(harness).players.find((p) => p.id === actor)!.hand[0]!.instanceId;
      const beforePlay = snapshotOf(harness);
      expect(beforePlay.round).not.toBeNull();
      expect(roundOf(harness).phase).toBe('PLAY_REQUIRED');

      const uninstall = scenario.installFailure();
      let thrown: unknown;
      try {
        harness.service.handleCommand(harness.roomCode, actor, {
          type: 'PLAY_CARD',
          actorId: actor,
          cardInstanceId: cardId,
        });
      } catch (error) {
        thrown = error;
      } finally {
        uninstall();
      }
      expect(thrown).toBeDefined();
      scenario.expectThrown(thrown);

      // Authoritative state (match, round, lastRound) is untouched: the failed
      // transaction committed nothing, not even after the engine succeeded.
      expect(snapshotOf(harness)).toEqual(beforePlay);

      // Retry succeeds and matches the fresh deterministic control exactly,
      // proving the RNG stream was rewound to its pre-command checkpoint.
      const retried = expectSuccess(
        harness.service.handleCommand(harness.roomCode, actor, {
          type: 'PLAY_CARD',
          actorId: actor,
          cardInstanceId: cardId,
        }),
      );
      expect(retried.events).toStrictEqual(controlPlayed.events);
      expect(retried.roundAdvanced).toBe(controlPlayed.roundAdvanced);
      expect(retried.matchEnded).toBe(controlPlayed.matchEnded);
      // Same RNG position, deal, and starter as the fresh control; the room
      // code itself is session identity, not engine state, so it may differ.
      const observed = snapshotOf(harness);
      const controlSnapshot = snapshotOf(control);
      expect({ ...observed, roomCode: controlSnapshot.roomCode }).toEqual(controlSnapshot);
    });
  }
});

// -- startup invariant assertions -----------------------------------------------

describe('GameSessionService — startup invariant assertions', () => {
  it('asserts match invariants after match creation and round invariants after setup, before storing', () => {
    const callOrder: string[] = [];
    const matchSpy = jest.spyOn(engineModule, 'assertMatchInvariants').mockImplementation(() => {
      callOrder.push('match');
    });
    const roundSpy = jest.spyOn(engineModule, 'assertRoundInvariants').mockImplementation(() => {
      callOrder.push('round');
    });
    try {
      const service = new GameSessionService({ seedFactory: () => 7 });
      const snapshot = service.startSession(roomFixture());

      expect(callOrder).toEqual(['match', 'round']);
      expect(snapshot.round).not.toBeNull();
      expect(service.getSnapshot('ABCDE')).toEqual(snapshot);
    } finally {
      matchSpy.mockRestore();
      roundSpy.mockRestore();
    }
  });

  it('stores no session when a startup invariant assertion fails', () => {
    const roundSpy = jest.spyOn(engineModule, 'assertRoundInvariants').mockImplementation(() => {
      throw new Error('forced startup round invariant failure');
    });
    try {
      const service = new GameSessionService({ seedFactory: () => 7 });
      expect(() => service.startSession(roomFixture())).toThrow(
        'forced startup round invariant failure',
      );
      expect(service.getSnapshot('ABCDE')).toBeUndefined();
    } finally {
      roundSpy.mockRestore();
    }
  });
});

// -- session teardown ----------------------------------------------------------

describe('GameSessionService — deleteSession', () => {
  it('deletes only the targeted session, reports existence, and keeps other sessions intact', () => {
    const service = new GameSessionService({ seedFactory: () => 7 });
    service.startSession(roomFixture(3, RoomStatus.Lobby, 'AAAAA'));
    service.startSession(roomFixture(3, RoomStatus.Lobby, 'BBBBB'));
    const snapshotA = service.getSnapshot('AAAAA');
    expect(snapshotA).toBeDefined();

    // Deleting is code-normalized and reports whether a session was removed.
    expect(service.deleteSession('  aaaaa ')).toBe(true);
    expect(service.deleteSession('AAAAA')).toBe(false);
    expect(service.deleteSession('ZZZZZ')).toBe(false);
    expect(service.getSnapshot('AAAAA')).toBeUndefined();

    // Copy-safe: the snapshot handed out before deletion stays a valid deep
    // copy, and the untouched sibling session keeps its own live state.
    expect(snapshotA).toBeDefined();
    expect(snapshotA!.round).not.toBeNull();
    const untouched = service.getSnapshot('BBBBB');
    expect(untouched).toBeDefined();
    expect(untouched!.round?.roundNumber).toBe(1);
    expect(untouched!.roomCode).toBe('BBBBB');
  });

  it('allows a fresh session to start for the same room code after deletion', () => {
    const service = new GameSessionService({ seedFactory: () => 7 });
    service.startSession(roomFixture(3, RoomStatus.Lobby, 'DDDDD'));
    expect(service.deleteSession('DDDDD')).toBe(true);

    expect(() => service.startSession(roomFixture(3, RoomStatus.Lobby, 'DDDDD'))).not.toThrow();
    expect(service.getSnapshot('DDDDD')?.round?.roundNumber).toBe(1);
  });
});

// -- helpers over multiple rounds ---------------------------------------------

function findSeedForMatchEnd(): Harness {
  // A 2-player match needs 3 round wins (threshold 3); any deterministic seed
  // is acceptable as long as the driver terminates within the round budget.
  return startSession(11, roomFixture(2, RoomStatus.Lobby, 'MATCH'));
}

function driveAllRounds(
  harness: Harness,
  maxRounds = 12,
): Extract<HandleCommandResult, { ok: true }> {
  for (let round = 0; round < maxRounds; round += 1) {
    const result = driveRoundToEnd(harness);
    if (result.matchEnded) {
      return result;
    }
  }
  throw new Error('match did not end within the round budget');
}
