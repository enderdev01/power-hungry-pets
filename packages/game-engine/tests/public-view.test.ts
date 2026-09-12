/**
 * Milestone 6 work unit 1 — public game-state projection (`views` module).
 *
 * Normative design under test:
 * - `GameSnapshot` combines the canonical `MatchState` with the live
 *   `RoundState` (or `null` between rounds); `getPublicGameView` projects it
 *   into `PublicGameView`: a serializable, privacy-safe view for clients.
 * - Player privacy: ids, names, connection, elimination, protection, victory
 *   tokens, and hand counts are public; hand identities, draw order, hidden
 *   card identity, detached Ratón cards, and chosen Saqueadog choices never
 *   appear. Public discards carry `{ value, type }` plus origin — never a
 *   `CardInstance` or `instanceId`.
 * - Pending interactions expose only their type, actor, and (for Pecera) the
 *   public targetId; no commands, legal actions, or private stages.
 * - The exhaustion ROUND_END reveal is inferred purely from state
 *   (`ROUND_END` + 2+ active players + empty draw pile) and exposes survivor
 *   hand values/types without instanceIds; a last-survivor ROUND_END never
 *   exposes its hand.
 * - Every projection returns fresh plain objects: mutating the input after
 *   projection cannot change the view, and mutating the view cannot change the
 *   canonical state. JSON serialization is deterministic and round-trips.
 */
import {
  applyRoundResult,
  applyTurnCommand,
  CARD_CATALOG,
  createMatchState,
  createRngStream,
  ENGINE_STREAM,
  getPublicGameView,
  POLICY_STREAM,
  ProjectionError,
  selectLegalAction,
  setupRound,
  type CardInstance,
  type CardType,
  type GameSnapshot,
  type MatchState,
  type PendingInteraction,
  type PlayerState,
  type PublicGameView,
  type PublicRoundView,
  type RoundState,
  type TurnEngineDependencies,
} from '../src';

/** Card type consistent with the catalog for the given printed value. */
function typeForValue(value: number): CardType {
  const definition = CARD_CATALOG.find((candidate) => candidate.value === value);
  if (!definition) {
    throw new Error(`Test fixture is missing a catalog card of value ${value}`);
  }
  return definition.type;
}

/** Hand-crafted card with a controlled secret identity (never public). */
function secretCard(value: number): CardInstance {
  return { instanceId: `secret-${value}`, value, type: typeForValue(value) };
}

/**
 * Walks parsed JSON output collecting every string and every object, so leak
 * assertions can check exact identities without fragile substring matching.
 */
function collectSerializedValues(serialized: string): {
  strings: Set<string>;
  objects: Record<string, unknown>[];
} {
  const strings = new Set<string>();
  const objects: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      strings.add(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object') {
      objects.push(node as Record<string, unknown>);
      Object.values(node).forEach(walk);
    }
  };
  walk(JSON.parse(serialized) as unknown);
  return { strings, objects };
}

/**
 * Asserts the exact hidden card identity is unrecoverable from serialized
 * output: neither its instanceId string nor its exact `{ value, type }` pair
 * may appear anywhere. Public cards may share a hidden card's value in
 * general, so fixtures give the hidden marker a value (10) that no public card
 * in the same snapshot carries; the pair check is then exact and can never
 * false-positive on a legitimately public card.
 */
function expectHiddenIdentityAbsent(serialized: string, hidden: CardInstance): void {
  const { strings, objects } = collectSerializedValues(serialized);
  expect(strings.has(hidden.instanceId)).toBe(false);
  expect(
    objects.some((candidate) => candidate.value === hidden.value && candidate.type === hidden.type),
  ).toBe(false);
}

function basePlayer(id: string): PlayerState {
  return {
    id,
    name: `Name ${id}`,
    connected: true,
    eliminated: false,
    protected: false,
    hand: [],
    discards: [],
    victoryTokens: 0,
  };
}

/** Lobby match with a three-player roster, no round attached. */
function lobbySnapshot(): GameSnapshot {
  return { match: createLobbyMatch(), round: null };
}

function createLobbyMatch(): MatchState {
  return createMatchState({
    matchId: 'match-view',
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, name: `Name ${id}` })),
  });
}

