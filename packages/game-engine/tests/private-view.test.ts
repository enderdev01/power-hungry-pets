/**
 * Milestone 6 work unit 2 — player-private projection (`getPlayerPrivateView`).
 *
 * Normative design under test:
 * - `getPlayerPrivateView(snapshot, playerId)` composes a fresh public
 *   projection with only that viewer's authorized private data: the viewer id,
 *   a deep-copied own hand, the exact `getLegalActions(round, viewerId)`
 *   commands (empty without an active attached round), and private pending
 *   data only when the viewer is the pending actor.
 * - Pending reconnect contract: `PECERA_TARGET` / `PECERA_GUESS` identify the
 *   owed decision (the Pecera target id is already public); `RATON_INSERT_POSITION`
 *   additionally carries a deep copy of the detached card; `SAQUEADOG_SWAP`
 *   additionally carries a deep copy of the hidden card. Non-actors receive no
 *   private pending payload and no legal actions.
 * - Authorization uses the match roster and fails closed: a non-roster playerId
 *   throws a typed `ProjectionError` with the stable code `PLAYER_NOT_IN_GAME`
 *   — never a null or public fallback view.
 * - Never exposed to any viewer: another player's hand, the draw-pile order,
 *   the hidden card identity (except to the Saqueadog actor during that pending
 *   stage), the detached Ratón card (except to the Ratón actor), the insertion
 *   index beyond the legal-action domain, the guess value beyond the legal-action
 *   domain, or the swap choice/outcome. The pending mapping is exhaustive and
 *   fails closed (typed error) for unknown future variants.
 * - Purity: the composed public projection and every copied card are fresh
 *   plain objects; mutating either the snapshot or the view after projection
 *   never affects the other; output is JSON-serializable and deterministic.
 */
import {
  applyTurnCommand,
  CARD_CATALOG,
  createMatchState,
  getLegalActions,
  getPlayerPrivateView,
  getPublicGameView,
  ProjectionError,
  type CardInstance,
  type CardType,
  type GameSnapshot,
  type MatchState,
  type PendingInteraction,
  type PlayerState,
  type PrivateGameView,
  type RoundState,
} from '../src';

/** Card type consistent with the catalog for the given printed value. */
function typeForValue(value: number): CardType {
  const definition = CARD_CATALOG.find((candidate) => candidate.value === value);
  if (!definition) {
    throw new Error(`Test fixture is missing a catalog card of value ${value}`);
  }
  return definition.type;
}

/** Hand-crafted card with a controlled secret identity (not public by default). */
function secretCard(value: number): CardInstance {
  return { instanceId: `secret-${value}`, value, type: typeForValue(value) };
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

function createLobbyMatch(): MatchState {
  return createMatchState({
    matchId: 'match-view',
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, name: `Name ${id}` })),
  });
}

/** Lobby match with a three-player roster, no round attached. */
function lobbySnapshot(): GameSnapshot {
  return { match: createLobbyMatch(), round: null };
}

/**
 * Active-round snapshot: p2 is the current player holding a secret hand card,
 * p3 holds another, the draw pile is [secret-1, secret-4] and the hidden card
 * is the value-10 marker whose value no public card shares.
 */
