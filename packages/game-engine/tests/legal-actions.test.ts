/**
 * Milestone 5 work unit 1 — canonical legal-action generation.
 *
 * Normative design under test:
 * - `getLegalActions(round, actorId = round.currentPlayerId)` returns the exact
 *   `TurnCommand` objects the turn engine accepts, in a deterministic canonical
 *   order (stable sort by command type, card, target, index, value).
 * - Ended rounds, wrong actors, eliminated actors, and impossible draw states
 *   (DRAW_REQUIRED with an empty pile) produce an empty list.
 * - DRAW_REQUIRED yields exactly one DRAW_CARD; PLAY_REQUIRED yields one action
 *   per hand card, with atomic target expansion for the target-bearing cards
 *   (3 Conejito, 5 Serpiente, 8 Ermitaño) through the canonical legal-target
 *   seam — never a reimplemented protection rule — and exactly one targetless
 *   fizzle action when zero legal targets exist.
 * - Non-target cards never carry a stray targetId.
 * - Pending interactions yield exactly the pending stage's decision domain:
 *   PECERA_TARGET legal targets, PECERA_GUESS values 0 and 2..10 (never 1),
 *   RATON indices 0..drawPile.length, SAQUEADOG both booleans.
 * - Purity: the input round state is never mutated.
 * - Round-trip guarantee: every generated action applies successfully through
 *   `applyTurnCommand` (with the engine RNG supplied for Card 7), while curated
 *   illegal actions remain rejected.
 */
import {
  applyTurnCommand,
  createMatchState,
  setupRound,
  type CardInstance,
  type PlayerId,
  type PlayerState,
  type PlayCardCommand,
  type RoundState,
  type TurnCommand,
} from '../src';
import { getLegalActions } from '../src/legal-actions';
import { SeededRng } from '../src/rng';

type TurnResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurn = Extract<TurnResult, { ok: true }>;

const PECERA_CARD: CardInstance = {
  instanceId: 'pecera-instance',
  value: 1,
  type: 'PECERA_DE_CRISTAL',
};
const RATON_CARD: CardInstance = {
  instanceId: 'raton-instance',
  value: 2,
  type: 'RATON_TRAMPERO',
};
const CONEJITO_CARD: CardInstance = {
  instanceId: 'conejito-instance',
  value: 3,
  type: 'CONEJITO_GUERRILLERO',
};
const CAPARAZON_CARD: CardInstance = {
  instanceId: 'caparazon-instance',
  value: 4,
  type: 'CAPARAZON_ARMAZON',
};
const SERPIENTE_CARD: CardInstance = {
  instanceId: 'serpiente-instance',
  value: 5,
  type: 'SERPIENTE_ENCANTADORA',
};
const SAQUEADOG_CARD: CardInstance = {
  instanceId: 'saqueadog-instance',
  value: 6,
  type: 'SAQUEADOG_DE_TUMBAS',
};
const MALABARISTA_CARD: CardInstance = {
  instanceId: 'malabarista-instance',
  value: 7,
  type: 'MALABARISTA_DE_OCHO_PATAS',
};
const ERMITANO_CARD: CardInstance = {
  instanceId: 'ermitano-instance',
  value: 8,
  type: 'ERMITANO_BUSCA_CASA',
};

function cardOfValue(value: number): CardInstance {
  return { instanceId: `value-${value}-instance`, value, type: 'RATON_TRAMPERO' };
}

function createRound(playerIds: PlayerId[]): RoundState {
  const match = createMatchState({
    matchId: `match-${playerIds.join('-')}`,
    players: playerIds.map((id) => ({ id, name: id })),
  });
  return setupRound(match, new SeededRng(4242), ({ playerIds: ids }) => ids[0]);
}

function playerOf(round: RoundState, id: PlayerId): PlayerState {
  const player = round.players.find((candidate) => candidate.id === id);
  if (!player) {
    throw new Error(`Test fixture is missing player ${id}`);
  }
  return player;
}

function snapshotOf(round: RoundState): RoundState {
  return JSON.parse(JSON.stringify(round)) as RoundState;
}

function expectTurnSuccess(result: TurnResult): SuccessfulTurn {
  if (!result.ok) {
    throw new Error(`Expected a successful turn command, got error ${String(result.error)}`);
  }
  return result;
}

