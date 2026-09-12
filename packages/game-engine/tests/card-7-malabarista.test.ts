/**
 * Card 7 — Malabarista de Ocho Patas (catalog §7; rules §§6,7,9,13; engine spec
 * §§9,10,18,19,21; test plan §13).
 *
 * Normative design under test:
 * - The printed action resolves only for voluntary origin `PLAYED`; a forced
 *   face-up placement or an elimination reveal suppresses it.
 * - Every active player returns exactly one hand card to the draw pile;
 *   eliminated players contribute nothing and receive nothing.
 * - The played Malabarista stays face up in the actor's discard area; prior
 *   discards and the hidden card stay outside the shuffle.
 * - The reconstructed pile (returned hands + current draw pile) is shuffled
 *   with an explicitly injected `Rng` — never `Math.random`.
 * - One card is dealt to each active player in stable turn order and the
 *   remainder stays as the draw pile.
 * - Protection flags are preserved by the redeal (global reset, not targeting;
 *   open questions "Malabarista and protection").
 * - A secret-free `HANDS_REDEALT { playerIds }` event is emitted.
 * - Playing Card 7 without the required RNG is rejected before any mutation
 *   with a typed error; non-random cards remain callable without an RNG.
 */
import {
  createMatchState,
  resolveFaceUpCardEffect,
  SeededRng,
  setupRound,
  type CardInstance,
  type PlayCardCommand,
  type PlayerId,
  type PlayerState,
  type RoundState,
  type Rng,
} from '../src';
import { applyTurnCommand } from '../src/turn-engine';

type TurnResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurn = Extract<TurnResult, { ok: true }>;
type EffectResult = ReturnType<typeof resolveFaceUpCardEffect>;

const MALABARISTA_CARD: CardInstance = {
  instanceId: 'malabarista-instance',
  value: 7,
  type: 'MALABARISTA_DE_OCHO_PATAS',
};
const CAPARAZON_CARD: CardInstance = {
  instanceId: 'caparazon-instance',
  value: 4,
  type: 'CAPARAZON_ARMAZON',
};

/**
 * Deterministic fixture (SeededRng(4242) setup): p2 holds card-5-1, p3 holds
 * card-1-1, the hidden card is card-0-1, and the draw-pile head is card-3-2.
 * Replacing p1's hand with the played Malabarista drops p1's seeded card-2-1
 * from the fixture, matching the established card-test convention.
 */
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

function expectEffect(result: EffectResult): EffectResult {
  if (!result) {
    throw new Error('Expected an effect resolution result');
  }
  return result;
}

/** Deals Malabarista to the actor and completes the normal draw so the card is playable. */
function drawWithMalabaristaInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [MALABARISTA_CARD];
  return expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

/**
 * Plays Malabarista from a post-draw state, optionally supplying the injected
 * RNG through the engine-owned third dependency argument.
 */
