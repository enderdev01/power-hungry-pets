/**
 * Milestone 4 — end-of-round winner resolution (rules §§8,9,10; catalog §0;
 * engine spec §12; test plan §§6,18).
 *
 * Normative design under test:
 * - Last-survivor end: immediate sole winner, no hands revealed (rules §8).
 * - Draw-pile exhaustion with 2+ active players: the round ends and every
 *   active survivor's single hand is publicly and simultaneously revealed via
 *   one HANDS_REVEALED event carrying { playerId, card } per survivor. Hands
 *   are legitimate public end-of-round data (rules §9; resolved user decision
 *   for M4); the reveal never moves cards to discards, never touches hidden or
 *   draw-pile state, and always precedes ROUND_ENDED.
 * - Winner algorithm (resolved user decision for Card 0, catalog §0):
 *   1. Every pair of survivors is compared directly. Normal comparison: higher
 *      card value wins the pair; equal values award nobody. Special 0-vs-10
 *      direct matchup: Robot beats Rey Gato, while Robot loses normally to
 *      every other higher card and Rey beats every non-Robot. Pairwise wins
 *      are counted; candidates with the maximal count continue.
 *   2. Tied candidates break the tie by the highest sum of their own pre-reveal
 *      face-up discard values; an exact remaining tie yields multiple round
 *      winners.
 * - Winner computation is pure and based only on pre-reveal state (the reveal
 *   moves no cards, so pre-reveal and post-reveal discard totals coincide).
 * - Card 0 Robot's M4 end-round rule lives entirely in the winner resolver:
 *   no face-up handler is added for Robot (catalog §0 end-of-round passive).
 */
import {
  createMatchState,
  checkRoundEnd,
  eliminatePlayer,
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

const ROBOT_CARD: CardInstance = {
  instanceId: 'robot-instance',
  value: 0,
  type: 'ROBOT_ASPIRADOR_REAL',
};
const REY_GATO_CARD: CardInstance = {
  instanceId: 'rey-gato-instance',
  value: 10,
  type: 'REY_GATO',
};
const NO_SOY_CARD: CardInstance = {
  instanceId: 'no-soy-instance',
  value: 9,
  type: 'NO_SOY_UNA_MASCOTA',
};

function cardOfValue(value: number, instanceId?: string): CardInstance {
  return { instanceId: instanceId ?? `value-${value}-instance`, value, type: 'PECERA_DE_CRISTAL' };
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

function discardSum(round: RoundState, id: PlayerId): number {
  return playerOf(round, id).discards.reduce((total, entry) => total + entry.card.value, 0);
}

interface RevealedHand {
  playerId: PlayerId;
  card: CardInstance;
}

function handsRevealedEvent(hands: RevealedHand[]): {
  type: 'HANDS_REVEALED';
  hands: RevealedHand[];
} {
  return { type: 'HANDS_REVEALED', hands };
}

describe('winner resolution — last survivor (rules §8)', () => {
  it('ends the round immediately with the sole survivor and reveals no hands', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p3').eliminated = true;
    round.drawPile = [];
    const before = snapshotOf(round);

    const result = checkRoundEnd(round);

    expect(result.ended).toBe(true);
    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.events).toEqual([{ type: 'ROUND_ENDED', winnerIds: ['p1'] }]);
    expect(round).toEqual(before);
  });

  it('emits no HANDS_REVEALED when an elimination ends a two-player round as last survivor', () => {
    const round = createRound(['p1', 'p2']);
    round.drawPile = [];

    const result = eliminatePlayer(round, 'p1');
    if (!result.ok) {
      throw new Error('Expected a successful elimination');
    }

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p2']);
    expect(result.events.map((event) => event.type)).toEqual(['PLAYER_ELIMINATED', 'ROUND_ENDED']);
  });
});