function expectTurnFailure(result: TurnResult): Extract<TurnResult, { ok: false }> {
  if (result.ok) {
    throw new Error('Expected a rejected turn command, but it succeeded');
  }
  return result;
}

/** Stages the actor into DRAW_REQUIRED (they are the current player by fixture). */
function stageDrawPhase(round: RoundState, actorId: PlayerId): RoundState {
  const actor = playerOf(round, actorId);
  actor.hand = [];
  round.drawPile = [cardOfValue(5), cardOfValue(7), cardOfValue(9)];
  round.phase = 'DRAW_REQUIRED';
  round.currentPlayerId = actorId;
  return round;
}

/** Stages the actor with a single hand card in PLAY_REQUIRED. */
function stagePlayPhase(round: RoundState, actorId: PlayerId, hand: CardInstance[]): RoundState {
  const actor = playerOf(round, actorId);
  actor.hand = hand;
  round.phase = 'PLAY_REQUIRED';
  round.currentPlayerId = actorId;
  return round;
}

/** Ends the round through the real lifecycle: eliminate everyone but one player. */
function stageEndedRound(round: RoundState): RoundState {
  const survivors = round.players.filter((player) => !player.eliminated);
  for (const player of survivors.slice(1)) {
    round.status = 'ROUND_END';
    round.winners = [survivors[0]!.id];
    player.eliminated = true;
  }
  return round;
}

describe('getLegalActions — terminal and actor guards', () => {
  it('returns [] for an ended round', () => {
    const round = stageEndedRound(createRound(['alpha', 'bravo', 'charlie']));
    expect(getLegalActions(round, round.currentPlayerId)).toEqual([]);
  });

  it('returns [] for an actor that is not the current player', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    const nonCurrent = round.turnOrder.find((id) => id !== round.currentPlayerId)!;
    expect(getLegalActions(round, nonCurrent)).toEqual([]);
  });

  it('returns [] for an eliminated actor even when they are current', () => {
    const round = createRound(['alpha', 'bravo']);
    playerOf(round, round.currentPlayerId).eliminated = true;
    expect(getLegalActions(round, round.currentPlayerId)).toEqual([]);
  });

  it('returns [] for an unknown actor id', () => {
    const round = createRound(['alpha', 'bravo']);
    expect(getLegalActions(round, 'ghost-player')).toEqual([]);
  });
});

describe('getLegalActions — DRAW_REQUIRED', () => {
  it('returns exactly one DRAW_CARD for the current actor', () => {
    const round = stageDrawPhase(createRound(['alpha', 'bravo']), 'alpha');
    expect(getLegalActions(round)).toEqual([{ type: 'DRAW_CARD', actorId: 'alpha' }]);
  });

  it('returns [] on the impossible draw state: empty pile in DRAW_REQUIRED', () => {
    const round = stageDrawPhase(createRound(['alpha', 'bravo']), 'alpha');
    round.drawPile = [];
    expect(getLegalActions(round)).toEqual([]);
  });
});