function playMalabarista(state: RoundState, actorId: PlayerId, rng?: Rng): TurnResult {
  return applyTurnCommand(
    state,
    {
      type: 'PLAY_CARD',
      actorId,
      cardInstanceId: MALABARISTA_CARD.instanceId,
    },
    rng === undefined ? undefined : { rng },
  );
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

describe('Card 7 Malabarista — voluntary play reshuffles and redeals', () => {
  it('returns every active hand, reshuffles with the injected RNG, and deals one card per active player in turn order', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    // Deterministic expected deal (stable turn order p1, p2, p3), computed from
    // the seeded fixture: returned hands [card-3-2, card-5-1, card-1-1] plus the
    // 16-card draw pile are shuffled by SeededRng(4242).
    expect(playerOf(result.state, 'p1').hand).toEqual([
      { instanceId: 'card-6-1', value: 6, type: 'SAQUEADOG_DE_TUMBAS' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual([
      { instanceId: 'card-3-2', value: 3, type: 'CONEJITO_GUERRILLERO' },
    ]);
    expect(playerOf(result.state, 'p3').hand).toEqual([
      { instanceId: 'card-1-1', value: 1, type: 'PECERA_DE_CRISTAL' },
    ]);
    expect(result.state.drawPile.map((card) => card.instanceId)).toEqual([
      'card-10-1',
      'card-5-1',
      'card-2-2',
      'card-9-1',
      'card-7-1',
      'card-4-2',
      'card-1-5',
      'card-1-3',
      'card-1-4',
      'card-4-1',
      'card-1-2',
      'card-3-3',
      'card-2-3',
      'card-3-1',
      'card-8-1',
      'card-5-2',
    ]);
    expect(result.state.drawPile).toHaveLength(16);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    // Regression (Card 2): the redeal never routes through the card-effect
    // dispatch, so it must not open a pending interaction even when the
    // redealt hands include Ratón Trampero cards.
    expect(result.state.pendingInteraction).toBeNull();
  });

  it('keeps the played Malabarista in the actor discard area with origin PLAYED', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: MALABARISTA_CARD, origin: 'PLAYED' },
    ]);
    // The played card never re-enters any hand or the draw pile.
    for (const player of result.state.players) {
      expect(player.hand.some((card) => card.instanceId === MALABARISTA_CARD.instanceId)).toBe(
        false,
      );
    }
    expect(
      result.state.drawPile.some((card) => card.instanceId === MALABARISTA_CARD.instanceId),
    ).toBe(false);
  });

  it('emits CARD_PLAYED and the secret-free HANDS_REDEALT event with active player ids in deal order', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: MALABARISTA_CARD },
      { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] },
    ]);
  });

  it('produces identical hands and draw pile for two runs with the same seed', () => {
    const roundA = createRound(['p1', 'p2', 'p3']);
    const roundB = createRound(['p1', 'p2', 'p3']);
    const drawnA = drawWithMalabaristaInHand(roundA, 'p1');
    const drawnB = drawWithMalabaristaInHand(roundB, 'p1');

    const resultA = expectTurnSuccess(playMalabarista(drawnA.state, 'p1', new SeededRng(4242)));
    const resultB = expectTurnSuccess(playMalabarista(drawnB.state, 'p1', new SeededRng(4242)));

    expect(resultA.state.players.map((player) => player.hand)).toEqual(
      resultB.state.players.map((player) => player.hand),
    );
    expect(resultA.state.drawPile).toEqual(resultB.state.drawPile);
  });

  it('produces different deals for different seeds', () => {
    const roundA = createRound(['p1', 'p2', 'p3']);
    const roundB = createRound(['p1', 'p2', 'p3']);
    const drawnA = drawWithMalabaristaInHand(roundA, 'p1');
    const drawnB = drawWithMalabaristaInHand(roundB, 'p1');

    const resultA = expectTurnSuccess(playMalabarista(drawnA.state, 'p1', new SeededRng(4242)));
    const resultB = expectTurnSuccess(playMalabarista(drawnB.state, 'p1', new SeededRng(7)));

    expect(resultA.state.players.map((player) => player.hand)).not.toEqual(
      resultB.state.players.map((player) => player.hand),
    );
    expect(resultA.state.drawPile).not.toEqual(resultB.state.drawPile);
  });

  it('applies the hand-verifiable scripted Fisher–Yates permutation for a fixed RNG', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    // A fixed 0.5 stream drives randomInt to floor(0.5 * (i + 1)); the
    // resulting 19-card permutation is hand-computable Fisher–Yates.
    const fixedRng: Rng = { next: () => 0.5 };

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', fixedRng));

    expect(playerOf(result.state, 'p1').hand.map((card) => card.instanceId)).toEqual(['card-3-2']);
    expect(playerOf(result.state, 'p2').hand.map((card) => card.instanceId)).toEqual(['card-1-5']);
    expect(playerOf(result.state, 'p3').hand.map((card) => card.instanceId)).toEqual(['card-5-1']);
    expect(result.state.drawPile.slice(0, 3).map((card) => card.instanceId)).toEqual([
      'card-1-4',
      'card-1-1',
      'card-9-1',
    ]);
  });
});