/**
 * Active-round snapshot with a public discard and a live draw pile. p3's
 * connectivity disagrees on purpose: the match roster says disconnected while
 * the round player still carries the stale setup-time `connected: true`, so
 * match-authoritative connectivity is observable.
 */
function activeRoundSnapshot(): GameSnapshot {
  const match = createLobbyMatch();
  const disconnectedMatch: MatchState = {
    ...match,
    players: match.players.map((player) =>
      player.id === 'p3' ? { ...player, connected: false } : player,
    ),
  };
  const round: RoundState = {
    matchId: 'match-view',
    status: 'ROUND_ACTIVE',
    players: [
      { ...basePlayer('p1'), discards: [{ card: secretCard(5), origin: 'PLAYED' }] },
      { ...basePlayer('p2'), hand: [secretCard(2)] },
      { ...basePlayer('p3'), connected: true, hand: [secretCard(9)] },
    ],
    turnOrder: ['p1', 'p2', 'p3'],
    currentPlayerId: 'p2',
    roundNumber: 1,
    drawPile: [secretCard(1), secretCard(4)],
    hiddenCard: secretCard(10),
    phase: 'DRAW_REQUIRED',
    pendingInteraction: null,
    winners: [],
  };
  return { match: disconnectedMatch, round };
}

/** Exhaustion ROUND_END: empty draw pile, two survivors, one eliminated player. */
function exhaustionSnapshot(): GameSnapshot {
  const round: RoundState = {
    matchId: 'match-view',
    status: 'ROUND_END',
    players: [
      { ...basePlayer('p1'), hand: [secretCard(3)] },
      { ...basePlayer('p2'), hand: [secretCard(6)] },
      {
        ...basePlayer('p3'),
        eliminated: true,
        hand: [],
        discards: [
          { card: secretCard(9), origin: 'ELIMINATION_REVEAL' },
          { card: secretCard(1), origin: 'PLAYED' },
        ],
      },
    ],
    turnOrder: ['p1', 'p2', 'p3'],
    currentPlayerId: 'p1',
    roundNumber: 1,
    drawPile: [],
    hiddenCard: secretCard(10),
    phase: 'DRAW_REQUIRED',
    pendingInteraction: null,
    winners: ['p1'],
  };
  return { match: createLobbyMatch(), round };
}

/** Last-survivor ROUND_END: one survivor left, no hand reveal ever happened. */
function lastSurvivorSnapshot(drawPile: CardInstance[]): GameSnapshot {
  const round: RoundState = {
    matchId: 'match-view',
    status: 'ROUND_END',
    players: [
      { ...basePlayer('p1'), hand: [secretCard(3)] },
      { ...basePlayer('p2'), eliminated: true, hand: [] },
    ],
    turnOrder: ['p1', 'p2'],
    currentPlayerId: 'p1',
    roundNumber: 2,
    drawPile,
    hiddenCard: secretCard(10),
    phase: 'DRAW_REQUIRED',
    pendingInteraction: null,
    winners: ['p1'],
  };
  return { match: createLobbyMatch(), round };
}

/** Round with every active player still holding a card but a nonempty draw pile at ROUND_END. */
function endedRoundWithLivePileSnapshot(): GameSnapshot {
  const snapshot = activeRoundSnapshot();
  const round = snapshot.round as RoundState;
  return {
    ...snapshot,
    round: { ...round, status: 'ROUND_END', winners: ['p1'] },
  };
}

function pendingSnapshot(pending: RoundState['pendingInteraction']): GameSnapshot {
  const snapshot = activeRoundSnapshot();
  const round = snapshot.round as RoundState;
  return {
    ...snapshot,
    round: {
      ...round,
      phase: 'PLAY_REQUIRED',
      pendingInteraction: pending,
    },
  };
}