describe('getLegalActions — PLAY_REQUIRED non-target cards', () => {
  it('generates one targetless action per hand card', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [CAPARAZON_CARD, SAQUEADOG_CARD]);
    expect(getLegalActions(round)).toEqual([
      { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: CAPARAZON_CARD.instanceId },
      { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: SAQUEADOG_CARD.instanceId },
    ]);
  });

  it('never attaches a stray targetId to a non-target card', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [CAPARAZON_CARD, MALABARISTA_CARD, cardOfValue(10)]);
    const actions = getLegalActions(round);
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect('targetId' in action).toBe(false);
    }
  });

  it('expands each target-bearing card (3/5/8) to one action per canonical legal target', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [CONEJITO_CARD, SERPIENTE_CARD, ERMITANO_CARD]);
    const actions = getLegalActions(round);
    // Canonical order: stable sort by cardInstanceId — conejito < ermitano < serpiente.
    expect(actions).toEqual([
      {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: CONEJITO_CARD.instanceId,
        targetId: 'bravo',
      },
      {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: CONEJITO_CARD.instanceId,
        targetId: 'charlie',
      },
      {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: ERMITANO_CARD.instanceId,
        targetId: 'bravo',
      },
      {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: ERMITANO_CARD.instanceId,
        targetId: 'charlie',
      },
      {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: SERPIENTE_CARD.instanceId,
        targetId: 'bravo',
      },
      {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: SERPIENTE_CARD.instanceId,
        targetId: 'charlie',
      },
    ]);
  });

  it('excludes protected and eliminated players from the target expansion', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [CONEJITO_CARD]);
    playerOf(round, 'bravo').protected = true;
    playerOf(round, 'charlie').eliminated = true;
    // Only legal targets remain — none, because self is never a legal target.
    expect(getLegalActions(round)).toEqual([
      { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: CONEJITO_CARD.instanceId },
    ]);
  });

  it('keeps self-targeting out of the expansion', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [ERMITANO_CARD]);
    const targetIds = getLegalActions(round).map(
      (action) => (action as { targetId?: PlayerId }).targetId,
    );
    expect(targetIds).toEqual(['bravo']);
  });

  it('emits exactly one targetless fizzle action per target-bearing card when no legal target exists', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [CONEJITO_CARD, SERPIENTE_CARD, ERMITANO_CARD]);
    playerOf(round, 'bravo').protected = true;
    const actions = getLegalActions(round);
    // Canonical order: stable sort by cardInstanceId — conejito < ermitano < serpiente.
    expect(actions).toEqual([
      { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: CONEJITO_CARD.instanceId },
      { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: ERMITANO_CARD.instanceId },
      { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: SERPIENTE_CARD.instanceId },
    ]);
    for (const action of actions) {
      expect('targetId' in action).toBe(false);
    }
  });
});

describe('getLegalActions — pending interactions', () => {
  /** Drives a real Pecera play to open the PECERA_TARGET pending stage. */
  function stagePeceraTargetPending(round: RoundState, actorId: PlayerId): RoundState {
    stagePlayPhase(round, actorId, [PECERA_CARD, cardOfValue(5)]);
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId,
        cardInstanceId: PECERA_CARD.instanceId,
      }),
    );
    return played.state;
  }

  it('lists CHOOSE_TARGET for exactly the canonical legal targets during PECERA_TARGET', () => {
    const pending = stagePeceraTargetPending(createRound(['alpha', 'bravo', 'charlie']), 'alpha');
    playerOf(pending, 'charlie').protected = true;
    expect(pending.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'alpha' });
    expect(getLegalActions(pending)).toEqual([
      { type: 'CHOOSE_TARGET', actorId: 'alpha', targetId: 'bravo' },
    ]);
  });

  it('lists SUBMIT_GUESS values 0 and 2..10 during PECERA_GUESS (never 1)', () => {
    const pending = stagePeceraTargetPending(createRound(['alpha', 'bravo']), 'alpha');
    const guessed = expectTurnSuccess(
      applyTurnCommand(pending, { type: 'CHOOSE_TARGET', actorId: 'alpha', targetId: 'bravo' }),
    );
    expect(guessed.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'alpha',
      targetId: 'bravo',
    });
    expect(getLegalActions(guessed.state)).toEqual(
      [0, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({
        type: 'SUBMIT_GUESS',
        actorId: 'alpha',
        value,
      })),
    );
  });

  it('returns [] for pending decisions owed by another actor', () => {
    const pending = stagePeceraTargetPending(createRound(['alpha', 'bravo']), 'alpha');
    expect(getLegalActions(pending, 'bravo')).toEqual([]);
  });

  it('lists CHOOSE_DECK_POSITION indices 0..drawPile.length during RATON_INSERT_POSITION', () => {
    const round = createRound(['alpha', 'bravo']);
    const pileCards = [cardOfValue(5), cardOfValue(7), cardOfValue(9), cardOfValue(0)];
    round.drawPile = [...pileCards];
    stagePlayPhase(round, 'alpha', [RATON_CARD, cardOfValue(5)]);
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: RATON_CARD.instanceId,
      }),
    );
    expect(played.state.pendingInteraction).toEqual({
      type: 'RATON_INSERT_POSITION',
      actorId: 'alpha',
      card: pileCards[0],
    });
    // The inspected card was detached from the top: three cards remain.
    expect(played.state.drawPile).toHaveLength(3);
    expect(getLegalActions(played.state)).toEqual(
      [0, 1, 2, 3].map((index) => ({ type: 'CHOOSE_DECK_POSITION', actorId: 'alpha', index })),
    );
  });

  it('lists CHOOSE_HIDDEN_SWAP with both booleans during SAQUEADOG_SWAP', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [SAQUEADOG_CARD, cardOfValue(5)]);
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: SAQUEADOG_CARD.instanceId,
      }),
    );
    expect(played.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'alpha' });
    expect(getLegalActions(played.state)).toEqual([
      { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'alpha', swap: false },
      { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'alpha', swap: true },
    ]);
  });
});

