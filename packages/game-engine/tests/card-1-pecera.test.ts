/**
 * Card 1 — Pecera de Cristal (catalog §1; rules §§13,14; engine spec §§5,6,7,
 * 10,16,21; test plan §7; UI spec §11).
 *
 * Normative design under test:
 * - Pecera is the first two-step card: voluntary PLAY_CARD discards it and, when
 *   legal targets exist, opens a `PECERA_TARGET` pending interaction for the
 *   actor without advancing the turn (spec §6: a pending interaction pauses the
 *   normal turn until the required decision arrives).
 * - `CHOOSE_TARGET` validates the actor/pending match and canonical target
 *   legality, then opens `PECERA_GUESS` for the same actor; the turn stays
 *   paused.
 * - `SUBMIT_GUESS` validates the actor/pending match and an integer value
 *   0..10 excluding 1 (catalog: "You may not guess value 1"). A correct guess
 *   eliminates the target through the centralized `eliminatePlayer`; a wrong
 *   guess neither reveals nor mutates the target hand. The turn finalizes
 *   exactly once after the guess, unless the elimination already ended the
 *   round.
 * - Zero-legal-target fizzle (no-legal-target rule): when no legal opponent
 *   exists at play time, the card is discarded, no pending opens, no effect
 *   happens, and the turn advances normally.
 * - Public events are secret-free: `PECERA_GUESS_RESOLVED` carries only
 *   actorId, targetId, and correct — never the guessed or the actual value.
 * - Forced play and elimination reveals suppress the printed action, so they
 *   never open a pending interaction (spec §18).
 */
import {
  createMatchState,
  eliminatePlayer,
  hasLegalHandTarget,
  resolveFaceUpCardEffect,
  SeededRng,
  setupRound,
  type CardInstance,
  type PlayerId,
  type PlayerState,
  type RoundState,
} from '../src';
import { applyTurnCommand } from '../src/turn-engine';

type TurnResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurn = Extract<TurnResult, { ok: true }>;
type EffectResult = ReturnType<typeof resolveFaceUpCardEffect>;

const PECERA_CARD: CardInstance = {
  instanceId: 'pecera-instance',
  value: 1,
  type: 'PECERA_DE_CRISTAL',
};

/** Generic stand-in hand card with a controlled secret value. */
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
    throw new Error(`Expected a rejected turn command, but it succeeded`);
  }
  return result;
}

/** Deals Pecera to the actor and completes the normal draw so the card is playable. */
function drawWithPeceraInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [PECERA_CARD];
  const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
  playerOf(drawn.state, actorId).hand = [PECERA_CARD, cardOfValue(5)];
  return drawn;
}

/** Plays Pecera from a state where the actor already completed the normal draw. */
function playPecera(state: RoundState, actorId: PlayerId): TurnResult {
  return applyTurnCommand(state, {
    type: 'PLAY_CARD',
    actorId,
    cardInstanceId: PECERA_CARD.instanceId,
  });
}

/** Stages the actor with Pecera plus a controlled remaining card, draws, and plays it. */
function stagePeceraPlay(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  const drawn = drawWithPeceraInHand(round, actorId);
  return expectTurnSuccess(playPecera(drawn.state, actorId));
}

/**
 * Drives the real two-step flow up to the guess decision: play Pecera, then
 * choose the target. The target keeps whatever hand the fixture gave it.
 */
function stagePendingGuess(round: RoundState, actorId: PlayerId, targetId: PlayerId): RoundState {
  const played = stagePeceraPlay(round, actorId);
  const chosen = expectTurnSuccess(
    applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId, targetId }),
  );
  return chosen.state;
}

/** Collects every card instanceId across all locations; used for conservation checks. */
function allCardInstanceIds(round: RoundState): string[] {
  const ids: string[] = [
    round.hiddenCard.instanceId,
    ...round.drawPile.map((card) => card.instanceId),
  ];
  for (const player of round.players) {
    ids.push(...player.hand.map((card) => card.instanceId));
    ids.push(...player.discards.map((entry) => entry.card.instanceId));
  }
  return ids.sort();
}

