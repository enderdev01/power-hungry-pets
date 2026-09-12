/**
 * Card 9 — ¡No soy una mascota! (catalog §9; rules §§6,7,13,14; engine spec
 * §§7,10,13,16,18,21; open questions "Protected Rey Gato holder vs card 9" and
 * "Privacy scope for Milestone 3"; test plan §15).
 *
 * Normative design under test:
 * - The printed action resolves only for voluntary origin `PLAYED`; forced play
 *   (FORCED_PLAY) and elimination reveals suppress it entirely.
 * - On a voluntary play, the engine searches the other active, unprotected
 *   players for the unique Rey Gato held in hand and, when found, exchanges the
 *   acting player's one remaining hand card with that holder's hand through the
 *   centralized pure exchange seam. The card moved into the actor's hand is
 *   never face up, so Rey Gato does not trigger.
 * - No eligible holder (no Rey in any other active unprotected hand), a
 *   protected Rey holder (a protected hand cannot be manipulated), an
 *   eliminated holder, or an actor who already holds Rey Gato all fizzle: the
 *   card is discarded normally and the turn finalizes normally.
 * - No targetId participates and no pending interaction opens: the search is a
 *   server-side decision, never a player decision.
 * - `HANDS_SWAPPED` is public and secret-free: player ids only, no card data,
 *   emitted after the `CARD_PLAYED` event and before any round-end event.
 * - Round-end checks stay centralized: draw-pile exhaustion after the exchange
 *   ends the round through the existing lifecycle.
 */
import {
  eliminatePlayer,
  resolveFaceUpCardEffect,
  createMatchState,
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

const NO_SOY_CARD: CardInstance = {
  instanceId: 'no-soy-instance',
  value: 9,
  type: 'NO_SOY_UNA_MASCOTA',
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

function expectEffect(result: EffectResult): EffectResult {
  if (!result) {
    throw new Error('Expected an effect resolution result');
  }
  return result;
}

/** Deals card 9 to the actor and completes the normal draw so the card is playable. */
function drawWithNoSoyInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [NO_SOY_CARD];
  return expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

/** Plays card 9 from a post-draw state; a stray targetId is always ignored. */
function playNoSoy(state: RoundState, actorId: PlayerId, targetId?: PlayerId): TurnResult {
  return applyTurnCommand(state, {
    type: 'PLAY_CARD',
    actorId,
    cardInstanceId: NO_SOY_CARD.instanceId,
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

describe('Card 9 ¡No soy una mascota! — voluntary play exchanges with the Rey holder', () => {
  it('finds the active Rey holder and exchanges the actor remaining card with their Rey', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    // The Rey moved into the actor's hand; the holder received the actor's card.
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p2').hand).toEqual([actorCard]);
    // Neither holder is eliminated: Rey Gato was never face up.
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    expect(playerOf(result.state, 'p2').eliminated).toBe(false);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: NO_SOY_CARD, origin: 'PLAYED' },
    ]);
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: NO_SOY_CARD },
      { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
    ]);
  });

  it('keeps the exchanged Rey Gato face down in the actor hand with no trigger', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    playerOf(drawn.state, 'p3').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events.some((event) => event.type === 'PLAYER_ELIMINATED')).toBe(false);
  });

  it('emits a public, secret-free HANDS_SWAPPED event containing player ids only', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    const swapEvents = result.events.filter((event) => event.type === 'HANDS_SWAPPED');
    expect(swapEvents).toEqual([{ type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] }]);
    const serializedEvents = JSON.stringify(result.events);
    // The exchanged card identities and every secret pile card stay out of the
    // public event stream (rules §13; open questions privacy scope).
    expect(serializedEvents).not.toContain(REY_GATO_CARD.instanceId);
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
    for (const pileCard of result.state.drawPile) {
      expect(serializedEvents).not.toContain(pileCard.instanceId);
    }
    for (const player of result.state.players) {
      for (const card of player.hand) {
        expect(serializedEvents).not.toContain(card.instanceId);
      }
    }
  });

  it('skips the search when the actor already holds Rey Gato after playing 9', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    // The actor's remaining card is the unique Rey Gato; nobody else can hold it.
    playerOf(drawn.state, 'p1').hand = [NO_SOY_CARD, REY_GATO_CARD];
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    // Rey Gato stays in the actor's hand, face down; nothing else happens.
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: NO_SOY_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual(playerOf(drawn.state, 'p2').hand);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(drawn.state, 'p3').hand);
    // p2 holds no protection, so the normal advance emits no expiry event.
    expect(result.events).toEqual([{ type: 'CARD_PLAYED', playerId: 'p1', card: NO_SOY_CARD }]);
    expect(drawn.state).toEqual(before);
  });
});

