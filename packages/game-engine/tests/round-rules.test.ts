import {
  SeededRng,
  checkRoundEnd,
  createMatchState,
  eliminatePlayer,
  setupRound,
  type CardInstance,
  type PlayerId,
  type PlayerState,
  type ReyGatoEliminationContext,
  type RoundState,
} from '../src';
import { applyTurnCommand } from '../src/turn-engine';

type EliminationResult = ReturnType<typeof eliminatePlayer>;
type SuccessfulElimination = Extract<EliminationResult, { ok: true }>;
type TurnResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurn = Extract<TurnResult, { ok: true }>;

const REY_GATO_CARD: CardInstance = {
  instanceId: 'rey-gato-instance',
  value: 10,
  type: 'REY_GATO',
};
const SAQUEADOG_CARD: CardInstance = {
  instanceId: 'saqueadog-instance',
  value: 6,
  type: 'SAQUEADOG_DE_TUMBAS',
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

function expectEliminationSuccess(result: EliminationResult): SuccessfulElimination {
  if (!result.ok) {
    throw new Error(`Expected a successful elimination, got error ${String(result.error)}`);
  }
  return result;
}

function expectTurnSuccess(result: TurnResult): SuccessfulTurn {
  if (!result.ok) {
    throw new Error(`Expected a successful turn command, got error ${String(result.error)}`);
  }
  return result;
}

function allCardInstanceIds(round: RoundState): string[] {
  const cards = [
    ...round.players.flatMap((player) => [
      ...player.hand,
      ...player.discards.map((entry) => entry.card),
    ]),
    ...round.drawPile,
    round.hiddenCard,
  ];
  return cards.map((card) => card.instanceId).sort();
}

describe('eliminatePlayer', () => {
  it('reveals the remaining hand as ELIMINATION_REVEAL discards, clears the hand, and emits only a public event', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);
    const revealedCard = playerOf(round, 'p2').hand[0];
    if (!revealedCard) {
      throw new Error('Test fixture expected a hand card for player p2');
    }

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    const eliminated = playerOf(result.state, 'p2');
    expect(eliminated.eliminated).toBe(true);
    expect(eliminated.hand).toEqual([]);
    expect(eliminated.discards).toEqual([{ card: revealedCard, origin: 'ELIMINATION_REVEAL' }]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([{ type: 'PLAYER_ELIMINATED', playerId: 'p2' }]);
    expect(allCardInstanceIds(result.state)).toEqual(allCardInstanceIds(round));
    expect(result.state.hiddenCard).toEqual(before.hiddenCard);
    expect(round).toEqual(before);
  });

  it('never resolves the printed action of the revealed card', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [SAQUEADOG_CARD];

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.drawPile).toHaveLength(round.drawPile.length);
    expect(result.state.turnOrder).toEqual(round.turnOrder);
    expect(result.state.currentPlayerId).toBe(round.currentPlayerId);
    expect(playerOf(result.state, 'p1').hand).toEqual(playerOf(round, 'p1').hand);
  });

  it('is idempotent for an already eliminated player', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const first = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    const second = expectEliminationSuccess(eliminatePlayer(first.state, 'p2'));

    expect(second.events).toEqual([]);
    expect(second.state).toEqual(first.state);
  });

  it('fails with PLAYER_NOT_FOUND for an unknown player and ROUND_ALREADY_ENDED once the round is over', () => {
    const round = createRound(['p1', 'p2']);

    expect(eliminatePlayer(round, 'ghost')).toMatchObject({ ok: false, error: 'PLAYER_NOT_FOUND' });

    const ended = expectEliminationSuccess(eliminatePlayer(round, 'p1'));
    expect(eliminatePlayer(ended.state, 'p2')).toMatchObject({
      ok: false,
      error: 'ROUND_ALREADY_ENDED',
    });
  });

  it('ends the round immediately with the last survivor as the only winner', () => {
    const round = createRound(['p1', 'p2']);

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p1'));

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p2']);
    expect(result.events).toEqual([
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('advances the turn past an eliminated current actor to the next active player and expires the new actor protection', () => {
    const round = createRound(['p1', 'p2', 'p3', 'p4']);
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p3').protected = true;
    round.phase = 'PLAY_REQUIRED';

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p1'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(playerOf(result.state, 'p3').protected).toBe(false);
    expect(playerOf(result.state, 'p4').protected).toBe(false);
    expect(result.events).toEqual([
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
      { type: 'PROTECTION_EXPIRED', playerId: 'p3' },
    ]);
  });

  it('wraps the turn order when the eliminated current actor is last in order', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.currentPlayerId = 'p3';
    playerOf(round, 'p1').protected = true;

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p3'));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(playerOf(result.state, 'p1').protected).toBe(false);
    expect(result.events).toEqual([
      { type: 'PLAYER_ELIMINATED', playerId: 'p3' },
      { type: 'PROTECTION_EXPIRED', playerId: 'p1' },
    ]);
  });

  it('clears protection from the eliminated player so it belongs only to active players', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').protected = true;
    const before = snapshotOf(round);

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    expect(playerOf(result.state, 'p2').protected).toBe(false);
    // Purity: the input round keeps its own protection flag untouched.
    expect(round).toEqual(before);
  });

  it('runs the Rey Gato intrinsic seam only when the reveal exposes Rey Gato', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p3').hand = [REY_GATO_CARD];
    const contexts: ReyGatoEliminationContext[] = [];
    const intrinsic = (context: ReyGatoEliminationContext): void => {
      contexts.push(context);
    };

    const plain = expectEliminationSuccess(eliminatePlayer(round, 'p3'));
    expect(plain.events).toEqual([{ type: 'PLAYER_ELIMINATED', playerId: 'p3' }]);
    expect(playerOf(plain.state, 'p3').discards).toEqual([
      { card: REY_GATO_CARD, origin: 'ELIMINATION_REVEAL' },
    ]);

    expectEliminationSuccess(eliminatePlayer(round, 'p2', intrinsic));
    expect(contexts).toEqual([]);

    expectEliminationSuccess(eliminatePlayer(round, 'p3', intrinsic));
    expect(contexts).toEqual([
      expect.objectContaining({ eliminatedPlayerId: 'p3', revealedCards: [REY_GATO_CARD] }),
    ]);
  });
});

