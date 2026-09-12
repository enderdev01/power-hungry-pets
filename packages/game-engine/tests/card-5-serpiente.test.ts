/**
 * Card 5 — Serpiente Encantadora (catalog §5; rules §§6,7,13,14; engine spec
 * §§10,18,21; resolved open question "Serpiente replacement with an empty draw
 * pile").
 *
 * Normative design under test:
 * - The card is a single atomic target decision carried as an optional
 *   `targetId` on `PLAY_CARD`; there is no pending interaction.
 * - Its printed action resolves only for voluntary origin `PLAYED`: it forces
 *   the target's hand card face up into the target's public discard area with
 *   origin `FORCED_PLAY` and emits the public `CARD_FORCED_FACE_UP` event
 *   carrying that now-public card.
 * - The forced card's printed action is suppressed (engine spec §18), while its
 *   intrinsic face-up trigger still applies: a forced Rey Gato eliminates its
 *   holder immediately and no replacement is drawn.
 * - When the forced target survives, they immediately draw a replacement card;
 *   the public `CARD_DRAWN` event is secret-free (target id only).
 * - When the draw pile has no replacement card, the target is eliminated
 *   immediately through the centralized elimination lifecycle. The hidden card
 *   is never used as a replacement.
 * - Targets are classified centrally: `TARGET_PROTECTED` is distinct from
 *   `ILLEGAL_TARGET` and targets are validated before any mutation.
 * - Zero-legal-target fizzle: with no legal opponent, a voluntary play discards
 *   normally and advances the turn; the effect does nothing.
 */
import {
  createMatchState,
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

const SERPIENTE_CARD: CardInstance = {
  instanceId: 'serpiente-instance',
  value: 5,
  type: 'SERPIENTE_ENCANTADORA',
};
const REY_GATO_CARD: CardInstance = {
  instanceId: 'rey-gato-instance',
  value: 10,
  type: 'REY_GATO',
};
const ERMITANO_CARD: CardInstance = {
  instanceId: 'ermitano-instance',
  value: 8,
  type: 'ERMITANO_BUSCA_CASA',
};
const PECERA_CARD: CardInstance = {
  instanceId: 'pecera-instance',
  value: 1,
  type: 'PECERA_DE_CRISTAL',
};
const CAPARAZON_CARD: CardInstance = {
  instanceId: 'caparazon-instance',
  value: 4,
  type: 'CAPARAZON_ARMAZON',
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

/** Deals Serpiente to the actor and completes the normal draw so the card is playable. */
function drawWithSerpienteInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [SERPIENTE_CARD];
  return expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

/** Plays Serpiente from a post-draw state, optionally supplying the atomic target. */
function playSerpiente(state: RoundState, actorId: PlayerId, targetId?: PlayerId): TurnResult {
  return applyTurnCommand(state, {
    type: 'PLAY_CARD',
    actorId,
    cardInstanceId: SERPIENTE_CARD.instanceId,
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

describe('Card 5 Serpiente — voluntary play forces the target hand face up', () => {
  it('moves the target hand card to their discards with FORCED_PLAY and draws the replacement', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const forcedCard = playerOf(drawn.state, 'p2').hand[0];
    const replacementCard = drawn.state.drawPile[0];
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== SERPIENTE_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one card');
    }

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: forcedCard, origin: 'FORCED_PLAY' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual([replacementCard]);
    expect(result.state.drawPile).toEqual(drawn.state.drawPile.slice(1));
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: SERPIENTE_CARD, origin: 'PLAYED' },
    ]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: forcedCard },
      { type: 'CARD_DRAWN', playerId: 'p2' },
    ]);
  });

  it('emits the public CARD_FORCED_FACE_UP event carrying the now-public forced card', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const forcedCard = playerOf(drawn.state, 'p2').hand[0];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    const forcedEvents = result.events.filter((event) => event.type === 'CARD_FORCED_FACE_UP');
    expect(forcedEvents).toEqual([
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: forcedCard },
    ]);
  });

  it('suppresses the printed action of a forced Ermitaño while the replacement still happens', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [ERMITANO_CARD];
    const replacementCard = drawn.state.drawPile[0];
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== SERPIENTE_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one card');
    }

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    // No HANDS_SWAPPED: the forced Ermitaño's printed action never resolved.
    expect(result.events.some((event) => event.type === 'HANDS_SWAPPED')).toBe(false);
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(drawn.state, 'p3').hand);
    // The surviving target still draws their replacement immediately.
    expect(playerOf(result.state, 'p2').hand).toEqual([replacementCard]);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: ERMITANO_CARD },
      { type: 'CARD_DRAWN', playerId: 'p2' },
    ]);
  });

  it('opens no pending interaction for a forced Pecera and protects nothing for a forced Caparazón', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [PECERA_CARD];
    playerOf(drawn.state, 'p3').hand = [CAPARAZON_CARD];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(result.state.pendingInteraction).toBeNull();
    expect(playerOf(result.state, 'p2').protected).toBe(false);
    expect(playerOf(result.state, 'p3').protected).toBe(false);
    expect(result.events.some((event) => event.type === 'PLAYER_PROTECTED')).toBe(false);
  });

  it('is a deliberate no-op when Serpiente itself enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p2',
        card: SERPIENTE_CARD,
        origin: 'FORCED_PLAY',
      }),
    );

    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(round).toEqual(before);
  });
});