describe('winner resolution — pairwise direct-win comparison (rules §9, §10)', () => {
  it('reveals both survivor hands and crowns the pairwise direct winner on exhaustion', () => {
    const round = createRound(['p1', 'p2']);
    playerOf(round, 'p1').hand = [cardOfValue(4, 'four-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(7, 'seven-1-instance')];
    round.drawPile = [];
    const before = snapshotOf(round);

    const result = checkRoundEnd(round);

    expect(result.ended).toBe(true);
    expect(result.state.winners).toEqual(['p2']);
    expect(result.events).toEqual([
      handsRevealedEvent([
        { playerId: 'p1', card: cardOfValue(4, 'four-1-instance') },
        { playerId: 'p2', card: cardOfValue(7, 'seven-1-instance') },
      ]),
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
    // Purity: the input round is untouched — the reveal and winner computation
    // never mutate the caller's state.
    expect(round).toEqual(before);
  });

  it('does not move revealed cards to discards and leaves hidden and draw-pile state untouched', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const hiddenCard = round.hiddenCard;
    playerOf(round, 'p1').hand = [cardOfValue(2, 'two-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(8, 'eight-1-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(5, 'five-1-instance')];
    playerOf(round, 'p1').discards = [{ card: cardOfValue(6, 'six-1-instance'), origin: 'PLAYED' }];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p2']);
    for (const id of ['p1', 'p2', 'p3'] as PlayerId[]) {
      expect(playerOf(result.state, id).hand).toHaveLength(1);
      expect(playerOf(result.state, id).discards).toEqual(playerOf(round, id).discards);
    }
    expect(result.state.hiddenCard).toEqual(hiddenCard);
    expect(result.state.drawPile).toEqual([]);
    expect(discardSum(result.state, 'p1')).toBe(6);
  });

  it('excludes eliminated players from the reveal and from winner candidacy', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p2').hand = [];
    playerOf(round, 'p1').hand = [cardOfValue(3, 'three-1-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(6, 'six-1-instance')];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p3']);
    const events = result.events as unknown as Array<{ type: string; hands?: unknown }>;
    const reveal = events.find((event) => event.type === 'HANDS_REVEALED') as unknown as {
      hands: Array<{ playerId: PlayerId }>;
    };
    expect(reveal.hands.map((hand) => hand.playerId)).toEqual(['p1', 'p3']);
  });
});

describe('winner resolution — pairwise-tied candidates broken by discard totals (rules §10)', () => {
  it('sends pairwise-tied candidates to the discard tie-break and crowns the higher discard sum', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [cardOfValue(7, 'seven-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(7, 'seven-2-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(2, 'two-1-instance')];
    playerOf(round, 'p1').discards = [
      { card: cardOfValue(3, 'three-1-instance'), origin: 'PLAYED' },
    ];
    playerOf(round, 'p2').discards = [
      { card: cardOfValue(5, 'five-1-instance'), origin: 'PLAYED' },
    ];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    // p1 and p2 tie at value 7; p2's discard total 5 beats p1's 3.
    expect(result.state.winners).toEqual(['p2']);
  });

  it('ignores the discard total of a player outside the pairwise-tied candidate set', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [cardOfValue(4, 'four-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(7, 'seven-1-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(7, 'seven-2-instance')];
    // p1 has the huge discard but is not tied on hand value: no participation.
    playerOf(round, 'p1').discards = [
      { card: cardOfValue(9, 'nine-1-instance'), origin: 'PLAYED' },
    ];
    // p2 edges the tied p3 by its own (small) discard sum: p1's 9 is ignored.
    playerOf(round, 'p2').discards = [{ card: cardOfValue(1, 'one-2-instance'), origin: 'PLAYED' }];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p2']);
  });

  it('yields multiple round winners when discard totals are also exactly tied', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [cardOfValue(7, 'seven-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(7, 'seven-2-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(1, 'one-1-instance')];
    playerOf(round, 'p1').discards = [
      { card: cardOfValue(4, 'four-1-instance'), origin: 'PLAYED' },
    ];
    playerOf(round, 'p2').discards = [
      { card: cardOfValue(2, 'two-2-instance'), origin: 'PLAYED' },
      { card: cardOfValue(2, 'two-3-instance'), origin: 'PLAYED' },
    ];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1', 'p2']);
    expect(result.events).toEqual([
      handsRevealedEvent([
        { playerId: 'p1', card: cardOfValue(7, 'seven-1-instance') },
        { playerId: 'p2', card: cardOfValue(7, 'seven-2-instance') },
        { playerId: 'p3', card: cardOfValue(1, 'one-1-instance') },
      ]),
      { type: 'ROUND_ENDED', winnerIds: ['p1', 'p2'] },
    ]);
  });

  it('awards every survivor on an all-equal-value, all-empty-discard exhaustion', () => {
    const round = createRound(['p1', 'p2']);
    playerOf(round, 'p1').hand = [cardOfValue(3, 'three-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(3, 'three-2-instance')];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p1', 'p2']);
  });
});

describe('winner resolution — Robot vs Rey Gato direct matchup (catalog §0)', () => {
  it('gives the Robot holder the pairwise win over the Rey Gato holder in a 2-player end round', () => {
    const round = createRound(['p1', 'p2']);
    playerOf(round, 'p1').hand = [ROBOT_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p1']);
    expect(result.events).toEqual([
      handsRevealedEvent([
        { playerId: 'p1', card: ROBOT_CARD },
        { playerId: 'p2', card: REY_GATO_CARD },
      ]),
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('does not make value 0 globally higher: Robot loses normally to every other higher card', () => {
    const round = createRound(['p1', 'p2']);
    playerOf(round, 'p1').hand = [ROBOT_CARD];
    playerOf(round, 'p2').hand = [cardOfValue(9, 'nine-1-instance')];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p2']);
  });

  it('breaks a 3-player Robot/Rey/middle cycle with the discard tie-break', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    // Robot beats Rey (p1), Rey beats the middle card (p2), the middle card
    // beats Robot (p3): a 3-way cycle, all with 1 pairwise win. The discard
    // tie-break decides: p2 (Rey) has the highest discard sum.
    playerOf(round, 'p1').hand = [ROBOT_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    playerOf(round, 'p3').hand = [cardOfValue(3, 'three-1-instance')];
    playerOf(round, 'p1').discards = [{ card: cardOfValue(1, 'one-1-instance'), origin: 'PLAYED' }];
    playerOf(round, 'p2').discards = [
      { card: cardOfValue(2, 'two-1-instance'), origin: 'PLAYED' },
      { card: cardOfValue(2, 'two-2-instance'), origin: 'PLAYED' },
    ];
    playerOf(round, 'p3').discards = [{ card: cardOfValue(1, 'one-2-instance'), origin: 'PLAYED' }];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p2']);
  });

  it('resolves a 4-player matrix where the Rey holder must not win via the value-10 advantage against Robot', () => {
    const round = createRound(['p1', 'p2', 'p3', 'p4']);
    playerOf(round, 'p1').hand = [ROBOT_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    playerOf(round, 'p3').hand = [cardOfValue(5, 'five-1-instance')];
    playerOf(round, 'p4').hand = [cardOfValue(1, 'one-1-instance')];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    // Pairwise wins: p1 beats p2 (1); p2 beats p3, p4 (2); p3 beats p1, p4 (2);
    // p4 beats p1 (1). Max wins: p2 and p3; discard sums 0 vs 0 tie exactly,
    // so both are round winners.
    expect(result.state.winners).toEqual(['p2', 'p3']);
  });

  it('resolves a 5-player matrix where the Robot holder must not be crowned by value-0 global dominance', () => {
    const round = createRound(['p1', 'p2', 'p3', 'p4', 'p5']);
    playerOf(round, 'p1').hand = [ROBOT_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    playerOf(round, 'p3').hand = [cardOfValue(5, 'five-1-instance')];
    playerOf(round, 'p4').hand = [cardOfValue(5, 'five-2-instance')];
    playerOf(round, 'p5').hand = [cardOfValue(1, 'one-1-instance')];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    // Pairwise wins: p1 beats p2 (1); p2 beats p3, p4, p5 (3); p3 beats p1, p5
    // (2); p4 beats p1, p5 (2); p5 beats p1 (1). Max wins: p2 with 3.
    expect(result.state.winners).toEqual(['p2']);
  });

  it('resolves a 6-player matrix where the Robot/Rey pair ties a middle card and discards decide', () => {
    const round = createRound(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    playerOf(round, 'p1').hand = [ROBOT_CARD];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    playerOf(round, 'p3').hand = [cardOfValue(6, 'six-1-instance')];
    playerOf(round, 'p4').hand = [cardOfValue(5, 'five-1-instance')];
    playerOf(round, 'p5').hand = [cardOfValue(5, 'five-2-instance')];
    playerOf(round, 'p6').hand = [cardOfValue(1, 'one-1-instance')];
    playerOf(round, 'p3').discards = [{ card: cardOfValue(2, 'two-4-instance'), origin: 'PLAYED' }];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    // Pairwise wins: p1 beats p2 (1); p2 beats p3..p6 (4); p3 beats p1, p4, p5,
    // p6 (4); p4/p5 beat p1, p6 (2 each); p6 beats p1 (1). Max wins: p2 and p3
    // with 4 each; p3's discard total 2 beats p2's 0.
    expect(result.state.winners).toEqual(['p3']);
  });
});

describe('winner resolution — event privacy, order, and purity', () => {
  it('emits HANDS_REVEALED exactly once, immediately before ROUND_ENDED, with every survivor once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [cardOfValue(4, 'four-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(9, 'nine-1-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(6, 'six-1-instance')];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    const events = result.events as unknown as Array<{ type: string }>;
    const revealEvents = events.filter((event) => event.type === 'HANDS_REVEALED');
    expect(revealEvents).toHaveLength(1);
    const roundEndedIndex = events.findIndex((event) => event.type === 'ROUND_ENDED');
    const revealIndex = events.findIndex((event) => event.type === 'HANDS_REVEALED');
    expect(revealIndex).toBeGreaterThanOrEqual(0);
    expect(roundEndedIndex).toBe(revealIndex + 1);
    expect(result.state.winners).toEqual(['p2']);
  });

  it('carries full card identities in the reveal because end-of-round hands are public (rules §12)', () => {
    const round = createRound(['p1', 'p2']);
    playerOf(round, 'p1').hand = [cardOfValue(3, 'three-1-instance')];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p2']);
    expect(result.events).toEqual([
      handsRevealedEvent([
        { playerId: 'p1', card: cardOfValue(3, 'three-1-instance') },
        { playerId: 'p2', card: REY_GATO_CARD },
      ]),
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('keeps winner computation pure: pre-reveal discard totals drive the tie-break', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [cardOfValue(6, 'six-1-instance')];
    playerOf(round, 'p2').hand = [cardOfValue(6, 'six-2-instance')];
    playerOf(round, 'p3').hand = [cardOfValue(2, 'two-1-instance')];
    playerOf(round, 'p1').discards = [
      { card: cardOfValue(5, 'five-1-instance'), origin: 'PLAYED' },
    ];
    round.drawPile = [];
    const before = snapshotOf(round);

    const result = checkRoundEnd(round);

    expect(result.state.winners).toEqual(['p1']);
    expect(round).toEqual(before);
    // The reveal moved nothing: post-reveal discards still equal pre-reveal ones.
    expect(playerOf(result.state, 'p1').discards).toEqual(playerOf(round, 'p1').discards);
  });
});

describe('winner resolution — engine integration through the turn engine', () => {
  it('ends the round with a revealed winner through a real exhaustion play', () => {
    const round = createRound(['p1', 'p2']);
    // Seeded fixture: p1 holds value 2, p2 holds value 5, and the only drawable
    // card is the Robot (value 0). p1 draws it and plays the original card.
    const finalCard = round.drawPile[0];
    if (!finalCard || finalCard.type !== 'ROBOT_ASPIRADOR_REAL') {
      throw new Error('Test fixture expected the Robot as the last drawable card');
    }
    round.drawPile = [finalCard];
    const p2Hand = playerOf(round, 'p2').hand[0];
    if (!p2Hand) {
      throw new Error('Test fixture expected p2 to hold one card');
    }

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const playedCard = playerOf(drawn.state, 'p1').hand[0];
    if (!playedCard) {
      throw new Error('Test fixture expected a hand card for player p1');
    }

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: playedCard.instanceId,
      }),
    );

    // p1 ends holding the Robot (value 0) and loses the direct comparison
    // against p2's value 5: Robot beats only Rey Gato.
    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p2']);
    expect(result.events.slice(-2)).toEqual([
      handsRevealedEvent([
        { playerId: 'p1', card: finalCard },
        { playerId: 'p2', card: p2Hand },
      ]),
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('resolves winners after a Card 9 exchange when the pile empties (Rey ends with p1)', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const hiddenCard = round.hiddenCard;
    // Stage the play directly with a companion card and an exhausted pile: the
    // normal draw is impossible, so the deferred round-end check fires on the play.
    playerOf(round, 'p1').hand = [NO_SOY_CARD, cardOfValue(4, 'four-9-instance')];
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    round.drawPile = [];
    round.phase = 'PLAY_REQUIRED';
    const actorCard = cardOfValue(4, 'four-9-instance');

    const result = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: NO_SOY_CARD.instanceId,
      }),
    );

    // The exchange happened (p1 took the Rey Gato from p2), then the round-end
    // check ran: p1's Rey beats every non-Robot survivor hand.
    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(playerOf(result.state, 'p2').hand).toEqual([actorCard]);
    expect(result.state.hiddenCard).toEqual(hiddenCard);
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p3Hand) {
      throw new Error('Test fixture expected p3 to hold one card');
    }
    expect(result.events.slice(-2)).toEqual([
      handsRevealedEvent([
        { playerId: 'p1', card: REY_GATO_CARD },
        { playerId: 'p2', card: actorCard },
        { playerId: 'p3', card: p3Hand },
      ]),
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });
});