describe('checkRoundEnd', () => {
  it('keeps the round active while several players remain and the draw pile can still provide a draw', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = checkRoundEnd(round);

    expect(result.ended).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.winners).toEqual([]);
    expect(round).toEqual(before);
  });

  it('resolves the exhaustion winner and reveals all survivor hands when the draw pile is exhausted', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.drawPile = [];
    const before = snapshotOf(round);
    const p1Hand = playerOf(round, 'p1').hand[0];
    const p2Hand = playerOf(round, 'p2').hand[0];
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p1Hand || !p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per player');
    }

    const result = checkRoundEnd(round);

    expect(result.ended).toBe(true);
    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 value 2, p2 value 5, p3 value 1 — p2 wins outright.
    expect(result.state.winners).toEqual(['p2']);
    expect(result.events).toEqual([
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
    expect(round).toEqual(before);
  });

  it('normalizes the phase to DRAW_REQUIRED when the round ends', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.drawPile = [];
    round.phase = 'PLAY_REQUIRED';

    const result = checkRoundEnd(round);

    expect(result.ended).toBe(true);
    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
  });

  it('gives the last survivor precedence over draw pile exhaustion', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p3').eliminated = true;
    round.drawPile = [];

    const result = checkRoundEnd(round);

    expect(result.ended).toBe(true);
    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p1']);
    expect(result.events).toEqual([{ type: 'ROUND_ENDED', winnerIds: ['p1'] }]);
  });
});

describe('round end after a normal play', () => {
  it('ends the round after the play that consumed the final drawable card instead of advancing into an impossible draw', () => {
    const round = createRound(['p1', 'p2']);
    const finalCard = round.drawPile[0];
    if (!finalCard) {
      throw new Error('Test fixture expected a drawable card');
    }
    round.drawPile = [finalCard];
    playerOf(round, 'p2').protected = true;

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

    expect(result.state.status).toBe('ROUND_END');
    // Seeded fixture: p1 ends holding the drawn Robot (value 0) and loses to
    // p2's value 5 — the Robot only beats Rey Gato.
    expect(result.state.winners).toEqual(['p2']);
    expect(result.state.currentPlayerId).toBe('p1');
    expect(playerOf(result.state, 'p2').protected).toBe(true);
    const p2Hand = playerOf(round, 'p2').hand[0];
    if (!p2Hand) {
      throw new Error('Test fixture expected a hand card for player p2');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: playedCard },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: finalCard },
          { playerId: 'p2', card: p2Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('keeps the round active after a draw that empties the pile because the turn still owes a play', () => {
    const round = createRound(['p1', 'p2']);
    const finalCard = round.drawPile[0];
    if (!finalCard) {
      throw new Error('Test fixture expected a drawable card');
    }
    round.drawPile = [finalCard];

    const result = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));

    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.phase).toBe('PLAY_REQUIRED');
    expect(result.state.drawPile).toHaveLength(0);
  });
});