describe('Card 1 Pecera — voluntary play opens the target decision', () => {
  it('opens PECERA_TARGET, discards the card publicly, and does not advance the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);

    const result = stagePeceraPlay(round, 'p1');

    expect(result.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p1' });
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: PECERA_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p1').hand).toEqual([cardOfValue(5)]);
    // The turn is paused: same actor, still PLAY_REQUIRED.
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('PLAY_REQUIRED');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([{ type: 'CARD_PLAYED', playerId: 'p1', card: PECERA_CARD }]);
  });

  it('ignores a stray targetId on the play command — targeting is a pending decision', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithPeceraInHand(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: PECERA_CARD.instanceId,
        targetId: 'p2',
      }),
    );

    // No atomic target was consumed: the actor still owes the PECERA_TARGET decision.
    expect(result.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p1' });
    expect(result.state.currentPlayerId).toBe('p1');
  });

  it('CHOOSE_TARGET moves the pending to PECERA_GUESS and keeps the turn paused', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' }),
    );

    expect(result.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'p1',
      targetId: 'p2',
    });
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('PLAY_REQUIRED');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([]);
  });
});

describe('Card 1 Pecera — zero-legal-target fizzle (no-legal-target rule)', () => {
  it('discards normally with no pending and normal turn advance when every other player is protected', () => {
    const fresh = createRound(['p1', 'p2', 'p3']);
    playerOf(fresh, 'p2').protected = true;
    playerOf(fresh, 'p3').protected = true;
    expect(hasLegalHandTarget(fresh, 'p1')).toBe(false);
    const drawn = drawWithPeceraInHand(fresh, 'p1');
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playPecera(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: PECERA_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p1').hand).toEqual([cardOfValue(5)]);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p3').eliminated).toBe(false);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: PECERA_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p2' },
    ]);
    expect(playerOf(result.state, 'p2').protected).toBe(false);
    expect(playerOf(result.state, 'p3').protected).toBe(true);
    expect(drawn.state).toEqual(before);
  });

  it('discards normally with no pending on an eliminated-plus-protected mix', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p3').protected = true;
    expect(hasLegalHandTarget(round, 'p1')).toBe(false);
    const drawn = drawWithPeceraInHand(round, 'p1');

    const result = expectTurnSuccess(playPecera(drawn.state, 'p1'));

    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: PECERA_CARD, origin: 'PLAYED' },
    ]);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: PECERA_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p3' },
    ]);
  });
});

describe('Card 1 Pecera — CHOOSE_TARGET validation rejects without mutation', () => {
  const invalidCases: Array<{
    name: string;
    targetId?: PlayerId;
    expectedError: 'ILLEGAL_TARGET' | 'TARGET_PROTECTED';
    mutateFixture?: (round: RoundState) => void;
  }> = [
    { name: 'self target', targetId: 'p1', expectedError: 'ILLEGAL_TARGET' },
    { name: 'unknown target', targetId: 'ghost-player', expectedError: 'ILLEGAL_TARGET' },
    {
      name: 'eliminated target',
      targetId: 'p3',
      expectedError: 'ILLEGAL_TARGET',
      mutateFixture: (round) => {
        playerOf(round, 'p3').eliminated = true;
      },
    },
    {
      name: 'protected target',
      targetId: 'p3',
      expectedError: 'TARGET_PROTECTED',
      mutateFixture: (round) => {
        playerOf(round, 'p3').protected = true;
      },
    },
  ];

  for (const testCase of invalidCases) {
    it(`rejects a ${testCase.name} with ${testCase.expectedError} and keeps the pending open`, () => {
      const round = createRound(['p1', 'p2', 'p3']);
      const played = stagePeceraPlay(round, 'p1');
      if (testCase.mutateFixture) {
        testCase.mutateFixture(played.state);
      }
      const before = snapshotOf(played.state);

      const result = expectTurnFailure(
        applyTurnCommand(played.state, {
          type: 'CHOOSE_TARGET',
          actorId: 'p1',
          targetId: testCase.targetId as PlayerId,
        }),
      );

      expect(result.error).toBe(testCase.expectedError);
      expect(result.state).toEqual(before);
      expect(result.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p1' });
    });
  }
});

describe('Card 1 Pecera — pending command routing', () => {
  it('rejects CHOOSE_TARGET from a wrong actor with NOT_YOUR_TURN and keeps the pending open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p2', targetId: 'p3' }),
    );

    expect(result.error).toBe('NOT_YOUR_TURN');
    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p1' });
  });

  it('rejects SUBMIT_GUESS while the pending stage is PECERA_TARGET', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
  });

  it('rejects CHOOSE_DECK_POSITION while a Pecera pending interaction is open (Card 2 regression)', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 0 }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
  });

  it('rejects DRAW_CARD while a Pecera pending interaction is open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, { type: 'DRAW_CARD', actorId: 'p1' }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
  });

  it('rejects PLAY_CARD while a Pecera pending interaction is open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: cardOfValue(5).instanceId,
      }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
  });

  it('rejects CHOOSE_TARGET while the pending stage is PECERA_GUESS', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const before = snapshotOf(guessStage);

    const result = expectTurnFailure(
      applyTurnCommand(guessStage, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p3' }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'p1',
      targetId: 'p2',
    });
  });

  it('rejects CHOOSE_HIDDEN_SWAP while the pending stage is PECERA_GUESS', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const before = snapshotOf(guessStage);

    const result = expectTurnFailure(
      applyTurnCommand(guessStage, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p1',
        swap: true,
      }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'p1',
      targetId: 'p2',
    });
  });

  it('rejects CHOOSE_HIDDEN_SWAP while the pending stage is PECERA_TARGET', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p1',
        swap: false,
      }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p1' });
  });

  it('rejects SUBMIT_GUESS from a wrong actor with NOT_YOUR_TURN', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const before = snapshotOf(guessStage);

    const result = expectTurnFailure(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p3', value: 7 }),
    );

    expect(result.error).toBe('NOT_YOUR_TURN');
    expect(result.state).toEqual(before);
  });
});