describe('Card 7 Malabarista — active, eliminated, and protected players', () => {
  it('collects nothing from and deals nothing to eliminated players', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    playerOf(drawn.state, 'p3').eliminated = true;
    // A real elimination clears the hand and reveals it face up; mimic both so
    // the fixture reflects the canonical eliminated state.
    playerOf(drawn.state, 'p3').hand = [];
    // A prior discard of the eliminated player must stay outside the shuffle.
    playerOf(drawn.state, 'p3').discards.push({
      card: { instanceId: 'card-9-1', value: 9, type: 'NO_SOY_UNA_MASCOTA' },
      origin: 'ELIMINATION_REVEAL',
    });

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    // Deterministic 18-card collect (p1 hand + p2 hand + 16 pile cards).
    expect(playerOf(result.state, 'p1').hand.map((card) => card.instanceId)).toEqual(['card-3-2']);
    expect(playerOf(result.state, 'p2').hand.map((card) => card.instanceId)).toEqual(['card-6-1']);
    expect(playerOf(result.state, 'p3').hand).toEqual([]);
    expect(result.state.drawPile).toHaveLength(16);
    expect(result.state.drawPile.slice(0, 2).map((card) => card.instanceId)).toEqual([
      'card-4-1',
      'card-5-1',
    ]);
    expect(result.events.filter((event) => event.type === 'HANDS_REDEALT')).toEqual([
      { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2'] },
    ]);
  });

  it('includes protected active players in the global reset without clearing their protection during the redeal', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    playerOf(drawn.state, 'p2').protected = true;

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    // Protected p2 returned a hand and received a new one (global reset rule).
    expect(playerOf(result.state, 'p2').hand).toEqual([
      { instanceId: 'card-3-2', value: 3, type: 'CONEJITO_GUERRILLERO' },
    ]);
    expect(result.events.filter((event) => event.type === 'HANDS_REDEALT')).toEqual([
      { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] },
    ]);
    // Protection expires only through the normal turn advance, never the redeal.
    expect(result.events).toContainEqual({ type: 'PROTECTION_EXPIRED', playerId: 'p2' });
  });

  it('leaves every protection flag untouched in the effect state itself (direct dispatch)', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [
      { instanceId: 'card-3-2', value: 3, type: 'CONEJITO_GUERRILLERO' },
    ];
    playerOf(round, 'p2').hand = [
      { instanceId: 'card-5-1', value: 5, type: 'SERPIENTE_ENCANTADORA' },
    ];
    playerOf(round, 'p3').hand = [{ instanceId: 'card-1-1', value: 1, type: 'PECERA_DE_CRISTAL' }];
    playerOf(round, 'p2').protected = true;
    playerOf(round, 'p3').protected = true;
    const beforeHands = JSON.stringify(round.players.map((player) => player.hand));

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: MALABARISTA_CARD,
        origin: 'PLAYED',
        rng: { next: () => 0.5 },
      }),
    );

    // Hands were reset and redealt, but protected flags survived the redeal.
    expect(JSON.stringify(result.state.players.map((player) => player.hand))).not.toBe(beforeHands);
    expect(playerOf(result.state, 'p2').protected).toBe(true);
    expect(playerOf(result.state, 'p3').protected).toBe(true);
    expect(result.events).toEqual([{ type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] }]);
    expect(result.eliminatedPlayerId).toBeNull();
  });
});

