/**
 * Card 4 — Caparazón Armazón (catalog §4; rules §7; engine spec §§7,10,16,18).
 *
 * Normative design under test:
 * - Caparazón's printed action resolves only for voluntary origin `PLAYED`.
 * - Forced face-up placement (Card 5, `FORCED_PLAY`) suppresses printed actions.
 * - Card 10 Rey Gato keeps its intrinsic trigger for both PLAYED and FORCED_PLAY.
 * - Protection lasts until the beginning of the protected player's next turn and
 *   expires through the existing advance-turn lifecycle.
 * - `PLAYER_PROTECTED` events are public and secret-free.
 */
import {
  canTargetHand,
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

const CAPARAZON_CARD: CardInstance = {
  instanceId: 'caparazon-instance',
  value: 4,
  type: 'CAPARAZON_ARMAZON',
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

/** Deals Caparazón to the actor and completes the normal draw so the card is playable. */
function drawWithCaparazonInHand(round: RoundState, actorId: PlayerId): SuccessfulTurn {
  playerOf(round, actorId).hand = [CAPARAZON_CARD];
  return expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

/** Deals Rey Gato to the actor and completes the normal draw. */
function drawWithReyGatoInHand(round: RoundState, actorId: PlayerId): void {
  playerOf(round, actorId).hand = [REY_GATO_CARD];
  expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
}

describe('Card 4 Caparazón — voluntary play (printed action)', () => {
  it('protects the acting player and emits a secret-free PLAYER_PROTECTED event after CARD_PLAYED', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithCaparazonInHand(round, 'p1');
    const companion = playerOf(drawn.state, 'p1').hand.find(
      (card) => card.instanceId !== CAPARAZON_CARD.instanceId,
    );
    if (!companion) {
      throw new Error('Test fixture expected the actor to draw a companion card');
    }

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );

    expect(playerOf(result.state, 'p1').protected).toBe(true);
    expect(playerOf(result.state, 'p1').eliminated).toBe(false);
    // Card conservation: the played instance moved to the public discard area.
    expect(playerOf(result.state, 'p1').hand).toEqual([companion]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: CAPARAZON_CARD, origin: 'PLAYED' },
    ]);
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CAPARAZON_CARD },
      { type: 'PLAYER_PROTECTED', playerId: 'p1' },
    ]);
  });

  it('emits PLAYER_PROTECTED without leaking private card information', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithCaparazonInHand(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );

    const protectedEvents = result.events.filter((event) => event.type === 'PLAYER_PROTECTED');
    expect(protectedEvents).toEqual([{ type: 'PLAYER_PROTECTED', playerId: 'p1' }]);
    const serializedEvents = JSON.stringify(result.events);
    for (const pileCard of result.state.drawPile) {
      expect(serializedEvents).not.toContain(pileCard.instanceId);
    }
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
  });

  it('ignores a stray targetId and still protects the acting player', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithCaparazonInHand(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
        // A stray targetId on a non-target card is ignored (Milestone 3).
        targetId: 'p2',
      }),
    );

    expect(playerOf(result.state, 'p1').protected).toBe(true);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: CAPARAZON_CARD },
      { type: 'PLAYER_PROTECTED', playerId: 'p1' },
    ]);
  });

  it('does not mutate the input state and returns a non-aliased clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithCaparazonInHand(round, 'p1');
    const before = snapshotOf(drawn.state);

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );

    expect(drawn.state).toEqual(before);
    expect(result.state).not.toBe(drawn.state);
    expect(playerOf(result.state, 'p1')).not.toBe(playerOf(drawn.state, 'p1'));
  });
});

describe('Card 4 Caparazón — forced face-up placement suppresses the printed action', () => {
  it('does not protect the holder when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: CAPARAZON_CARD,
        origin: 'FORCED_PLAY',
      }),
    );

    expect(playerOf(result.state, 'p1').protected).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(result.state).toEqual(before);
    expect(round).toEqual(before);
  });

  it('keeps the elimination-reveal origin out of the effect dispatch entirely', () => {
    // eliminatePlayer never routes through resolveFaceUpCardEffect; this asserts
    // the dispatch contract itself stays origin-honest (rules §6.3).
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p1',
        card: CAPARAZON_CARD,
        origin: 'ELIMINATION_REVEAL',
      }),
    );

    expect(playerOf(result.state, 'p1').protected).toBe(false);
    expect(result.events).toEqual([]);
    expect(round).toEqual(before);
  });
});