describe('getLegalActions — purity and canonical ordering', () => {
  it('never mutates the input round state', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [CONEJITO_CARD, PECERA_CARD]);
    playerOf(round, 'charlie').protected = true;
    const snapshot = snapshotOf(round);
    getLegalActions(round);
    expect(snapshotOf(round)).toEqual(snapshot);
  });

  it('is deterministic across repeated calls', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [SERPIENTE_CARD, CAPARAZON_CARD, ERMITANO_CARD]);
    expect(getLegalActions(round)).toEqual(getLegalActions(round));
  });

  it('sorts canonically and stably by command type, card, target, index, and value', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [ERMITANO_CARD, CONEJITO_CARD, SERPIENTE_CARD]);
    const actions = getLegalActions(round);
    const keys = actions.map((action) => {
      const command = action as TurnCommand & {
        cardInstanceId?: string;
        targetId?: string;
        index?: number;
        value?: number;
      };
      return [
        command.type,
        command.cardInstanceId ?? '',
        command.targetId ?? '',
        command.index ?? -1,
        command.value ?? -1,
      ].join('|');
    });
    expect([...keys].sort()).toEqual(keys);
  });

  it('orders card-major before target-major across different cards', () => {
    // Card ids deliberately ordered so target-major sort within a card would
    // otherwise conflict with card-major sort across cards.
    const round = createRound(['alpha', 'zulu', 'yankee']);
    stagePlayPhase(round, 'alpha', [ERMITANO_CARD, CONEJITO_CARD]);
    const actions = getLegalActions(round) as PlayCardCommand[];
    // All Conejito actions come first (card-major), targets ascending within it.
    expect(actions.map((action) => action.cardInstanceId)).toEqual([
      CONEJITO_CARD.instanceId,
      CONEJITO_CARD.instanceId,
      ERMITANO_CARD.instanceId,
      ERMITANO_CARD.instanceId,
    ]);
    expect(actions.slice(0, 2).map((action) => action.targetId)).toEqual(['yankee', 'zulu']);
  });
});