describe('Card 9 ¡No soy una mascota! — no eligible holder fizzles', () => {
  it('has no effect when no other active player holds Rey Gato', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    // The card is discarded normally; no exchange happened.
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: NO_SOY_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(result.state, 'p2').hand).toEqual(playerOf(drawn.state, 'p2').hand);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(drawn.state, 'p3').hand);
    // p2 holds no protection, so the normal advance emits no expiry event.
    expect(result.events).toEqual([{ type: 'CARD_PLAYED', playerId: 'p1', card: NO_SOY_CARD }]);
    expect(drawn.state).toEqual(before);
  });

  it('never exchanges with a protected Rey Gato holder — a protected hand cannot be manipulated', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];
    playerOf(drawn.state, 'p2').protected = true;

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    // The protected holder keeps Rey Gato; the actor keeps their own card.
    expect(playerOf(result.state, 'p2').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(result.events.some((event) => event.type === 'HANDS_SWAPPED')).toBe(false);
  });

  it('never exchanges with an eliminated player whose reveal already exposed Rey Gato', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    // p2 was eliminated while holding Rey Gato: the cat now lives in their
    // public reveal, not in an active hand, so no exchange is possible.
    playerOf(drawn.state, 'p2').hand = [];
    playerOf(drawn.state, 'p2').eliminated = true;
    playerOf(drawn.state, 'p2').discards = [{ card: REY_GATO_CARD, origin: 'ELIMINATION_REVEAL' }];

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: REY_GATO_CARD, origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(result.events.some((event) => event.type === 'HANDS_SWAPPED')).toBe(false);
  });
});

describe('Card 9 ¡No soy una mascota! — engine invariants', () => {
  it('takes no targetId and opens no pending interaction — the search is server-side', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];

    // A stray targetId must be ignored: the holder is found by the engine.
    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1', 'p3'));

    expect(result.state.pendingInteraction).toBeNull();
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p2').hand).toEqual([actorCard]);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: NO_SOY_CARD },
      { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
    ]);
  });

  it('does not mutate the input state and returns a non-aliased clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(drawn.state).toEqual(before);
    expect(result.state).not.toBe(drawn.state);
    expect(playerOf(result.state, 'p1')).not.toBe(playerOf(drawn.state, 'p1'));
    expect(playerOf(result.state, 'p2')).not.toBe(playerOf(drawn.state, 'p2'));
  });

  it('conserves every card instance exactly once across the exchange', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];
    const beforeIds = allCardInstanceIds(drawn.state);

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('ends the round on draw-pile exhaustion after the exchange instead of advancing', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithNoSoyInHand(round, 'p1');
    const actorCard = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== NO_SOY_CARD.instanceId,
    );
    if (!actorCard) {
      throw new Error('Test fixture expected the actor hand to hold one remaining card');
    }
    playerOf(drawn.state, 'p2').hand = [REY_GATO_CARD];
    drawn.state.drawPile = [];

    const result = expectTurnSuccess(playNoSoy(drawn.state, 'p1'));

    // The exchange still resolved before the centralized round-end check.
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p2').hand).toEqual([actorCard]);
    expect(result.state.status).toBe('ROUND_END');
    // p1 ends holding the Rey Gato (value 10) and beats every non-Robot survivor.
    expect(result.state.winners).toEqual(['p1']);
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p3Hand) {
      throw new Error('Test fixture expected one hand card for p3');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: NO_SOY_CARD },
      { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: REY_GATO_CARD },
          { playerId: 'p2', card: actorCard },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });
});

describe('Card 9 ¡No soy una mascota! — suppression of the printed action', () => {
  it('fizzles defensively when the actor hand shape is malformed and cannot be swapped', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    // Malformed actor hand: card 9 is still in hand (a play would normally have
    // removed it), leaving an unswappable shape. The state must stay untouched.
    playerOf(round, 'p1').hand = [NO_SOY_CARD, NO_SOY_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: NO_SOY_CARD,
        origin: 'PLAYED',
      }),
    );

    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
  });

  it('skips a multi-card Rey holder defensively and takes no partial exchange', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [NO_SOY_CARD];
    // Malformed holder hand: two cards, one of them the unique Rey. exchangeHands
    // refuses any hand that does not hold exactly one card.
    playerOf(round, 'p2').hand = [REY_GATO_CARD, REY_GATO_CARD];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: NO_SOY_CARD,
        origin: 'PLAYED',
      }),
    );

    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
  });

  it('never searches or exchanges when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [NO_SOY_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: NO_SOY_CARD,
        origin: 'FORCED_PLAY',
      }),
    );

    expect(result.state).toEqual(before);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(playerOf(result.state, 'p2').hand).toEqual([REY_GATO_CARD]);
    expect(round).toEqual(before);
  });

  it('keeps the elimination-reveal origin out of the effect dispatch entirely', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [NO_SOY_CARD];
    const actorCard = playerOf(round, 'p1').hand[0];
    const before = snapshotOf(round);

    const result = eliminatePlayer(round, 'p2');
    if (!result.ok) {
      throw new Error('Expected a successful elimination');
    }

    // The printed action is not resolved for a defeated player's reveal (rules §6.3).
    const eliminated = playerOf(result.state, 'p2');
    expect(eliminated.discards).toEqual([{ card: NO_SOY_CARD, origin: 'ELIMINATION_REVEAL' }]);
    expect(playerOf(result.state, 'p1').hand).toEqual([actorCard]);
    expect(result.events.every((event) => event.type !== 'HANDS_SWAPPED')).toBe(true);
    expect(round).toEqual(before);
  });
});