describe('Card 1 Pecera — SUBMIT_GUESS resolves the guess', () => {
  it('a correct guess eliminates the target through the centralized path and finalizes the turn once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];

    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 }),
    );

    expect(result.state.pendingInteraction).toBeNull();
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    // Centralized elimination: the hand is revealed into the public discard area.
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: cardOfValue(7), origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual([]);
    // The turn finalized exactly once: from the actor, skipping the eliminated target.
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: true },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    ]);
  });

  it('a correct guess in a two-player round ends the round with no extra turn advance', () => {
    const round = createRound(['p1', 'p2']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];

    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 }),
    );

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: true },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('a wrong guess does not reveal or mutate the target hand and advances the turn once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];

    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 3 }),
    );

    expect(result.state.pendingInteraction).toBeNull();
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    // The target hand is untouched and stays private: no reveal, no discard.
    expect(playerOf(result.state, 'p2').hand).toEqual([cardOfValue(7)]);
    expect(playerOf(result.state, 'p2').discards).toEqual([]);
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: false },
    ]);
  });

  it('a guess matching a value held elsewhere only affects the chosen target', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    playerOf(round, 'p3').hand = [cardOfValue(7)];

    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 }),
    );

    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(playerOf(result.state, 'p3').eliminated).toBe(false);
    expect(playerOf(result.state, 'p3').hand).toEqual([cardOfValue(7)]);
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: true },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    ]);
  });

  it('a wrong guess equal to the actor remaining card value still does nothing to the target', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];

    const played = stagePeceraPlay(round, 'p1');
    const chosen = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' }),
    );
    const result = expectTurnSuccess(
      applyTurnCommand(chosen.state, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 5 }),
    );

    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p2').hand).toEqual([cardOfValue(7)]);
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: false },
    ]);
  });

  it('accepts guess value 0 as a legal guess', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(0)];

    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 0 }),
    );

    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: true },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    ]);
  });

  it('accepts guess value 10 as a legal guess', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];

    const guessStage = stagePendingGuess(round, 'p1', 'p2');
    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 10 }),
    );

    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: false },
    ]);
  });

  it.each([1, 11, -1, 2.5, Number.NaN])(
    'rejects guess value %p with INVALID_GUESS and keeps the pending guess open',
    (invalidValue) => {
      const round = createRound(['p1', 'p2', 'p3']);
      playerOf(round, 'p2').hand = [cardOfValue(7)];
      const guessStage = stagePendingGuess(round, 'p1', 'p2');
      const before = snapshotOf(guessStage);

      const result = expectTurnFailure(
        applyTurnCommand(guessStage, {
          type: 'SUBMIT_GUESS',
          actorId: 'p1',
          value: invalidValue,
        }),
      );

      expect(result.error).toBe('INVALID_GUESS');
      expect(result.state).toEqual(before);
      expect(result.state.pendingInteraction).toEqual({
        type: 'PECERA_GUESS',
        actorId: 'p1',
        targetId: 'p2',
      });
      expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    },
  );

  it('a wrong guess on an exhausted draw pile ends the round after the guess, exactly once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const played = stagePeceraPlay(round, 'p1');
    // The last drawable card was consumed by the play: the deferred round-end
    // check must fire only when the pending guess resolves.
    played.state.drawPile = [];
    const chosen = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' }),
    );

    const result = expectTurnSuccess(
      applyTurnCommand(chosen.state, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 3 }),
    );

    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 keeps value 5, p2 holds value 7, p3 value 1 — p2 wins.
    expect(result.state.winners).toEqual(['p2']);
    expect(result.state.pendingInteraction).toBeNull();
    const p1Hand = playerOf(result.state, 'p1').hand[0];
    const p2Hand = playerOf(result.state, 'p2').hand[0];
    const p3Hand = playerOf(result.state, 'p3').hand[0];
    if (!p1Hand || !p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: false },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: p1Hand },
          { playerId: 'p2', card: p2Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });
});