describe('getPublicGameView — lobby and match-only snapshots', () => {
  it('projects a lobby match with an empty round slot and bare player fields', () => {
    const view = getPublicGameView(lobbySnapshot());

    expect(view.match).toEqual({
      matchId: 'match-view',
      status: 'LOBBY',
      roundNumber: 0,
      winners: [],
    });
    expect(view.round).toBeNull();
    expect(view.players).toEqual([
      {
        id: 'p1',
        name: 'Name p1',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 0,
        discards: [],
      },
      {
        id: 'p2',
        name: 'Name p2',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 0,
        discards: [],
      },
      {
        id: 'p3',
        name: 'Name p3',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 0,
        discards: [],
      },
    ]);
  });

  it('keeps a match-only ROUND_END snapshot coherent between rounds', () => {
    const match = createLobbyMatch();
    const matchBetweenRounds: MatchState = {
      ...match,
      status: 'ROUND_END',
      roundNumber: 1,
      players: match.players.map((player) =>
        player.id === 'p2' ? { ...player, victoryTokens: 1 } : player,
      ),
    };

    const view = getPublicGameView({ match: matchBetweenRounds, round: null });

    expect(view.round).toBeNull();
    expect(view.match.status).toBe('ROUND_END');
    expect(view.match.roundNumber).toBe(1);
    expect(view.players.find((player) => player.id === 'p2')?.victoryTokens).toBe(1);
  });

  it('projects match end with winners and threshold tokens', () => {
    const match = createLobbyMatch();
    const endedMatch: MatchState = {
      ...match,
      status: 'MATCH_END',
      roundNumber: 2,
      winners: ['p1', 'p3'],
      players: match.players.map((player) =>
        player.id === 'p1' || player.id === 'p3' ? { ...player, victoryTokens: 3 } : player,
      ),
    };

    const view = getPublicGameView({ match: endedMatch, round: null });

    expect(view.match).toEqual({
      matchId: 'match-view',
      status: 'MATCH_END',
      roundNumber: 2,
      winners: ['p1', 'p3'],
    });
    expect(view.round).toBeNull();
    expect(view.players.find((player) => player.id === 'p1')?.victoryTokens).toBe(3);
  });
});

describe('getPublicGameView — active round', () => {
  it('projects live round players, public fields only', () => {
    const view = getPublicGameView(activeRoundSnapshot());

    expect(view.players).toEqual([
      {
        id: 'p1',
        name: 'Name p1',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 0,
        discards: [{ card: { value: 5, type: 'SERPIENTE_ENCANTADORA' }, origin: 'PLAYED' }],
      },
      {
        id: 'p2',
        name: 'Name p2',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 1,
        discards: [],
      },
      {
        id: 'p3',
        name: 'Name p3',
        // Connectivity is match-level: the round player's stale
        // `connected: true` loses to the match roster's `connected: false`.
        connected: false,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 1,
        discards: [],
      },
    ]);
  });

  it('projects the round view with counts, not identities', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPublicGameView(snapshot);
    const roundView = view.round as PublicRoundView;

    expect(roundView).toEqual({
      status: 'ROUND_ACTIVE',
      phase: 'DRAW_REQUIRED',
      currentPlayerId: 'p2',
      turnOrder: ['p1', 'p2', 'p3'],
      roundNumber: 1,
      drawPileCount: 2,
      hiddenCardCount: 1,
      pendingInteraction: null,
      winners: [],
      revealedHands: null,
    });
    expect(roundView.turnOrder).not.toBe(snapshot.round?.turnOrder);
    expect(roundView.winners).not.toBe(snapshot.round?.winners);
  });

  it('serializes without any card instance identity or hidden location', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPublicGameView(snapshot);
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain('instanceId');
    expect(serialized).not.toContain('secret-');
    expect(serialized).not.toContain('"hand":');
    expect(serialized).not.toContain('"drawPile":');
    expect(serialized).not.toContain('"hiddenCard":');
    expect(serialized).not.toContain('"pendingInteraction": {"card"');
    expectHiddenIdentityAbsent(serialized, snapshot.round!.hiddenCard);
  });

  it('never lets the exact hidden card identity be recovered from serialized output', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPublicGameView(snapshot);
    const serialized = JSON.stringify(view);

    // The hidden marker's value (10) is unique among the fixture's public
    // cards, so an exact { value, type } match would prove a leak even though
    // public cards may share values in general.
    expectHiddenIdentityAbsent(serialized, snapshot.round!.hiddenCard);
  });
});