describe('Protection lifecycle (rules §7; engine spec §10)', () => {
  it('keeps protection while other players take their turns, then expires it exactly on return', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = drawWithCaparazonInHand(round, 'p1');
    const played = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );
    expect(playerOf(played.state, 'p1').protected).toBe(true);

    // p2's full turn: protection persists — it is not p1's turn yet.
    const p2Draw = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'DRAW_CARD', actorId: 'p2' }),
    );
    // The seeded deal gives p2 the Serpiente Encantadora, which is a
    // target-bearing card. This protection-lifecycle test only needs a plain
    // targetless play, so swap the dealt Serpiente with a deep draw-pile
    // Card 9 (No Soy Una Mascota): nobody here holds Rey Gato, so its printed
    // action fizzles and the play stays plain. Conservation is preserved and
    // every later draw in this test is unchanged (the pile head stays
    // untouched); Card 2 Ratón is deliberately never drawn or played, since
    // its printed action would open a pending interaction and pause the turn.
    const p2DealtCard = playerOf(p2Draw.state, 'p2').hand[0];
    if (p2DealtCard.type === 'SERPIENTE_ENCANTADORA') {
      const deepCard = p2Draw.state.drawPile.find(
        (card, index) => index > 0 && card.type === 'NO_SOY_UNA_MASCOTA',
      );
      if (!deepCard) {
        throw new Error('Test fixture expected a deep Card 9 in the draw pile');
      }
      const deepIndex = p2Draw.state.drawPile.findIndex(
        (card) => card.instanceId === deepCard.instanceId,
      );
      p2Draw.state.drawPile[deepIndex] = p2DealtCard;
      const p2Hand = playerOf(p2Draw.state, 'p2').hand;
      const dealtIndex = p2Hand.findIndex((card) => card.instanceId === p2DealtCard.instanceId);
      p2Hand[dealtIndex] = deepCard;
    }
    const p2Card = playerOf(p2Draw.state, 'p2').hand[0];
    const p2Play = expectTurnSuccess(
      applyTurnCommand(p2Draw.state, {
        type: 'PLAY_CARD',
        actorId: 'p2',
        cardInstanceId: p2Card.instanceId,
      }),
    );
    expect(p2Play.state.currentPlayerId).toBe('p3');
    expect(playerOf(p2Play.state, 'p1').protected).toBe(true);

    // p3's turn starts with a draw; the seeded fixture makes it a Pecera play.
    const p3Draw = expectTurnSuccess(
      applyTurnCommand(p2Play.state, { type: 'DRAW_CARD', actorId: 'p3' }),
    );
    const p3Card = playerOf(p3Draw.state, 'p3').hand[0];
    const p3Play = expectTurnSuccess(
      applyTurnCommand(p3Draw.state, {
        type: 'PLAY_CARD',
        actorId: 'p3',
        cardInstanceId: p3Card.instanceId,
      }),
    );
    expect(p3Play.state.pendingInteraction).toEqual({ type: 'PECERA_TARGET', actorId: 'p3' });
    expect(p3Play.state.currentPlayerId).toBe('p3');
    expect(playerOf(p3Play.state, 'p1').protected).toBe(true);

    // Complete the pending flow: p1 is still protected and therefore an
    // illegal Pecera target (extra protection proof), so p3 must target p2;
    // the guess is deliberately wrong so nothing beyond the turn advance happens.
    const p3Target = expectTurnSuccess(
      applyTurnCommand(p3Play.state, {
        type: 'CHOOSE_TARGET',
        actorId: 'p3',
        targetId: 'p2',
      }),
    );
    expect(p3Target.state.pendingInteraction).toEqual({
      type: 'PECERA_GUESS',
      actorId: 'p3',
      targetId: 'p2',
    });
    expect(playerOf(p3Target.state, 'p1').protected).toBe(true);

    // A deliberately wrong legal guess: any integer 0..10 other than 1 and
    // the target's actual hidden value resolves as incorrect.
    const p2HiddenValue = playerOf(p3Target.state, 'p2').hand[0].value;
    const wrongGuess = p2HiddenValue === 0 ? 2 : p2HiddenValue === 2 ? 3 : 0;
    const p3Guess = expectTurnSuccess(
      applyTurnCommand(p3Target.state, {
        type: 'SUBMIT_GUESS',
        actorId: 'p3',
        value: wrongGuess,
      }),
    );
    // The wrong guess finalizes p3's turn exactly once: protection expires
    // precisely when the turn returns to p1.
    expect(p3Guess.state.currentPlayerId).toBe('p1');
    expect(playerOf(p3Guess.state, 'p1').protected).toBe(false);
    expect(p3Guess.events).toEqual([
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'p3', targetId: 'p2', correct: false },
      { type: 'PROTECTION_EXPIRED', playerId: 'p1' },
    ]);
  });

  it('leaves protection in force without an expiry event when the round ends first', () => {
    const round = createRound(['p1', 'p2']);
    const drawn = drawWithCaparazonInHand(round, 'p1');
    const played = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );

    // p2 self-eliminates by playing Rey Gato: the round ends before p1's next turn.
    drawWithReyGatoInHand(played.state, 'p2');
    const p2Drawn = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'DRAW_CARD', actorId: 'p2' }),
    );
    const result = expectTurnSuccess(
      applyTurnCommand(p2Drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p2',
        cardInstanceId: REY_GATO_CARD.instanceId,
      }),
    );

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(playerOf(result.state, 'p1').protected).toBe(true);
    expect(result.events.some((event) => event.type === 'PROTECTION_EXPIRED')).toBe(false);
  });
});