describe('Card 5 Serpiente — forced Rey Gato (critical regression)', () => {
  it('eliminates the target immediately, draws no replacement, and advances the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    const target = playerOf(result.state, 'p2');
    expect(target.eliminated).toBe(true);
    expect(target.hand).toEqual([]);
    expect(target.discards).toEqual([{ card: REY_GATO_CARD, origin: 'FORCED_PLAY' }]);
    // No replacement draw for an eliminated target; CARD_DRAWN never fires.
    expect(result.events.some((event) => event.type === 'CARD_DRAWN')).toBe(false);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    ]);
  });

  it('ends the round with the actor as last survivor when the forced Rey Gato empties the table', () => {
    const round = createRound(['p1', 'p2']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });
});

describe('Card 5 Serpiente — empty draw pile eliminates the target (resolved open question)', () => {
  it('eliminates the surviving target immediately instead of drawing a replacement', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    drawn.state.drawPile = [];
    const forcedCard = playerOf(drawn.state, 'p2').hand[0];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    const target = playerOf(result.state, 'p2');
    expect(target.eliminated).toBe(true);
    expect(target.hand).toEqual([]);
    // The forced discard stays public exactly once; the elimination reveal adds
    // nothing because the hand was already empty.
    expect(target.discards).toEqual([{ card: forcedCard, origin: 'FORCED_PLAY' }]);
    // The centralized round-end rule (rules §9) ends the round on draw-pile
    // exhaustion and the M4 winner resolver resolves the remaining survivors.
    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: survivors p1 (value 3 drawn card) and p3 (value 1) — p1 wins.
    expect(result.state.winners).toEqual(['p1']);
    const p1Hand = playerOf(result.state, 'p1').hand[0];
    const p3Hand = playerOf(result.state, 'p3').hand[0];
    if (!p1Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: forcedCard },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: p1Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('never uses the hidden card as the replacement when the draw pile is empty', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const hiddenCard = drawn.state.hiddenCard;
    drawn.state.drawPile = [];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(playerOf(result.state, 'p2').hand).toEqual([]);
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(
      playerOf(result.state, 'p2').discards.some(
        (entry) => entry.card.instanceId === hiddenCard.instanceId,
      ),
    ).toBe(false);
    expect(result.state.hiddenCard).toEqual(hiddenCard);
  });

  it('ends the round with the actor as last survivor on a two-player empty-pile elimination', () => {
    const round = createRound(['p1', 'p2']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    drawn.state.drawPile = [];
    const forcedCard = playerOf(drawn.state, 'p2').hand[0];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: forcedCard },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });
});

describe('Card 5 Serpiente — target validation rejects without mutation', () => {
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
      const drawn = drawWithSerpienteInHand(round, 'p1');
      if (testCase.mutateFixture) {
        testCase.mutateFixture(drawn.state);
      }
      const before = snapshotOf(drawn.state);

      const result = expectTurnFailure(playSerpiente(drawn.state, 'p1', testCase.targetId));

      expect(result.error).toBe(testCase.expectedError);
      expect(result.state).toEqual(before);
      // No partial mutation: hands, discards, turn, and phase are untouched.
      expect(playerOf(result.state, 'p2').discards).toEqual(playerOf(drawn.state, 'p2').discards);
      expect(result.state.currentPlayerId).toBe('p1');
      expect(result.state.phase).toBe('PLAY_REQUIRED');
    });
  }
});