describe('getPublicGameView — pending interactions', () => {
  const cases: Array<{
    name: string;
    pending: RoundState['pendingInteraction'];
    expected: NonNullable<PublicRoundView['pendingInteraction']>;
  }> = [
    {
      name: 'PECERA_TARGET exposes only type and actor',
      pending: { type: 'PECERA_TARGET', actorId: 'p1' },
      expected: { type: 'PECERA_TARGET', actorId: 'p1' },
    },
    {
      name: 'PECERA_GUESS exposes type, actor, and the public target',
      pending: { type: 'PECERA_GUESS', actorId: 'p1', targetId: 'p2' },
      expected: { type: 'PECERA_GUESS', actorId: 'p1', targetId: 'p2' },
    },
    {
      name: 'RATON_INSERT_POSITION never exposes the detached card',
      pending: { type: 'RATON_INSERT_POSITION', actorId: 'p2', card: secretCard(7) },
      expected: { type: 'RATON_INSERT_POSITION', actorId: 'p2' },
    },
    {
      name: 'SAQUEADOG_SWAP exposes only type and actor',
      pending: { type: 'SAQUEADOG_SWAP', actorId: 'p2' },
      expected: { type: 'SAQUEADOG_SWAP', actorId: 'p2' },
    },
  ];

  it.each(cases)('$name', ({ pending, expected }) => {
    const view = getPublicGameView(pendingSnapshot(pending));

    expect(view.round?.pendingInteraction).toEqual(expected);
    expect(view.round?.phase).toBe('PLAY_REQUIRED');
  });

  it('serializes every pending stage without the detached card identity', () => {
    const snapshot = pendingSnapshot({
      type: 'RATON_INSERT_POSITION',
      actorId: 'p2',
      card: secretCard(7),
    });
    const view = getPublicGameView(snapshot);
    const serialized = JSON.stringify(view);

    expectHiddenIdentityAbsent(serialized, snapshot.round!.hiddenCard);
    // The "card" key only ever appears inside public discard views; the exact
    // pending shape assertion above proves no detached card rides along.
  });
});

describe('getPublicGameView — exhaustive pending mapping fails closed', () => {
  it('throws a typed ProjectionError for an unknown future pending variant', () => {
    const future = {
      type: 'FUTURE_VARIANT',
      actorId: 'p2',
      mystery: true,
    } as unknown as PendingInteraction;
    const snapshot = pendingSnapshot(future);

    let caught: unknown;
    try {
      getPublicGameView(snapshot);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionError);
    expect((caught as ProjectionError).code).toBe('UNKNOWN_PENDING_INTERACTION');
    expect((caught as ProjectionError).message).toContain('FUTURE_VARIANT');
  });
});

describe('getPublicGameView — round end reveals', () => {
  it('infers the exhaustion reveal and exposes survivor values without instanceIds', () => {
    const snapshot = exhaustionSnapshot();
    const view = getPublicGameView(snapshot);

    expect(view.round?.status).toBe('ROUND_END');
    expect(view.round?.winners).toEqual(['p1']);
    expect(view.round?.revealedHands).toEqual([
      { playerId: 'p1', card: { value: 3, type: 'CONEJITO_GUERRILLERO' } },
      { playerId: 'p2', card: { value: 6, type: 'SAQUEADOG_DE_TUMBAS' } },
    ]);
    view.round?.revealedHands?.forEach((hand, index) => {
      const inputCard = snapshot.round?.players[index]?.hand[0];
      expect(hand.card).not.toBe(inputCard);
    });
    expectHiddenIdentityAbsent(JSON.stringify(view), snapshot.round!.hiddenCard);
  });

  it('never exposes the last survivor hand at a last-survivor ROUND_END with an empty pile', () => {
    const view = getPublicGameView(lastSurvivorSnapshot([]));

    expect(view.round?.revealedHands).toBeNull();
    expect(view.round?.winners).toEqual(['p1']);
  });

  it('never exposes the last survivor hand when the draw pile is still live', () => {
    const view = getPublicGameView(lastSurvivorSnapshot([secretCard(1)]));

    expect(view.round?.revealedHands).toBeNull();
  });

  it('keeps revealedHands null at a ROUND_END whose draw pile is not empty', () => {
    const view = getPublicGameView(endedRoundWithLivePileSnapshot());

    expect(view.round?.status).toBe('ROUND_END');
    expect(view.round?.revealedHands).toBeNull();
  });
});