describe('getLegalActions — round-trip through applyTurnCommand', () => {
  /**
   * Every generated action must be accepted by the engine. The engine RNG is
   * always supplied so a generated Card 7 action round-trips too.
   */
  function expectAllActionsRoundTrip(round: RoundState, actorId: PlayerId): void {
    for (const action of getLegalActions(round, actorId)) {
      const result = applyTurnCommand(round, action, { rng: new SeededRng(7) });
      if (!result.ok) {
        throw new Error(
          `Generated action was rejected by the engine (${String(result.error)}): ${JSON.stringify(
            action,
          )}`,
        );
      }
    }
  }

  it('round-trips every action in the draw phase', () => {
    const round = stageDrawPhase(createRound(['alpha', 'bravo']), 'alpha');
    expectAllActionsRoundTrip(round, 'alpha');
  });

  it('round-trips every action for non-target and target-bearing cards alike', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [
      CAPARAZON_CARD,
      CONEJITO_CARD,
      SERPIENTE_CARD,
      ERMITANO_CARD,
      MALABARISTA_CARD,
      cardOfValue(10),
    ]);
    expectAllActionsRoundTrip(round, 'alpha');
  });

  it('round-trips the targetless fizzle actions when no legal target exists', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [CONEJITO_CARD, ERMITANO_CARD]);
    playerOf(round, 'bravo').protected = true;
    expectAllActionsRoundTrip(round, 'alpha');
  });

  it('round-trips every PECERA_TARGET action', () => {
    // PECERA_TARGET.
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [PECERA_CARD, cardOfValue(5)]);
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: PECERA_CARD.instanceId,
      }),
    ).state;
    expectAllActionsRoundTrip(pending, 'alpha');
  });

  it('round-trips every PECERA_GUESS action', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [PECERA_CARD, cardOfValue(5)]);
    const targetPending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: PECERA_CARD.instanceId,
      }),
    ).state;
    const guessPending = expectTurnSuccess(
      applyTurnCommand(targetPending, {
        type: 'CHOOSE_TARGET',
        actorId: 'alpha',
        targetId: 'bravo',
      }),
    ).state;
    expect(guessPending.pendingInteraction?.type).toBe('PECERA_GUESS');
    expectAllActionsRoundTrip(guessPending, 'alpha');
  });

  it('round-trips every RATON_INSERT_POSITION action', () => {
    const round = createRound(['alpha', 'bravo']);
    round.drawPile = [cardOfValue(5), cardOfValue(7), cardOfValue(9), cardOfValue(0)];
    stagePlayPhase(round, 'alpha', [RATON_CARD, cardOfValue(5)]);
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: RATON_CARD.instanceId,
      }),
    ).state;
    expect(pending.pendingInteraction?.type).toBe('RATON_INSERT_POSITION');
    expectAllActionsRoundTrip(pending, 'alpha');
  });

  it('round-trips both SAQUEADOG_SWAP actions', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [SAQUEADOG_CARD, cardOfValue(5)]);
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: SAQUEADOG_CARD.instanceId,
      }),
    ).state;
    expect(pending.pendingInteraction?.type).toBe('SAQUEADOG_SWAP');
    expectAllActionsRoundTrip(pending, 'alpha');
  });
});

describe('curated illegal actions remain rejected', () => {
  it('rejects protected, self, and eliminated targets for target-bearing cards', () => {
    const round = createRound(['alpha', 'bravo', 'charlie']);
    stagePlayPhase(round, 'alpha', [CONEJITO_CARD, cardOfValue(4)]);
    playerOf(round, 'charlie').protected = true;
    expectTurnFailure(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: CONEJITO_CARD.instanceId,
        targetId: 'charlie',
      }),
    );
    expectTurnFailure(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: CONEJITO_CARD.instanceId,
        targetId: 'alpha',
      }),
    );
  });

  it('rejects SUBMIT_GUESS value 1 and out-of-range values', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [PECERA_CARD, cardOfValue(5)]);
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: PECERA_CARD.instanceId,
      }),
    ).state;
    const guessed = expectTurnSuccess(
      applyTurnCommand(pending, { type: 'CHOOSE_TARGET', actorId: 'alpha', targetId: 'bravo' }),
    ).state;
    for (const value of [1, -1, 11, 2.5]) {
      expectTurnFailure(
        applyTurnCommand(guessed, { type: 'SUBMIT_GUESS', actorId: 'alpha', value }),
      );
    }
  });

  it('rejects CHOOSE_DECK_POSITION indices outside 0..drawPile.length', () => {
    const round = createRound(['alpha', 'bravo']);
    round.drawPile = [cardOfValue(5), cardOfValue(7), cardOfValue(9), cardOfValue(0)];
    stagePlayPhase(round, 'alpha', [RATON_CARD, cardOfValue(5)]);
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: RATON_CARD.instanceId,
      }),
    ).state;
    for (const index of [-1, 4, 1.5]) {
      expectTurnFailure(
        applyTurnCommand(pending, { type: 'CHOOSE_DECK_POSITION', actorId: 'alpha', index }),
      );
    }
  });

  it('rejects a decision command for the wrong pending stage', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [SAQUEADOG_CARD, cardOfValue(5)]);
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: SAQUEADOG_CARD.instanceId,
      }),
    ).state;
    expectTurnFailure(
      applyTurnCommand(pending, { type: 'SUBMIT_GUESS', actorId: 'alpha', value: 3 }),
    );
  });

  it('rejects Card 7 without the engine RNG dependency', () => {
    const round = createRound(['alpha', 'bravo']);
    stagePlayPhase(round, 'alpha', [MALABARISTA_CARD, cardOfValue(5)]);
    expectTurnFailure(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: MALABARISTA_CARD.instanceId,
      }),
    );
  });
});
