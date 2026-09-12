/**
 * Card 3 — Conejito Guerrillero (catalog §3; rules §§6,7,13,14; engine spec
 * §§7,10,16,18,21; open questions "Equal hand values in Conejito comparison").
 *
 * Normative design under test:
 * - The card is a single atomic target decision carried as an optional
 *   `targetId` on `PLAY_CARD`; there is no pending interaction.
 * - Its printed action resolves only for voluntary origin `PLAYED` and compares
 *   the actor's remaining hand card value with the target's hand card value.
 *   The lower-valued holder is eliminated through the centralized
 *   `eliminatePlayer`; on equal values nobody is eliminated (project resolution).
 * - The comparison itself reveals no values: no value-bearing event is emitted,
 *   and the only public signals are the played card and any elimination.
 * - Targets are classified centrally: `TARGET_PROTECTED` is distinct from
 *   `ILLEGAL_TARGET` and shares the canonical `canTargetHand` seam.
 * - Targets are validated before any mutation or discard.
 * - Forced play and elimination reveal suppress the printed action.
 * - Rey Gato held in a hand is an ordinary value 10 for the comparison and is
 *   never triggered by it (it is not face up).
 */
import {
  createMatchState,
  eliminatePlayer,
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

const CONEJITO_CARD: CardInstance = {
  instanceId: 'conejito-instance',
  value: 3,
  type: 'CONEJITO_GUERRILLERO',
};
const REY_GATO_CARD: CardInstance = {
  instanceId: 'rey-gato-instance',
  value: 10,
  type: 'REY_GATO',
};

/** Generic stand-in hand card with a controlled comparison value. */
function cardOfValue(value: number): CardInstance {
  return { instanceId: `value-${value}-instance`, value, type: 'PECERA_DE_CRISTAL' };
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

function expectEffect(result: EffectResult): EffectResult {
  if (!result) {
    throw new Error('Expected an effect resolution result');
  }
  return result;
}

function expectEliminationSuccess(result: ReturnType<typeof eliminatePlayer>) {
  if (!result.ok) {
    throw new Error(`Expected a successful elimination, got error ${String(result.error)}`);
  }
  return result;
}

/** Deals Conejito to the actor and completes the normal draw so the card is playable. */
function drawWithConejitoInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [CONEJITO_CARD];
  return expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

/**
 * Stages a fully controlled comparison: the actor's remaining hand card and the
 * target's hand card are replaced with fixture cards of the requested values,
 * so the comparison outcome is deterministic regardless of the seeded deck.
 */
function stageComparison(
  round: RoundState,
  actorId: PlayerId,
  actorValue: number,
  targetId: PlayerId,
  targetValue: number,
): SuccessfulTurn {
  const drawn = drawWithConejitoInHand(round, actorId);
  playerOf(drawn.state, actorId).hand = [CONEJITO_CARD, cardOfValue(actorValue)];
  playerOf(drawn.state, targetId).hand = [cardOfValue(targetValue)];
  return drawn;
}

/** Plays Conejito from a staged state, optionally supplying the atomic target. */
function playConejito(state: RoundState, actorId: PlayerId, targetId?: PlayerId): TurnResult {
  return applyTurnCommand(state, {
    type: 'PLAY_CARD',
    actorId,
    cardInstanceId: CONEJITO_CARD.instanceId,
    ...(targetId === undefined ? {} : { targetId }),
  });
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

describe('Card 3 Conejito — voluntary play compares hands', () => {
  it('eliminates the target when the actor remaining hand value is higher', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    // The eliminated hand is revealed through the centralized elimination path.
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: cardOfValue(3), origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual([]);
    // The turn skips the eliminated player and lands on the next active player.
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    ]);
  });

  it('eliminates the actor when the actor remaining hand value is lower', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 2, 'p2', 9);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(playerOf(result.state, 'p1').eliminated).toBe(true);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p1').hand).toEqual([]);
    // The eliminated actor owned the turn: the centralized elimination handed
    // it to the next active player without a second advance.
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
    ]);
  });

  it('eliminates nobody on equal hand values and advances the turn normally', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 5, 'p2', 5);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p1').hand).toEqual([cardOfValue(5)]);
    expect(playerOf(result.state, 'p2').hand).toEqual([cardOfValue(5)]);
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([{ type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD }]);
  });

  it('ends the round when the comparison eliminates the second-to-last survivor', () => {
    const round = createRound(['p1', 'p2']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('returns immediately on target-elimination round end with no post-end advance', () => {
    const round = createRound(['p1', 'p2']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    // The effect's eliminatePlayer ended the round: applyPlayCard must return
    // that transition as-is instead of running another turn advance over an
    // ended round (spec §11; rules §9).
    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('emits no PROTECTION_EXPIRED after the effect already ended the round', () => {
    const round = createRound(['p1', 'p2']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);
    // Protection on the actor makes a post-end turn advance observable: a
    // wrap-around advance to the actor himself would expire it publicly.
    playerOf(staged.state, 'p1').protected = true;

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('emits no value-bearing event: the public stream carries ids only', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    const serializedEvents = JSON.stringify(result.events);
    // No remaining-hand identity leaks through the public event stream.
    for (const player of result.state.players) {
      for (const card of player.hand) {
        expect(serializedEvents).not.toContain(card.instanceId);
      }
    }
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
    for (const pileCard of result.state.drawPile) {
      expect(serializedEvents).not.toContain(pileCard.instanceId);
    }
    // No comparison-specific event type exists beyond the public play/elimination.
    const eventTypes = result.events.map((event) => event.type);
    expect(eventTypes).toEqual(['CARD_PLAYED', 'PLAYER_ELIMINATED']);
  });

  it('does not mutate the input state and returns a non-aliased clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);
    const before = snapshotOf(staged.state);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(staged.state).toEqual(before);
    expect(result.state).not.toBe(staged.state);
    expect(playerOf(result.state, 'p1')).not.toBe(playerOf(staged.state, 'p1'));
    expect(playerOf(result.state, 'p2')).not.toBe(playerOf(staged.state, 'p2'));
  });

  it('conserves every card instance exactly once across the comparison', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);
    const beforeIds = allCardInstanceIds(staged.state);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('leaves no pending interaction open — Conejito stays a single atomic decision', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const staged = stageComparison(round, 'p1', 9, 'p2', 3);

    const result = expectTurnSuccess(playConejito(staged.state, 'p1', 'p2'));

    expect(result.state.pendingInteraction).toBeNull();
  });
});

describe('Card 3 Conejito — Rey Gato in hand is ordinary value 10', () => {
  it('keeps an actor-held Rey Gato untriggered while it wins the comparison', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithConejitoInHand(round, 'p1');
    playerOf(drawn.state, 'p1').hand = [CONEJITO_CARD, REY_GATO_CARD];
    playerOf(drawn.state, 'p2').hand = [cardOfValue(3)];

    const result = expectTurnSuccess(playConejito(drawn.state, 'p1', 'p2'));

    // Rey Gato stays in the actor's hand; it was never face up, so no trigger.
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    ]);
  });

  it('keeps a target-held Rey Gato untriggered when the actor loses the comparison', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithConejitoInHand(round, 'p1');
    playerOf(drawn.state, 'p1').hand = [CONEJITO_CARD, cardOfValue(2)];
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playConejito(drawn.state, 'p1', 'p2'));

    // The actor (value 2) loses to the Rey Gato holder (value 10) without any
    // Rey Gato trigger: the cat stays in the target's hand, face down.
    expect(playerOf(result.state, 'p1').eliminated).toBe(true);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p2').hand).toEqual([REY_GATO_CARD]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
    ]);
  });
});