function activeRoundSnapshot(): GameSnapshot {
  const round: RoundState = {
    matchId: 'match-view',
    status: 'ROUND_ACTIVE',
    players: [
      { ...basePlayer('p1'), discards: [{ card: secretCard(5), origin: 'PLAYED' }] },
      { ...basePlayer('p2'), hand: [secretCard(2)] },
      { ...basePlayer('p3'), hand: [secretCard(9)] },
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
  return { match: createLobbyMatch(), round };
}

/** Active-round snapshot with the given pending interaction (actor on p2). */
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

/** Exhaustion ROUND_END: empty draw pile, two survivors, one eliminated player. */
function exhaustionSnapshot(): GameSnapshot {
  const round: RoundState = {
    matchId: 'match-view',
    status: 'ROUND_END',
    players: [
      { ...basePlayer('p1'), hand: [secretCard(3)] },
      { ...basePlayer('p2'), hand: [secretCard(6)] },
      { ...basePlayer('p3'), eliminated: true, hand: [] },
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

/** MATCH_END snapshot with no round attached. */
function matchEndSnapshot(): GameSnapshot {
  const match = createLobbyMatch();
  const ended: MatchState = {
    ...match,
    status: 'MATCH_END',
    roundNumber: 2,
    winners: ['p1'],
    players: match.players.map((player) =>
      player.id === 'p1' ? { ...player, victoryTokens: 3 } : player,
    ),
  };
  return { match: ended, round: null };
}

describe('getPlayerPrivateView — authorization and fail-closed roster check', () => {
  it('throws the typed PLAYER_NOT_IN_GAME ProjectionError for a non-roster viewer', () => {
    expect.assertions(5);

    let caught: unknown;
    try {
      getPlayerPrivateView(activeRoundSnapshot(), 'intruder');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionError);
    expect(caught).toBeInstanceOf(Error);
    const projectionError = caught as ProjectionError;
    expect(projectionError.code).toBe('PLAYER_NOT_IN_GAME');
    expect(projectionError.message).toContain('intruder');
    expect(projectionError.name).toBe('ProjectionError');
  });

  it('never returns a partial view or a public fallback for a non-roster viewer', () => {
    expect(() => getPlayerPrivateView(activeRoundSnapshot(), 'intruder')).toThrow(ProjectionError);
  });

  it('authorizes against the match roster, not the attached round roster', () => {
    // p4 exists only in the round's malformed roster: fail closed.
    const match = createLobbyMatch();
    const round: RoundState = {
      matchId: 'match-view',
      status: 'ROUND_ACTIVE',
      players: [...match.players, { ...basePlayer('p4'), hand: [secretCard(7)] }],
      turnOrder: ['p1', 'p2', 'p3', 'p4'],
      currentPlayerId: 'p4',
      roundNumber: 1,
      drawPile: [],
      hiddenCard: secretCard(10),
      phase: 'PLAY_REQUIRED',
      pendingInteraction: null,
      winners: [],
    };

    let caught: unknown;
    try {
      getPlayerPrivateView({ match, round }, 'p4');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionError);
    expect((caught as ProjectionError).code).toBe('PLAYER_NOT_IN_GAME');
  });
});

describe('getPlayerPrivateView — own hand isolation', () => {
  it('returns the viewer own hand as deep-copied fresh card instances', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPlayerPrivateView(snapshot, 'p2');
    const round = snapshot.round as RoundState;
    const ownCard = round.players[1]!.hand[0]!;

    expect(view.viewerId).toBe('p2');
    expect(view.hand).toEqual([{ instanceId: 'secret-2', value: 2, type: 'RATON_TRAMPERO' }]);
    expect(view.hand).not.toBe(round.players[1]!.hand);
    expect(view.hand[0]).not.toBe(ownCard);
  });

  it('never exposes another player hand identity', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPlayerPrivateView(snapshot, 'p2');
    const serialized = JSON.stringify(view);

    // p3's secret hand card never appears anywhere in the view.
    expect(serialized).not.toContain('secret-9');
    // The viewer own hand is the only hand identity present.
    expect(serialized).toContain('secret-2');
    expect(view.hand).toHaveLength(1);
  });

  it('never exposes the draw-pile order to any viewer', () => {
    for (const viewerId of ['p1', 'p2', 'p3']) {
      const view = getPlayerPrivateView(activeRoundSnapshot(), viewerId);
      const serialized = JSON.stringify(view);

      expect(serialized).not.toContain('"drawPile"');
      expect(serialized).not.toContain('secret-1');
      expect(serialized).not.toContain('secret-4');
    }
  });
});

describe('getPlayerPrivateView — composed public projection', () => {
  it('composes a fresh public projection equal to getPublicGameView', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPlayerPrivateView(snapshot, 'p2');

    expect(view.publicView).toEqual(getPublicGameView(snapshot));
    expect(view.publicView).not.toBe(getPublicGameView(snapshot));
  });

  it('never mutates the canonical snapshot through the composed public layer', () => {
    const snapshot = activeRoundSnapshot();
    const inputBefore = JSON.stringify(snapshot);
    const view = getPlayerPrivateView(snapshot, 'p2');

    view.publicView.players[1]!.victoryTokens = 9;
    view.publicView.round!.turnOrder.push('intruder');

    expect(JSON.stringify(snapshot)).toBe(inputBefore);
  });
});

describe('getPlayerPrivateView — legal actions', () => {
  it('returns the exact getLegalActions commands for the viewer in an active round', () => {
    const snapshot = activeRoundSnapshot();
    const view = getPlayerPrivateView(snapshot, 'p2');

    expect(view.legalActions).toEqual(getLegalActions(snapshot.round as RoundState, 'p2'));
    expect(view.legalActions).toEqual([{ type: 'DRAW_CARD', actorId: 'p2' }]);
  });

  it('returns play-card actions whose instance ids come only from the viewer own hand', () => {
    const snapshot = activeRoundSnapshot();
    const round = snapshot.round as RoundState;
    const playRequired: GameSnapshot = {
      ...snapshot,
      round: { ...round, phase: 'PLAY_REQUIRED' },
    };
    const view = getPlayerPrivateView(playRequired, 'p2');

    expect(view.legalActions).toEqual(getLegalActions(playRequired.round as RoundState, 'p2'));
    expect(view.legalActions).toEqual([
      { type: 'PLAY_CARD', actorId: 'p2', cardInstanceId: 'secret-2' },
    ]);
    const serialized = JSON.stringify(view.legalActions);
    expect(serialized).not.toContain('secret-9');
  });

  it('returns no legal actions without an attached round', () => {
    const view = getPlayerPrivateView(lobbySnapshot(), 'p2');

    expect(view.legalActions).toEqual([]);
    expect(view.pendingDecision).toBeNull();
    expect(view.hand).toEqual([]);
  });

  it('returns no legal actions at ROUND_END even for the round winner', () => {
    const view = getPlayerPrivateView(exhaustionSnapshot(), 'p1');

    expect(view.legalActions).toEqual([]);
    expect(view.pendingDecision).toBeNull();
  });

  it('returns no legal actions and an empty hand at MATCH_END', () => {
    const view = getPlayerPrivateView(matchEndSnapshot(), 'p1');

    expect(view.legalActions).toEqual([]);
    expect(view.pendingDecision).toBeNull();
    expect(view.hand).toEqual([]);
    expect(view.publicView.match.status).toBe('MATCH_END');
  });
});

describe('getPlayerPrivateView — pending stages as the actor', () => {
  const actorCases: Array<{
    name: string;
    pending: PendingInteraction;
    expected: NonNullable<PrivateGameView['pendingDecision']>;
  }> = [
    {
      name: 'PECERA_TARGET identifies the owed target decision',
      pending: { type: 'PECERA_TARGET', actorId: 'p2' },
      expected: { type: 'PECERA_TARGET', actorId: 'p2' },
    },
    {
      name: 'PECERA_GUESS identifies the owed guess decision and the public target',
      pending: { type: 'PECERA_GUESS', actorId: 'p2', targetId: 'p1' },
      expected: { type: 'PECERA_GUESS', actorId: 'p2', targetId: 'p1' },
    },
    {
      name: 'RATON_INSERT_POSITION carries a deep copy of the detached card',
      pending: { type: 'RATON_INSERT_POSITION', actorId: 'p2', card: secretCard(7) },
      expected: {
        type: 'RATON_INSERT_POSITION',
        actorId: 'p2',
        card: {
          instanceId: 'secret-7',
          value: 7,
          type: 'MALABARISTA_DE_OCHO_PATAS',
        },
      },
    },
    {
      name: 'SAQUEADOG_SWAP carries a deep copy of the hidden card',
      pending: { type: 'SAQUEADOG_SWAP', actorId: 'p2' },
      expected: {
        type: 'SAQUEADOG_SWAP',
        actorId: 'p2',
        hiddenCard: { instanceId: 'secret-10', value: 10, type: 'REY_GATO' },
      },
    },
  ];

  it.each(actorCases)('$name', ({ pending, expected }) => {
    const snapshot = pendingSnapshot(pending);
    const view = getPlayerPrivateView(snapshot, 'p2');

    expect(view.pendingDecision).toEqual(expected);
  });

  it('deep-copies the detached Ratón card so view and state never alias', () => {
    const pending: PendingInteraction = {
      type: 'RATON_INSERT_POSITION',
      actorId: 'p2',
      card: secretCard(7),
    };
    const snapshot = pendingSnapshot(pending);
    const view = getPlayerPrivateView(snapshot, 'p2');

    const decision = view.pendingDecision as { card: CardInstance };
    expect(decision.card).not.toBe(pending.card);
  });

  it('deep-copies the hidden card for the Saqueadog actor so view and state never alias', () => {
    const snapshot = pendingSnapshot({ type: 'SAQUEADOG_SWAP', actorId: 'p2' });
    const view = getPlayerPrivateView(snapshot, 'p2');

    const decision = view.pendingDecision as { hiddenCard: CardInstance };
    expect(decision.hiddenCard).not.toBe(snapshot.round!.hiddenCard);
  });

  it('gives the actor the exact canonical legal actions for each pending stage', () => {
    const cases: PendingInteraction[] = [
      { type: 'PECERA_TARGET', actorId: 'p2' },
      { type: 'PECERA_GUESS', actorId: 'p2', targetId: 'p1' },
      { type: 'RATON_INSERT_POSITION', actorId: 'p2', card: secretCard(7) },
      { type: 'SAQUEADOG_SWAP', actorId: 'p2' },
    ];

    cases.forEach((pending) => {
      const snapshot = pendingSnapshot(pending);
      const view = getPlayerPrivateView(snapshot, 'p2');

      expect(view.legalActions).toEqual(getLegalActions(snapshot.round as RoundState, 'p2'));
    });
  });

  it('exposes the canonical decision domains per stage', () => {
    const drawPileLength = (activeRoundSnapshot().round as RoundState).drawPile.length;

    const peceraTargets = getPlayerPrivateView(
      pendingSnapshot({ type: 'PECERA_TARGET', actorId: 'p2' }),
      'p2',
    ).legalActions;
    expect(peceraTargets).toEqual([
      { type: 'CHOOSE_TARGET', actorId: 'p2', targetId: 'p1' },
      { type: 'CHOOSE_TARGET', actorId: 'p2', targetId: 'p3' },
    ]);

    const guesses = getPlayerPrivateView(
      pendingSnapshot({ type: 'PECERA_GUESS', actorId: 'p2', targetId: 'p1' }),
      'p2',
    ).legalActions;
    expect(guesses).toHaveLength(10);
    expect(
      guesses.map((command) => (command as { value: number }).value).sort((a, b) => a - b),
    ).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const positions = getPlayerPrivateView(
      pendingSnapshot({ type: 'RATON_INSERT_POSITION', actorId: 'p2', card: secretCard(7) }),
      'p2',
    ).legalActions;
    expect(positions).toHaveLength(drawPileLength + 1);
    expect(positions.map((command) => (command as { index: number }).index)).toEqual([0, 1, 2]);

    const swaps = getPlayerPrivateView(
      pendingSnapshot({ type: 'SAQUEADOG_SWAP', actorId: 'p2' }),
      'p2',
    ).legalActions;
    expect(swaps).toEqual([
      { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p2', swap: false },
      { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p2', swap: true },
    ]);
  });
});

describe('getPlayerPrivateView — pending stages as a non-actor', () => {
  const pendingCases: PendingInteraction[] = [
    { type: 'PECERA_TARGET', actorId: 'p2' },
    { type: 'PECERA_GUESS', actorId: 'p2', targetId: 'p1' },
    { type: 'RATON_INSERT_POSITION', actorId: 'p2', card: secretCard(7) },
    { type: 'SAQUEADOG_SWAP', actorId: 'p2' },
  ];

  it.each(pendingCases.map((pending) => ({ pending, viewer: 'p1' as const })))(
    'gives non-actor $viewer no pending payload and no legal actions for $pending.type',
    ({ pending, viewer }) => {
      const snapshot = pendingSnapshot(pending);
      const view = getPlayerPrivateView(snapshot, viewer);

      expect(view.pendingDecision).toBeNull();
      expect(view.legalActions).toEqual([]);
    },
  );

  it('leaks no private pending payload to any non-actor in serialized output', () => {
    pendingCasesForEach((pending) => {
      const snapshot = pendingSnapshot(pending);
      const round = snapshot.round as RoundState;
      const serialized = JSON.stringify(getPlayerPrivateView(snapshot, 'p1'));

      // No non-actor ever sees the detached card, the hidden card, or any other
      // player's hand identity.
      expect(serialized).not.toContain('secret-7');
      expect(serialized).not.toContain('secret-10');
      expect(serialized).not.toContain('secret-2');
      expect(serialized).not.toContain('secret-9');
      expect(JSON.parse(serialized) as PrivateGameView).toMatchObject({
        pendingDecision: null,
      });
      expect(round.pendingInteraction).toEqual(pending);
    });
  });

  function pendingCasesForEach(visit: (pending: PendingInteraction) => void): void {
    [
      { type: 'PECERA_TARGET', actorId: 'p2' },
      { type: 'PECERA_GUESS', actorId: 'p2', targetId: 'p1' },
      { type: 'RATON_INSERT_POSITION', actorId: 'p2', card: secretCard(7) },
      { type: 'SAQUEADOG_SWAP', actorId: 'p2' },
    ].forEach((pending) => visit(pending as PendingInteraction));
  }
});

describe('getPlayerPrivateView — exhaustive pending mapping fails closed', () => {
  it('throws a typed ProjectionError for an unknown future pending variant', () => {
    const future = {
      type: 'FUTURE_VARIANT',
      actorId: 'p2',
      mystery: true,
    } as unknown as PendingInteraction;
    const snapshot = pendingSnapshot(future);

    let caught: unknown;
    try {
      getPlayerPrivateView(snapshot, 'p2');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProjectionError);
    expect((caught as ProjectionError).code).toBe('UNKNOWN_PENDING_INTERACTION');
    expect((caught as ProjectionError).message).toContain('FUTURE_VARIANT');
  });
});

describe('getPlayerPrivateView — Saqueadog choice indistinguishability', () => {
  function saqueadogPendingSnapshot(): GameSnapshot {
    const snapshot = pendingSnapshot({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    const round = snapshot.round as RoundState;
    // The actor must hold exactly one remaining card for swap=true to resolve
    // (engine precondition); the canonical pending state stays identical either
    // way, which is exactly the indistinguishability under test.
    const staged: RoundState = {
      ...round,
      currentPlayerId: 'p1',
      players: round.players.map((player) =>
        player.id === 'p1' ? { ...player, hand: [secretCard(3)] } : player,
      ),
    };
    return { ...snapshot, round: staged };
  }

  function clone(snapshot: GameSnapshot): GameSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as GameSnapshot;
  }

  it('projects identical public and private views before a true or false choice', () => {
    // Two identical canonical pending states; one will later choose true, the
    // other false. Nothing about the choice exists in canonical state, so both
    // projections must be indistinguishable before the choice is applied.
    const willSwap = clone(saqueadogPendingSnapshot());
    const willKeep = clone(saqueadogPendingSnapshot());

    const swapViews = [getPublicGameView(willSwap), getPlayerPrivateView(willSwap, 'p1')];
    const keepViews = [getPublicGameView(willKeep), getPlayerPrivateView(willKeep, 'p1')];

    expect(keepViews).toEqual(swapViews);
  });

  it('never embeds the swap choice in the actor private pending payload', () => {
    const snapshot = saqueadogPendingSnapshot();
    const view = getPlayerPrivateView(snapshot, 'p1');

    expect(view.pendingDecision).toEqual({
      type: 'SAQUEADOG_SWAP',
      actorId: 'p1',
      hiddenCard: { instanceId: 'secret-10', value: 10, type: 'REY_GATO' },
    });
  });

  it('keeps public projections indistinguishable after either resolution', () => {
    const swapSnapshot = clone(saqueadogPendingSnapshot());
    const keepSnapshot = clone(saqueadogPendingSnapshot());
    const lobby = lobbySnapshot().match;

    const swapResult = applyTurnCommand(swapSnapshot.round as RoundState, {
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: 'p1',
      swap: true,
    });
    const keepResult = applyTurnCommand(keepSnapshot.round as RoundState, {
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: 'p1',
      swap: false,
    });
    if (!swapResult.ok || !keepResult.ok) {
      throw new Error('Test fixture expected both swap choices to resolve');
    }

    const swapPublic = getPublicGameView({ match: lobby, round: swapResult.state });
    const keepPublic = getPublicGameView({ match: lobby, round: keepResult.state });

    expect(keepPublic).toEqual(swapPublic);
  });

  it('shows the resolved actor own (possibly swapped) hand only in their private view', () => {
    const swapSnapshot = clone(saqueadogPendingSnapshot());
    const result = applyTurnCommand(swapSnapshot.round as RoundState, {
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: 'p1',
      swap: true,
    });
    if (!result.ok) {
      throw new Error('Test fixture expected the swap to resolve');
    }

    const actorView = getPlayerPrivateView({ match: lobbyMatch(), round: result.state }, 'p1');
    const otherView = getPlayerPrivateView({ match: lobbyMatch(), round: result.state }, 'p2');

    // The actor's hand changed to the hidden card; only their own view shows it.
    expect(actorView.hand).toEqual([{ instanceId: 'secret-10', value: 10, type: 'REY_GATO' }]);
    expect(JSON.stringify(otherView)).not.toContain('secret-10');

    function lobbyMatch(): MatchState {
      return createLobbyMatch();
    }
  });
});

describe('getPlayerPrivateView — purity, alias isolation, and serialization', () => {
  it('stays unchanged when the canonical snapshot is mutated after projection', () => {
    const pending: PendingInteraction = {
      type: 'RATON_INSERT_POSITION',
      actorId: 'p2',
      card: secretCard(7),
    };
    const snapshot = pendingSnapshot(pending);
    const view = getPlayerPrivateView(snapshot, 'p2');
    const before = JSON.stringify(view);
    const round = snapshot.round as RoundState;

    round.players[1]!.hand[0]!.value = 99;
    round.players[1]!.hand.push(secretCard(8));
    round.players[2]!.hand[0]!.value = 99;
    (round.pendingInteraction as { card: CardInstance }).card.value = 99;
    round.drawPile.push(secretCard(6));
    round.hiddenCard = secretCard(0);
    round.turnOrder.push('p9');
    snapshot.match.roundNumber = 42;

    expect(JSON.stringify(view)).toBe(before);
  });

  it('leaves the canonical snapshot unchanged when the private view is mutated', () => {
    const snapshot = pendingSnapshot({ type: 'SAQUEADOG_SWAP', actorId: 'p2' });
    const inputBefore = JSON.stringify(snapshot);
    const view = getPlayerPrivateView(snapshot, 'p2');

    view.hand.push(secretCard(7));
    (view.pendingDecision as { hiddenCard: CardInstance }).hiddenCard.value = 99;
    view.publicView.players[0]!.victoryTokens = 5;

    expect(JSON.stringify(snapshot)).toBe(inputBefore);
  });

  it('round-trips through JSON and serializes deterministically across projections', () => {
    const snapshot = pendingSnapshot({
      type: 'RATON_INSERT_POSITION',
      actorId: 'p2',
      card: secretCard(7),
    });

    const first = getPlayerPrivateView(snapshot, 'p2');
    const second = getPlayerPrivateView(snapshot, 'p2');

    expect(JSON.parse(JSON.stringify(first)) as PrivateGameView).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