describe('canTargetHand — canonical protection seam (engine spec §16)', () => {
  it('accepts an active, unprotected, other-player target', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    expect(canTargetHand(round, 'p1', 'p2')).toBe(true);
    expect(canTargetHand(round, 'p1', 'p3')).toBe(true);
  });

  it('rejects an eliminated actor even when the target is valid', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').eliminated = true;

    expect(canTargetHand(round, 'p1', 'p2')).toBe(false);
  });

  it('rejects an unknown actor even when the target is valid', () => {
    const round = createRound(['p1', 'p2', 'p3']);

    expect(canTargetHand(round, 'ghost-actor', 'p2')).toBe(false);
  });

  it('rejects self, eliminated, protected, and unknown targets', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p3').eliminated = true;
    playerOf(round, 'p2').protected = true;

    expect(canTargetHand(round, 'p1', 'p1')).toBe(false);
    expect(canTargetHand(round, 'p1', 'p3')).toBe(false);
    expect(canTargetHand(round, 'p1', 'p2')).toBe(false);
    expect(canTargetHand(round, 'p1', 'ghost-player')).toBe(false);
  });
});

describe('Card 6 Saqueadog regression — protection never blocks the hidden swap', () => {
  it('lets a player act while another player is protected: the swap ignores foreign protection and lets it persist', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    // p1 protects itself through the real Caparazón flow; the turn advances to p2.
    const caparazonPlayed = drawWithCaparazonInHand(round, 'p1');
    const protected_ = expectTurnSuccess(
      applyTurnCommand(caparazonPlayed.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: CAPARAZON_CARD.instanceId,
      }),
    );
    expect(playerOf(protected_.state, 'p1').protected).toBe(true);

    // p2 runs the full Saqueadog flow while p1 is protected: the hidden-card
    // swap is self-directed, so foreign protection is irrelevant to it.
    const saqueadogCard: CardInstance = {
      instanceId: 'saqueadog-instance',
      value: 6,
      type: 'SAQUEADOG_DE_TUMBAS',
    };
    const hiddenCard: CardInstance = {
      instanceId: 'hidden-5-instance',
      value: 5,
      type: 'RATON_TRAMPERO',
    };
    const handCard: CardInstance = {
      instanceId: 'value-3-instance',
      value: 3,
      type: 'RATON_TRAMPERO',
    };
    const swapRound = protected_.state;
    swapRound.hiddenCard = hiddenCard;
    playerOf(swapRound, 'p2').hand = [saqueadogCard];
    const p2Draw = expectTurnSuccess(
      applyTurnCommand(swapRound, { type: 'DRAW_CARD', actorId: 'p2' }),
    );
    playerOf(p2Draw.state, 'p2').hand = [saqueadogCard, handCard];
    const p2Play = expectTurnSuccess(
      applyTurnCommand(p2Draw.state, {
        type: 'PLAY_CARD',
        actorId: 'p2',
        cardInstanceId: saqueadogCard.instanceId,
      }),
    );
    expect(p2Play.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p2' });

    const resolved = expectTurnSuccess(
      applyTurnCommand(p2Play.state, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p2',
        swap: true,
      }),
    );

    // The atomic exchange happened for p2 regardless of p1's protection.
    expect(playerOf(resolved.state, 'p2').hand).toEqual([hiddenCard]);
    expect(resolved.state.hiddenCard).toEqual(handCard);
    expect(resolved.state.pendingInteraction).toBeNull();
    expect(resolved.state.currentPlayerId).toBe('p3');
    // p1's protection persists: it expires only at the beginning of p1's next
    // turn, and the swap decision emits no PROTECTION_EXPIRED event for p1.
    expect(playerOf(resolved.state, 'p1').protected).toBe(true);
    expect(
      resolved.events.some(
        (event) => event.type === 'PROTECTION_EXPIRED' && event.playerId === 'p1',
      ),
    ).toBe(false);
    expect(resolved.events).toEqual([{ type: 'SAQUEADOG_RESOLVED', playerId: 'p2' }]);
  });
});

describe('Card 10 Rey Gato regression after the printed-action/intrinsic split', () => {
  it('still eliminates the holder for FORCED_PLAY as an intrinsic trigger', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p2',
        card: REY_GATO_CARD,
        origin: 'FORCED_PLAY',
      }),
    );

    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(result.eliminatedPlayerId).toBe('p2');
    expect(result.events).toEqual([{ type: 'PLAYER_ELIMINATED', playerId: 'p2' }]);
    expect(round).toEqual(before);
  });

  it('still eliminates the holder for PLAYED as an intrinsic trigger', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = expectEffect(
      resolveFaceUpCardEffect(round, {
        playerId: 'p2',
        card: REY_GATO_CARD,
        origin: 'PLAYED',
      }),
    );

    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(result.eliminatedPlayerId).toBe('p2');
    expect(round).toEqual(before);
  });
});