describe('Card 3 Conejito — target validation rejects without mutation', () => {
  const invalidCases: Array<{
    name: string;
    targetId?: PlayerId;
    expectedError: 'ILLEGAL_TARGET' | 'TARGET_PROTECTED';
    mutateFixture?: (round: RoundState) => void;
  }> = [
    { name: 'missing target', expectedError: 'ILLEGAL_TARGET' },
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
    it(`rejects a ${testCase.name} with ${testCase.expectedError} and leaves the state untouched`, () => {
      const round = createRound(['p1', 'p2', 'p3']);
      const drawn = drawWithConejitoInHand(round, 'p1');
      if (testCase.mutateFixture) {
        testCase.mutateFixture(drawn.state);
      }
      const before = snapshotOf(drawn.state);

      const result = expectTurnFailure(playConejito(drawn.state, 'p1', testCase.targetId));

      expect(result.error).toBe(testCase.expectedError);
      expect(result.state).toEqual(before);
      // No partial mutation: hands, discards, turn, and phase are untouched.
      expect(playerOf(result.state, 'p1').discards).toEqual(playerOf(drawn.state, 'p1').discards);
      expect(result.state.currentPlayerId).toBe('p1');
      expect(result.state.phase).toBe('PLAY_REQUIRED');
    });
  }
});