describe('Card 7 Malabarista — hidden card, discards, and privacy', () => {
  it('keeps the hidden card and every prior discard outside the shuffle', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    const hiddenBefore = drawn.state.hiddenCard;
    const discardsBefore = JSON.parse(
      JSON.stringify(drawn.state.players.map((player) => player.discards)),
    ) as RoundState['players'][number]['discards'][];

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    expect(result.state.hiddenCard).toEqual(hiddenBefore);
    // The hidden card stays outside the redeal shuffle.
    expect(result.state.drawPile.some((card) => card.instanceId === hiddenBefore.instanceId)).toBe(
      false,
    );
    // Prior discards are untouched; only the played Malabarista entry was added.
    expect(playerOf(result.state, 'p1').discards).toEqual([
      ...discardsBefore[0],
      { card: MALABARISTA_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').discards).toEqual(discardsBefore[1]);
    expect(playerOf(result.state, 'p3').discards).toEqual(discardsBefore[2]);
  });

  it('emits no private card identities or values beyond the public played card', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    const serializedEvents = JSON.stringify(result.events);
    // No post-redeal hand, draw pile, or hidden card identity may leak.
    for (const card of result.state.drawPile) {
      expect(serializedEvents).not.toContain(card.instanceId);
    }
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
    for (const player of result.state.players) {
      for (const card of player.hand) {
        expect(serializedEvents).not.toContain(card.instanceId);
      }
    }
    expect(result.events.filter((event) => event.type === 'HANDS_REDEALT')).toEqual([
      { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] },
    ]);
  });
});

describe('Card 7 Malabarista — empty draw pile and round end', () => {
  it('deals the exact remaining cards, leaves the pile empty, and ends the round by exhaustion', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    drawn.state.drawPile = [];

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    // Catalog edge: returned hands (3) exactly cover the active players; all are
    // dealt and the draw pile is left empty, ending the round (rules §9).
    expect(playerOf(result.state, 'p1').hand.map((card) => card.instanceId)).toEqual(['card-1-1']);
    expect(playerOf(result.state, 'p2').hand.map((card) => card.instanceId)).toEqual(['card-3-2']);
    expect(playerOf(result.state, 'p3').hand.map((card) => card.instanceId)).toEqual(['card-5-1']);
    expect(result.state.drawPile).toEqual([]);
    expect(result.state.status).toBe('ROUND_END');
    // Redealt hands: p1 value 1, p2 value 3, p3 value 5 — p3 wins outright.
    expect(result.state.winners).toEqual(['p3']);
    const p1Hand = playerOf(result.state, 'p1').hand[0];
    const p2Hand = playerOf(result.state, 'p2').hand[0];
    const p3Hand = playerOf(result.state, 'p3').hand[0];
    if (!p1Hand || !p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one dealt hand card per player');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: MALABARISTA_CARD },
      { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: p1Hand },
          { playerId: 'p2', card: p2Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p3'] },
    ]);
  });
});

describe('Card 7 Malabarista — purity and card conservation', () => {
  it('does not mutate the input state and returns a non-aliased clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    expect(drawn.state).toEqual(before);
    expect(result.state).not.toBe(drawn.state);
    expect(playerOf(result.state, 'p1')).not.toBe(playerOf(drawn.state, 'p1'));
  });

  it('conserves every card instance exactly once across the reset and redeal', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    const beforeIds = allCardInstanceIds(drawn.state);

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('leaves no pending interaction open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');

    const result = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    expect(result.state.pendingInteraction).toBeNull();
  });
});

describe('Card 7 Malabarista — missing required RNG', () => {
  it('rejects a voluntary play without RNG before any mutation', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    const before = snapshotOf(drawn.state);

    const result = expectTurnFailure(playMalabarista(drawn.state, 'p1'));

    expect(result.error).toBe('MISSING_RNG');
    expect(result.state).toEqual(before);
    // Nothing mutated: no discard, no redeal, no turn advance.
    expect(playerOf(result.state, 'p1').discards).toEqual([]);
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('PLAY_REQUIRED');
  });

  it('reports a typed MISSING_RNG error from the direct dispatch without mutation', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [
      { instanceId: 'card-3-2', value: 3, type: 'CONEJITO_GUERRILLERO' },
    ];
    playerOf(round, 'p2').hand = [
      { instanceId: 'card-5-1', value: 5, type: 'SERPIENTE_ENCANTADORA' },
    ];
    playerOf(round, 'p3').hand = [{ instanceId: 'card-1-1', value: 1, type: 'PECERA_DE_CRISTAL' }];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: MALABARISTA_CARD,
        origin: 'PLAYED',
      }),
    );

    expect(result.errorCode).toBe('MISSING_RNG');
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(result.state).toEqual(before);
  });
});