describe('getPublicGameView — combined-snapshot player composition', () => {
  /**
   * Match whose token truth has advanced past the attached round (the state
   * right after `applyRoundResult`): p1 won round 1, so the match carries the
   * awarded token while the round players still hold stale setup-time tokens.
   */
  function awardedMatch(): MatchState {
    const match = createLobbyMatch();
    return {
      ...match,
      status: 'ROUND_END',
      roundNumber: 1,
      players: match.players.map((player) =>
        player.id === 'p1'
          ? { ...player, name: 'Lobby p1', connected: false, victoryTokens: 1 }
          : player,
      ),
    };
  }

  it('takes tokens, identity, and connectivity from the match while a round is attached', () => {
    const round: RoundState = {
      matchId: 'match-view',
      status: 'ROUND_END',
      players: [
        {
          ...basePlayer('p1'),
          connected: true,
          protected: true,
          hand: [secretCard(2)],
          discards: [{ card: secretCard(5), origin: 'PLAYED' }],
        },
        { ...basePlayer('p2'), eliminated: true, hand: [] },
        { ...basePlayer('p3') },
      ],
      turnOrder: ['p1', 'p2', 'p3'],
      currentPlayerId: 'p1',
      roundNumber: 1,
      drawPile: [],
      hiddenCard: secretCard(10),
      phase: 'DRAW_REQUIRED',
      pendingInteraction: null,
      winners: ['p1'],
    };

    const view = getPublicGameView({ match: awardedMatch(), round });

    // Round player order is preserved; identity/connectivity/tokens come from
    // the match roster keyed by id, transient round fields from the round.
    expect(view.players.map((player) => player.id)).toEqual(['p1', 'p2', 'p3']);
    expect(view.players[0]).toEqual({
      id: 'p1',
      name: 'Lobby p1',
      connected: false,
      eliminated: false,
      protected: true,
      victoryTokens: 1,
      handCount: 1,
      discards: [{ card: { value: 5, type: 'SERPIENTE_ENCANTADORA' }, origin: 'PLAYED' }],
    });
    expect(view.players[1]).toEqual({
      id: 'p2',
      name: 'Name p2',
      connected: true,
      eliminated: true,
      protected: false,
      victoryTokens: 0,
      handCount: 0,
      discards: [],
    });
  });

  it('falls back to round values for a round player missing from the match roster', () => {
    const match = createLobbyMatch();
    const round: RoundState = {
      matchId: 'match-view',
      status: 'ROUND_ACTIVE',
      players: [
        ...match.players,
        { ...basePlayer('p4'), connected: false, victoryTokens: 2, hand: [secretCard(7)] },
      ],
      turnOrder: ['p1', 'p2', 'p3', 'p4'],
      currentPlayerId: 'p4',
      roundNumber: 1,
      drawPile: [],
      hiddenCard: secretCard(10),
      phase: 'DRAW_REQUIRED',
      pendingInteraction: null,
      winners: [],
    };

    const view = getPublicGameView({ match, round });

    // Malformed roster mismatch never throws: the unknown round player keeps
    // every round-side value, while known players still compose normally.
    expect(view.players.map((player) => player.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(view.players[3]).toEqual({
      id: 'p4',
      name: 'Name p4',
      connected: false,
      eliminated: false,
      protected: false,
      victoryTokens: 2,
      handCount: 1,
      discards: [],
    });
  });

  it('projects awarded tokens plus round discards and reveal after an engine-driven round', () => {
    const seed = 20240607;
    const engineRng = createRngStream(seed, ENGINE_STREAM);
    const policyRng = createRngStream(seed, POLICY_STREAM);
    const dependencies: TurnEngineDependencies = { rng: engineRng };

    const match = createMatchState({
      matchId: 'match-driven',
      players: ['p1', 'p2', 'p3'].map((id) => ({ id, name: `Name ${id}` })),
    });
    let round = setupRound(match, engineRng);

    let commands = 0;
    while (round.status === 'ROUND_ACTIVE' && commands < 1000) {
      const actorId = round.pendingInteraction?.actorId ?? round.currentPlayerId;
      const command = selectLegalAction(round, policyRng, actorId);
      const result = applyTurnCommand(round, command, dependencies);
      if (!result.ok) {
        throw new Error(`Engine rejected ${JSON.stringify(command)}: ${result.error}`);
      }
      round = result.state;
      commands += 1;
    }
    expect(round.status).toBe('ROUND_END');
    expect(commands).toBeLessThan(1000);

    const applied = applyRoundResult(match, round);
    expect(applied.match.status).toBe('ROUND_END');
    expect(round.winners.length).toBeGreaterThan(0);

    const view = getPublicGameView({ match: applied.match, round });

    // Current victory tokens come from the applied match, not the stale round.
    for (const playerView of view.players) {
      expect(playerView.victoryTokens).toBe(round.winners.includes(playerView.id) ? 1 : 0);
    }

    // Round-owned transient fields survive composition, in round player order.
    expect(view.players.map((player) => player.id)).toEqual(round.players.map((p) => p.id));
    view.players.forEach((playerView, index) => {
      const roundPlayer = round.players[index]!;
      expect(playerView.handCount).toBe(roundPlayer.hand.length);
      expect(playerView.eliminated).toBe(roundPlayer.eliminated);
      expect(playerView.protected).toBe(roundPlayer.protected);
      expect(playerView.discards).toEqual(
        roundPlayer.discards.map((entry) => ({
          card: { value: entry.card.value, type: entry.card.type },
          origin: entry.origin,
        })),
      );
    });

    // The round really did produce public discards, and the reveal matches the
    // exhaustion inference over the canonical ended round.
    const totalDiscards = view.players.reduce((sum, player) => sum + player.discards.length, 0);
    expect(totalDiscards).toBeGreaterThan(0);
    const survivors = round.players.filter((player) => !player.eliminated);
    const expectedReveal =
      round.drawPile.length === 0 && survivors.length >= 2
        ? survivors
            .filter((player) => player.hand.length > 0)
            .map((player) => ({
              playerId: player.id,
              card: { value: player.hand[0]!.value, type: player.hand[0]!.type },
            }))
        : null;
    expect(view.round?.revealedHands).toEqual(expectedReveal);
    expect(view.round?.winners).toEqual(round.winners);

    expectHiddenIdentityAbsent(JSON.stringify(view), round.hiddenCard);
  });
});

describe('getPublicGameView — purity and alias isolation', () => {
  it('stays unchanged when the canonical snapshot is mutated after projection', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPublicGameView(snapshot);
    const before = JSON.stringify(view);
    const round = snapshot.round as RoundState;

    round.players[0]!.discards[0]!.card.value = 99;
    round.players[1]!.hand[0]!.value = 99;
    round.players[1]!.hand.push(secretCard(7));
    round.players[2]!.discards.push({ card: secretCard(0), origin: 'PLAYED' });
    round.drawPile.push(secretCard(8));
    round.turnOrder.push('p9');
    round.winners.push('p2');
    round.currentPlayerId = 'p3';
    round.phase = 'PLAY_REQUIRED';
    round.hiddenCard = secretCard(4);
    snapshot.match.winners.push('p1');
    snapshot.match.roundNumber = 42;

    expect(JSON.stringify(view)).toBe(before);
  });

  it('leaves the canonical snapshot unchanged when the view is mutated', () => {
    const snapshot = activeRoundSnapshot();
    const inputBefore = JSON.stringify(snapshot);
    const view = getPublicGameView(snapshot);

    view.players[0]!.discards.push({ card: { value: 0, type: 'REY_GATO' }, origin: 'PLAYED' });
    view.players[1]!.victoryTokens = 5;
    view.round!.turnOrder.push('intruder');
    view.round!.winners.push('p3');
    view.match.winners.push('p2');

    expect(JSON.stringify(snapshot)).toBe(inputBefore);
  });

  it('returns fresh objects, including copied public cards', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPublicGameView(snapshot);
    const round = snapshot.round as RoundState;

    expect(view.players[0]).not.toBe(round.players[0]);
    expect(view.players[0]!.discards[0]!.card).not.toBe(round.players[0]!.discards[0]!.card);
    expect(view.round!.turnOrder).not.toBe(round.turnOrder);
    expect(view.match).not.toBe(snapshot.match);
    expect(view).not.toBe(snapshot as unknown as PublicGameView);
  });
});

describe('getPublicGameView — deterministic serialization', () => {
  it('serializes identically across repeated projections and round-trips', () => {
    const snapshot = activeRoundSnapshot();

    const first = getPublicGameView(snapshot);
    const second = getPublicGameView(snapshot);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});
