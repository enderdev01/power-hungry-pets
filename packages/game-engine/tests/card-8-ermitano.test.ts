/**
 * Card 8 — Ermitaño Busca Casa (catalog §8; rules §§6,7,13,14; engine spec
 * §§7,10,16,18,21).
 *
 * Normative design under test:
 * - The card is a single atomic target decision carried as an optional
 *   `targetId` on `PLAY_CARD`; there is no pending interaction.
 * - Its printed action resolves only for voluntary origin `PLAYED` and swaps
 *   the actor's one remaining hand card with one legal, active, unprotected
 *   other player's hand card. Neither card is revealed.
 * - `HANDS_SWAPPED` is public and secret-free: player ids only, no card data.
 * - Targets are classified centrally: `TARGET_PROTECTED` is distinct from
 *   `ILLEGAL_TARGET` and shares the canonical `canTargetHand` seam.
 * - Targets are validated before any mutation or discard.
 * - Forced play and elimination reveal suppress the printed action.
 * - Rey Gato in a hand is never triggered by a swap (it is not face up).
 */
import {
  canTargetHand,
  classifyHandTarget,
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

const ERMITANO_CARD: CardInstance = {
  instanceId: 'ermitano-instance',
  value: 8,
  type: 'ERMITANO_BUSCA_CASA',
};
const REY_GATO_CARD: CardInstance = {
  instanceId: 'rey-gato-instance',
  value: 10,
  type: 'REY_GATO',
};

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

/** Deals Ermitaño to the actor and completes the normal draw so the card is playable. */
function drawWithErmitanoInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [ERMITANO_CARD];
  return expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

/** Plays Ermitaño from a post-draw state, optionally supplying the atomic target. */
function playErmitano(state: RoundState, actorId: PlayerId, targetId?: PlayerId): TurnResult {
  return applyTurnCommand(state, {
    type: 'PLAY_CARD',
    actorId,
    cardInstanceId: ERMITANO_CARD.instanceId,
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

describe('Card 8 Ermitaño — voluntary play swaps hands', () => {
  it('exchanges the actor hand card with the target hand card, emits HANDS_SWAPPED, and advances the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== ERMITANO_CARD.instanceId,
    );
    const targetCard = playerOf(drawn.state, 'p2').hand[0];
    if (!actorCard || !targetCard) {
      throw new Error('Test fixture expected both hands to hold one card');
    }

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p2'));

    expect(playerOf(result.state, 'p1').hand).toEqual([targetCard]);
    expect(playerOf(result.state, 'p2').hand).toEqual([actorCard]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: ERMITANO_CARD, origin: 'PLAYED' },
    ]);
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: ERMITANO_CARD },
      { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
    ]);
  });

  it('emits a public, secret-free HANDS_SWAPPED event containing player ids only', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p3'));

    const swapEvents = result.events.filter((event) => event.type === 'HANDS_SWAPPED');
    expect(swapEvents).toEqual([{ type: 'HANDS_SWAPPED', playerIds: ['p1', 'p3'] }]);
    const serializedEvents = JSON.stringify(result.events);
    // No card identities or values leak through the public event stream.
    for (const pileCard of result.state.drawPile) {
      expect(serializedEvents).not.toContain(pileCard.instanceId);
    }
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
    for (const player of result.state.players) {
      for (const card of player.hand) {
        expect(serializedEvents).not.toContain(card.instanceId);
      }
    }
  });

  it('advances the turn with protection expiry after the swap when the next player is protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    playerOf(drawn.state, 'p2').protected = true;

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p3'));

    expect(result.state.currentPlayerId).toBe('p2');
    expect(playerOf(result.state, 'p2').protected).toBe(false);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: ERMITANO_CARD },
      { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p3'] },
      { type: 'PROTECTION_EXPIRED', playerId: 'p2' },
    ]);
  });

  it('ends the round on an empty draw pile instead of advancing into an impossible draw', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    drawn.state.drawPile = [];
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== ERMITANO_CARD.instanceId,
    );
    const targetCard = playerOf(drawn.state, 'p2').hand[0];
    if (!actorCard || !targetCard) {
      throw new Error('Test fixture expected both hands to hold one card');
    }

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p2'));

    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 ends with p2's value 5 card, p2 with p1's value 3 card,
    // p3 holds value 1 — p1 wins outright on hand value.
    expect(result.state.winners).toEqual(['p1']);
    // The swap still resolved before the round-end check (spec §10 sequence).
    expect(playerOf(result.state, 'p1').hand).toEqual([targetCard]);
    expect(playerOf(result.state, 'p2').hand).toEqual([actorCard]);
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p3Hand) {
      throw new Error('Test fixture expected one hand card for p3');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: ERMITANO_CARD },
      { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: targetCard },
          { playerId: 'p2', card: actorCard },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('does not mutate the input state and returns a non-aliased clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p2'));

    expect(drawn.state).toEqual(before);
    expect(result.state).not.toBe(drawn.state);
    expect(playerOf(result.state, 'p1')).not.toBe(playerOf(drawn.state, 'p1'));
    expect(playerOf(result.state, 'p2')).not.toBe(playerOf(drawn.state, 'p2'));
  });

  it('conserves every card instance exactly once across the swap', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    const beforeIds = allCardInstanceIds(drawn.state);

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p2'));

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('leaves no pending interaction open — Ermitaño stays a single atomic decision', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p2'));

    expect(result.state.pendingInteraction).toBeNull();
  });

  it('leaves a Rey Gato held in a hand untriggered by the swap', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1', 'p2'));

    // The Rey Gato moved into the actor's hand without ever being face up.
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events.some((event) => event.type === 'PLAYER_ELIMINATED')).toBe(false);
  });
});