describe('Card 7 Malabarista — suppression of the printed action', () => {
  it('does nothing on a FORCED_PLAY origin even when an RNG is supplied', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [
      { instanceId: 'card-3-2', value: 3, type: 'CONEJITO_GUERRILLERO' },
    ];
    playerOf(round, 'p2').hand = [
      { instanceId: 'card-5-1', value: 5, type: 'SERPIENTE_ENCANTADORA' },
    ];
    playerOf(round, 'p3').hand = [{ instanceId: 'card-1-1', value: 1, type: 'PECERA_DE_CRISTAL' }];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: MALABARISTA_CARD,
        origin: 'FORCED_PLAY',
        rng: new SeededRng(4242),
      }),
    );

    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(result.errorCode).toBeUndefined();
  });
});

describe('Regression — the RNG is engine-owned and never command state', () => {
  it('keeps rng out of the serializable PLAY_CARD command shape', () => {
    const command: PlayCardCommand = {
      type: 'PLAY_CARD',
      actorId: 'p1',
      cardInstanceId: MALABARISTA_CARD.instanceId,
    };

    // A command is plain client data: its serialized form can never embed an
    // rng field, so clients cannot control randomness through command state.
    expect(JSON.stringify(command)).not.toContain('"rng"');

    // Compile-time proof: the serializable command type rejects an rng field.
    const strayAttempt: PlayCardCommand = {
      type: 'PLAY_CARD',
      actorId: 'p1',
      cardInstanceId: MALABARISTA_CARD.instanceId,
      // @ts-expect-error rng must not exist on the serializable command type
      rng: new SeededRng(4242),
    };
    void strayAttempt;
  });

  it('ignores a stray command-supplied rng field in favor of the engine rng', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithMalabaristaInHand(round, 'p1');
    const expected = expectTurnSuccess(playMalabarista(drawn.state, 'p1', new SeededRng(4242)));

    const roundB = createRound(['p1', 'p2', 'p3']);
    const drawnB = drawWithMalabaristaInHand(roundB, 'p1');
    const base: PlayCardCommand = {
      type: 'PLAY_CARD',
      actorId: 'p1',
      cardInstanceId: MALABARISTA_CARD.instanceId,
    };
    const stray = { ...base, rng: new SeededRng(7) } as PlayCardCommand;

    const result = expectTurnSuccess(
      applyTurnCommand(drawnB.state, stray, { rng: new SeededRng(4242) }),
    );

    // The stray command rng cannot influence the deterministic redeal: only the
    // engine-owned dependency parameter is ever consulted.
    expect(result.state.players.map((player) => player.hand)).toEqual(
      expected.state.players.map((player) => player.hand),
    );
    expect(result.state.drawPile).toEqual(expected.state.drawPile);
    expect(result.events).toEqual(expected.events);
  });
});

describe('Regression — non-random cards remain callable without an injected RNG', () => {
  it('plays Caparazón Armazón through the engine with no rng field', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [CAPARAZON_CARD];
    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );

    expect(result.events).toContainEqual({ type: 'PLAYER_PROTECTED', playerId: 'p1' });
    expect(playerOf(result.state, 'p1').protected).toBe(true);
    expect(result.state.currentPlayerId).toBe('p2');
  });

  it('resolves Caparazón through the direct dispatch with no rng field', () => {
    const round = createRound(['p1', 'p2', 'p3']);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: CAPARAZON_CARD,
        origin: 'PLAYED',
      }),
    );

    expect(result.errorCode).toBeUndefined();
    expect(result.events).toEqual([{ type: 'PLAYER_PROTECTED', playerId: 'p1' }]);
  });
});