describe('Card 1 Pecera — privacy of the public event stream', () => {
  it('emits PECERA_GUESS_RESOLVED with ids and correctness only — never guessed or actual values', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const guessStage = stagePendingGuess(round, 'p1', 'p2');

    const result = expectTurnSuccess(
      applyTurnCommand(guessStage, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 3 }),
    );

    const resolved = result.events.find((event) => event.type === 'PECERA_GUESS_RESOLVED');
    expect(resolved).toEqual({
      type: 'PECERA_GUESS_RESOLVED',
      actorId: 'p1',
      targetId: 'p2',
      correct: false,
    });

    const serializedEvents = JSON.stringify(result.events);
    // No remaining-hand identity or value leaks through the public event stream.
    for (const player of result.state.players) {
      for (const card of player.hand) {
        expect(serializedEvents).not.toContain(card.instanceId);
        expect(serializedEvents).not.toContain(`"value":${card.value}`);
      }
    }
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
    for (const pileCard of result.state.drawPile) {
      expect(serializedEvents).not.toContain(pileCard.instanceId);
    }
  });
});

describe('Card 1 Pecera — purity and conservation', () => {
  it('does not mutate the input state and deep-clones the pending interaction', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const played = stagePeceraPlay(round, 'p1');
    const before = snapshotOf(round);

    // The input round never gained a pending interaction.
    expect(round.pendingInteraction).toBeNull();
    expect(round).toEqual(before);

    const chosen = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' }),
    );
    // The input pending object is preserved and the new pending is a fresh clone.
    expect(played.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p1' });
    if (!chosen.state.pendingInteraction || !played.state.pendingInteraction) {
      throw new Error('Expected pending interactions on both states');
    }
    expect(chosen.state.pendingInteraction).not.toBe(played.state.pendingInteraction);
    expect(chosen.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'p1',
      targetId: 'p2',
    });

    const resolved = expectTurnSuccess(
      applyTurnCommand(chosen.state, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 3 }),
    );
    // The input guess-stage state is untouched by the resolution.
    expect(chosen.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'p1',
      targetId: 'p2',
    });
    expect(resolved.state).not.toBe(chosen.state);
  });

  it('conserves every card instance exactly once across the full two-step flow', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const played = stagePeceraPlay(round, 'p1');
    const chosen = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' }),
    );
    const beforeIds = allCardInstanceIds(chosen.state);

    const resolved = expectTurnSuccess(
      applyTurnCommand(chosen.state, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 3 }),
    );

    expect(allCardInstanceIds(resolved.state)).toEqual(beforeIds);
  });

  it('conserves every card instance exactly once when a correct guess eliminates the target', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [cardOfValue(7)];
    const played = stagePeceraPlay(round, 'p1');
    const chosen = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' }),
    );
    const beforeIds = allCardInstanceIds(chosen.state);

    const resolved = expectTurnSuccess(
      applyTurnCommand(chosen.state, { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 }),
    );

    expect(allCardInstanceIds(resolved.state)).toEqual(beforeIds);
  });
});

describe('Card 1 Pecera — suppression of the printed action', () => {
  it('does not open a pending interaction when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [PECERA_CARD, cardOfValue(5)];
    const before = snapshotOf(round);

    const result: EffectResult = resolveFaceUpCardEffect(round, {
      playerId: 'p1',
      card: PECERA_CARD,
      origin: 'FORCED_PLAY',
    });

    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(round).toEqual(before);
  });

  it('keeps the elimination-reveal path out of the pending flow entirely', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [PECERA_CARD];
    const before = snapshotOf(round);

    const result = eliminatePlayer(round, 'p2');

    if (!result.ok) {
      throw new Error(`Expected a successful elimination, got error ${String(result.error)}`);
    }
    expect(result.state.pendingInteraction).toBeNull();
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: PECERA_CARD, origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(result.events.every((event) => event.type === 'PLAYER_ELIMINATED')).toBe(true);
    expect(round).toEqual(before);
  });
});