describe('Card 8 Ermitaño — target validation rejects without mutation', () => {
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
      const drawn = drawWithErmitanoInHand(round, 'p1');
      if (testCase.mutateFixture) {
        testCase.mutateFixture(drawn.state);
      }
      const before = snapshotOf(drawn.state);

      const result = expectTurnFailure(playErmitano(drawn.state, 'p1', testCase.targetId));

      expect(result.error).toBe(testCase.expectedError);
      expect(result.state).toEqual(before);
      // No partial mutation: hands, discards, turn, and phase are untouched.
      expect(playerOf(result.state, 'p1').discards).toEqual(playerOf(drawn.state, 'p1').discards);
      expect(result.state.currentPlayerId).toBe('p1');
      expect(result.state.phase).toBe('PLAY_REQUIRED');
    });
  }
});

describe('classifyHandTarget — centralized classifier (engine spec §16, §21)', () => {
  it('accepts an active, unprotected, other-player target as LEGAL_TARGET', () => {
    const round = createRound(['p1', 'p2', 'p3']);

    expect(classifyHandTarget(round, 'p1', 'p2')).toBe('LEGAL_TARGET');
    expect(classifyHandTarget(round, 'p1', 'p3')).toBe('LEGAL_TARGET');
  });

  it('classifies self, unknown, and eliminated targets as ILLEGAL_TARGET', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p3').eliminated = true;

    expect(classifyHandTarget(round, 'p1', 'p1')).toBe('ILLEGAL_TARGET');
    expect(classifyHandTarget(round, 'p1', 'ghost-player')).toBe('ILLEGAL_TARGET');
    expect(classifyHandTarget(round, 'p1', 'p3')).toBe('ILLEGAL_TARGET');
  });

  it('classifies a protected target as TARGET_PROTECTED, distinct from ILLEGAL_TARGET', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').protected = true;

    expect(classifyHandTarget(round, 'p1', 'p2')).toBe('TARGET_PROTECTED');
  });

  it('never diverges from the canonical canTargetHand boolean', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').protected = true;
    playerOf(round, 'p3').eliminated = true;

    for (const targetId of ['p1', 'p2', 'p3', 'ghost-player']) {
      expect(classifyHandTarget(round, 'p1', targetId) === 'LEGAL_TARGET').toBe(
        canTargetHand(round, 'p1', targetId),
      );
    }
  });
});