describe('Card 5 Serpiente — zero-legal-target fizzle (no-legal-target rule)', () => {
  it('discards normally with no forced play when every other player is protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== SERPIENTE_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one card');
    }
    playerOf(drawn.state, 'p2').protected = true;
    playerOf(drawn.state, 'p3').protected = true;
    const before = snapshotOf(drawn.state);

    // Mandatory play with zero legal targets: omitted targetId is allowed and
    // the printed effect does nothing.
    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    // The card is discarded normally; no hand was forced face up and the draw
    // pile is untouched.
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: SERPIENTE_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual(playerOf(drawn.state, 'p2').hand);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(drawn.state, 'p3').hand);
    expect(result.state.drawPile).toEqual(drawn.state.drawPile);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p2' },
    ]);
    expect(drawn.state).toEqual(before);
  });

  it('discards normally with no forced play on an eliminated-plus-protected mix', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').eliminated = true;
    playerOf(drawn.state, 'p3').protected = true;

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p3');
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: SERPIENTE_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'PROTECTION_EXPIRED', playerId: 'p3' },
    ]);
  });

  it('still requires targetId when a legal target exists despite other eliminated players', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p3').eliminated = true;
    const before = snapshotOf(drawn.state);

    const result = expectTurnFailure(playSerpiente(drawn.state, 'p1'));

    expect(result.error).toBe('ILLEGAL_TARGET');
    expect(result.state).toEqual(before);
  });

  it('still returns TARGET_PROTECTED for an explicit protected target when others are also protected', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').protected = true;
    playerOf(drawn.state, 'p3').protected = true;
    const before = snapshotOf(drawn.state);

    // Zero legal targets never reclassifies an explicit protected target.
    const result = expectTurnFailure(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(result.error).toBe('TARGET_PROTECTED');
    expect(result.state).toEqual(before);
  });
});

describe('Card 5 Serpiente — round-end and actor lifecycle', () => {
  it('ends the round via draw-pile exhaustion when the replacement consumed the final card', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const forcedCard = playerOf(drawn.state, 'p2').hand[0];
    drawn.state.drawPile = [drawn.state.drawPile[0]];

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    // The replacement drew the last card, so the round ends instead of
    // advancing into an impossible draw (spec §11; rules §9).
    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 keeps value 3, p2 drew the value-4 replacement, p3
    // holds value 1 — p2 wins outright on hand value.
    expect(result.state.winners).toEqual(['p2']);
    const p1Hand = playerOf(result.state, 'p1').hand[0];
    const p2Hand = playerOf(result.state, 'p2').hand[0];
    const p3Hand = playerOf(result.state, 'p3').hand[0];
    if (!p1Hand || !p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: forcedCard },
      { type: 'CARD_DRAWN', playerId: 'p2' },
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

  it('lets the surviving target take a normal next turn after the forced play', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    const next = expectTurnSuccess(
      applyTurnCommand(result.state, { type: 'DRAW_CARD', actorId: 'p2' }),
    );

    expect(next.state.currentPlayerId).toBe('p2');
    expect(next.state.phase).toBe('PLAY_REQUIRED');
    expect(playerOf(next.state, 'p2').hand).toHaveLength(2);
  });

  it('keeps the protected non-target player protected and advances the turn normally', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const forcedCard = playerOf(drawn.state, 'p2').hand[0];
    playerOf(drawn.state, 'p3').protected = true;

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    // p2 survives with a replacement, so the turn advances normally to p2; the
    // protected p3 keeps their protection until their own turn begins (spec §10).
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(playerOf(result.state, 'p3').protected).toBe(true);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: forcedCard },
      { type: 'CARD_DRAWN', playerId: 'p2' },
    ]);
  });

  it('expires the next actor protection when the turn advance reaches a protected player', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    // p2 is eliminated by the forced Rey Gato, so the turn skips to the
    // protected p3 and expires that protection at their turn start (spec §10).
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];
    playerOf(drawn.state, 'p3').protected = true;

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(result.state.currentPlayerId).toBe('p3');
    expect(playerOf(result.state, 'p3').protected).toBe(false);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: SERPIENTE_CARD },
      { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
      { type: 'PROTECTION_EXPIRED', playerId: 'p3' },
    ]);
  });
});

describe('Card 5 Serpiente — privacy, purity, and card conservation', () => {
  it('keeps the public events free of private card identities (replacement, pile, hidden card)', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    const serializedEvents = JSON.stringify(result.events);
    // No card identities or values leak through the public event stream. The
    // forced card is deliberately public (face up in the target's discard area).
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

  it('does not mutate the input state and returns a non-aliased clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(drawn.state).toEqual(before);
    expect(result.state).not.toBe(drawn.state);
    expect(playerOf(result.state, 'p1')).not.toBe(playerOf(drawn.state, 'p1'));
    expect(playerOf(result.state, 'p2')).not.toBe(playerOf(drawn.state, 'p2'));
  });

  it('conserves every card instance exactly once across the forced play', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    const beforeIds = allCardInstanceIds(drawn.state);

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('conserves every card instance exactly once when the target is eliminated', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];
    const beforeIds = allCardInstanceIds(drawn.state);

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('leaves no pending interaction open — Serpiente stays a single atomic decision', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithSerpienteInHand(round, 'p1');

    const result = expectTurnSuccess(playSerpiente(drawn.state, 'p1', 'p2'));

    expect(result.state.pendingInteraction).toBeNull();
  });
});