describe('Card 3 Conejito — zero-legal-target fizzle (no-legal-target rule)', () => {
  it('discards normally with no effect when every other player is protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithConejitoInHand(round, 'p1');
    const remainingActorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== CONEJITO_CARD.instanceId,
    );
    if (!remainingActorCard) {
      throw new Error('Test fixture expected the actor hand to hold one card');
    }
    playerOf(drawn.state, 'p2').protected = true;
    playerOf(drawn.state, 'p3').protected = true;
    const before = snapshotOf(drawn.state);

    // Mandatory play with zero legal targets: omitted targetId is allowed and
    // the printed effect does nothing.
    const result = expectTurnSuccess(playConejito(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    // The card is discarded normally; printed effect does nothing.
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: CONEJITO_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p1').hand).toEqual([remainingActorCard]);
    expect(playerOf(result.state, 'p2').hand).toEqual(playerOf(drawn.state, 'p2').hand);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(drawn.state, 'p3').hand);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p3').eliminated).toBe(false);
    // No mutation beyond the normal play/turn lifecycle: the play event plus the
    // normal begin-turn protection expiry on the next actor.
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p2' },
    ]);
    expect(playerOf(result.state, 'p2').protected).toBe(false);
    expect(playerOf(result.state, 'p3').protected).toBe(true);
    expect(drawn.state).toEqual(before);
  });

  it('discards normally with no effect on an eliminated-plus-protected mix', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithConejitoInHand(round, 'p1');
    playerOf(drawn.state, 'p2').eliminated = true;
    playerOf(drawn.state, 'p3').protected = true;

    const result = expectTurnSuccess(playConejito(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p3');
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: CONEJITO_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(playerOf(result.state, 'p3').eliminated).toBe(false);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    // Turn advance lands on protected p3 and expires that protection normally.
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CONEJITO_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p3' },
    ]);
  });

  it('still requires targetId when a legal target exists despite other eliminated players', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithConejitoInHand(round, 'p1');
    // p3 eliminated, but p2 remains a legal target: omission is still an error.
    playerOf(drawn.state, 'p3').eliminated = true;
    const before = snapshotOf(drawn.state);

    const result = expectTurnFailure(playConejito(drawn.state, 'p1'));

    expect(result.error).toBe('ILLEGAL_TARGET');
    expect(result.state).toEqual(before);
  });

  it('still returns TARGET_PROTECTED for an explicit protected target when others are also protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithConejitoInHand(round, 'p1');
    playerOf(drawn.state, 'p2').protected = true;
    playerOf(drawn.state, 'p3').protected = true;
    const before = snapshotOf(drawn.state);

    // Zero legal targets never reclassifies an explicit protected target.
    const result = expectTurnFailure(playConejito(drawn.state, 'p1', 'p2'));

    expect(result.error).toBe('TARGET_PROTECTED');
    expect(result.state).toEqual(before);
  });
});

describe('Card 3 Conejito — suppression of the printed action', () => {
  it('does not compare hands when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [CONEJITO_CARD, cardOfValue(9)];
    playerOf(round, 'p2').hand = [cardOfValue(3)];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: CONEJITO_CARD,
        origin: 'FORCED_PLAY',
        targetId: 'p2',
      }),
    );

    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(round).toEqual(before);
  });

  it('keeps the elimination-reveal origin out of the effect dispatch entirely', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [CONEJITO_CARD];
    const actorCard = playerOf(round, 'p1').hand[0];
    const before = snapshotOf(round);

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    // The printed action is not resolved for a defeated player's reveal (rules §6.3).
    const eliminated = playerOf(result.state, 'p2');
    expect(eliminated.discards).toEqual([{ card: CONEJITO_CARD, origin: 'ELIMINATION_REVEAL' }]);
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(result.events.every((event) => event.type === 'PLAYER_ELIMINATED')).toBe(true);
    expect(round).toEqual(before);
  });
});