describe('Card 8 Ermitaño — zero-legal-target fizzle (no-legal-target rule)', () => {
  it('canonical hasLegalHandTarget seam tracks eliminated and protected players', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    expect(hasLegalHandTarget(round, 'p1')).toBe(true);
    playerOf(round, 'p2').protected = true;
    expect(hasLegalHandTarget(round, 'p1')).toBe(true);
    playerOf(round, 'p3').protected = true;
    expect(hasLegalHandTarget(round, 'p1')).toBe(false);
    playerOf(round, 'p3').protected = false;
    playerOf(round, 'p3').eliminated = true;
    playerOf(round, 'p2').protected = false;
    expect(hasLegalHandTarget(round, 'p1')).toBe(true);
    playerOf(round, 'p2').protected = true;
    expect(hasLegalHandTarget(round, 'p1')).toBe(false);
    // Self is never a legal target, so a lone survivor has no legal target.
    playerOf(round, 'p3').eliminated = false;
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p3').eliminated = true;
    expect(hasLegalHandTarget(round, 'p1')).toBe(false);
  });

  it('discards normally with no swap when every other player is protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== ERMITANO_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one card');
    }
    playerOf(drawn.state, 'p2').protected = true;
    playerOf(drawn.state, 'p3').protected = true;
    const before = snapshotOf(drawn.state);

    // Mandatory play with zero legal targets: omitted targetId is allowed and
    // the printed effect does nothing.
    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    // The card is discarded normally; no swap happened.
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: ERMITANO_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual(playerOf(drawn.state, 'p2').hand);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(drawn.state, 'p3').hand);
    // No mutation beyond the normal play/turn lifecycle: the play event plus the
    // normal begin-turn protection expiry on the next actor.
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: ERMITANO_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p2' },
    ]);
    expect(playerOf(result.state, 'p2').protected).toBe(false);
    expect(playerOf(result.state, 'p3').protected).toBe(true);
    expect(drawn.state).toEqual(before);
  });

  it('discards normally with no swap on an eliminated-plus-protected mix', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    playerOf(drawn.state, 'p2').eliminated = true;
    playerOf(drawn.state, 'p3').protected = true;

    const result = expectTurnSuccess(playErmitano(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p3');
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: ERMITANO_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    // Turn advance lands on protected p3 and expires that protection normally.
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: ERMITANO_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p3' },
    ]);
  });

  it('still requires targetId when a legal target exists despite other eliminated players', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    // p3 eliminated, but p2 remains a legal target: omission is still an error.
    playerOf(drawn.state, 'p3').eliminated = true;
    const before = snapshotOf(drawn.state);

    const result = expectTurnFailure(playErmitano(drawn.state, 'p1'));

    expect(result.error).toBe('ILLEGAL_TARGET');
    expect(result.state).toEqual(before);
  });

  it('still returns TARGET_PROTECTED for an explicit protected target when others are also protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithErmitanoInHand(round, 'p1');
    playerOf(drawn.state, 'p2').protected = true;
    playerOf(drawn.state, 'p3').protected = true;
    const before = snapshotOf(drawn.state);

    // Zero legal targets never reclassifies an explicit protected target.
    const result = expectTurnFailure(playErmitano(drawn.state, 'p1', 'p2'));

    expect(result.error).toBe('TARGET_PROTECTED');
    expect(result.state).toEqual(before);
  });
});

describe('Card 8 Ermitaño — suppression of the printed action', () => {
  it('does not swap hands when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [ERMITANO_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: ERMITANO_CARD,
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
    playerOf(round, 'p2').hand = [ERMITANO_CARD];
    const actorCard = playerOf(round, 'p1').hand[0];
    const before = snapshotOf(round);

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    // The printed action is not resolved for a defeated player's reveal (rules §6.3).
    const eliminated = playerOf(result.state, 'p2');
    expect(eliminated.discards).toEqual([{ card: ERMITANO_CARD, origin: 'ELIMINATION_REVEAL' }]);
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(result.events.every((event) => event.type !== 'HANDS_SWAPPED')).toBe(true);
    expect(round).toEqual(before);
  });
});
