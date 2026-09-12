import {
  SeededRng,
  createMatchState,
  eliminatePlayer,
  setupRound,
  type CardInstance,
  type FirstPlayerPolicy,
  type PlayerId,
  type PlayerState,
  type RoundState,
} from '../src';
import { applyTurnCommand } from '../src/turn-engine';

type TurnCommandResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurnResult = Extract<TurnCommandResult, { ok: true }>;

const firstListedPlayer: FirstPlayerPolicy = ({ playerIds }) => playerIds[0];
const lastListedPlayer: FirstPlayerPolicy = ({ playerIds }) => playerIds[playerIds.length - 1];

function createRound(
  playerIds: PlayerId[],
  firstPlayer: FirstPlayerPolicy = firstListedPlayer,
): RoundState {
  const match = createMatchState({
    matchId: `match-${playerIds.join('-')}`,
    players: playerIds.map((id) => ({ id, name: id })),
  });
  return setupRound(match, new SeededRng(4242), firstPlayer);
}

function playerOf(round: RoundState, id: PlayerId): PlayerState {
  const player = round.players.find((candidate) => candidate.id === id);
  if (!player) {
    throw new Error(`Test fixture is missing player ${id}`);
  }
  return player;
}

function handCardOf(round: RoundState, id: PlayerId, index = 0): CardInstance {
  const card = playerOf(round, id).hand[index];
  if (!card) {
    throw new Error(`Test fixture expected a hand card for player ${id}`);
  }
  return card;
}

/**
 * Plain targetless stand-in for base draw/play lifecycle tests. The seeded deal
 * with `SeededRng(4242)` puts the dealt Ratón Trampero (card-2-1) in the first
 * player's hand; after Card 2 shipped, playing it opens a pending reinsertion
 * decision, so these tests replace it with a plain card and exercise plain
 * mechanics only.
 */
const PLAIN_CARD: CardInstance = {
  instanceId: 'plain-card-instance',
  value: 0,
  type: 'ROBOT_ASPIRADOR_REAL',
};

function snapshotOf(round: RoundState): RoundState {
  return JSON.parse(JSON.stringify(round)) as RoundState;
}

function expectSuccess(result: TurnCommandResult): SuccessfulTurnResult {
  if (!result.ok) {
    throw new Error(`Expected a successful command result, got error ${String(result.error)}`);
  }
  return result;
}

describe('applyTurnCommand base draw/play lifecycle', () => {
  it('draw transitions DRAW_REQUIRED to PLAY_REQUIRED with two hand cards and a public-safe CARD_DRAWN event', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);
    const dealtCard = handCardOf(round, 'p1');

    const result = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));

    expect(result.state.phase).toBe('PLAY_REQUIRED');
    expect(result.state.currentPlayerId).toBe('p1');
    expect(playerOf(result.state, 'p1').hand).toHaveLength(2);
    expect(result.state.drawPile).toHaveLength(before.drawPile.length - 1);

    const drawnCard = playerOf(result.state, 'p1').hand.find(
      (card) => card.instanceId !== dealtCard.instanceId,
    );
    if (!drawnCard) {
      throw new Error('Expected the actor to receive a second hand card');
    }
    expect(result.state.drawPile.map((card) => card.instanceId)).not.toContain(
      drawnCard.instanceId,
    );

    const drawnEvents = result.events.filter((event) => event.type === 'CARD_DRAWN');
    expect(drawnEvents).toHaveLength(1);
    expect(drawnEvents).toEqual([expect.objectContaining({ type: 'CARD_DRAWN', playerId: 'p1' })]);
    expect(JSON.stringify(result.events)).not.toContain(drawnCard.instanceId);
    expect(JSON.stringify(result.events)).not.toContain(`"value":${drawnCard.value}`);
  });

  it('play discards with origin PLAYED, leaves one hand card, and advances the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    // The seeded deal gives p1 the Ratón Trampero, whose printed action now
    // opens a pending decision; this base lifecycle test plays a plain card.
    playerOf(round, 'p1').hand = [PLAIN_CARD];
    const drawn = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const playedCard = handCardOf(drawn.state, 'p1');

    const result = expectSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: playedCard.instanceId,
      }),
    );

    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.state.currentPlayerId).toBe('p2');
    const actor = playerOf(result.state, 'p1');
    expect(actor.hand).toHaveLength(1);
    expect(actor.hand.map((card) => card.instanceId)).not.toContain(playedCard.instanceId);
    expect(actor.discards).toEqual([{ card: playedCard, origin: 'PLAYED' }]);
  });

  it('play wraps the turn order back to the first player', () => {
    const round = createRound(['p1', 'p2'], lastListedPlayer);
    // The seeded deal gives p2 the Serpiente Encantadora; this base lifecycle
    // test plays a plain card instead of a target-bearing one.
    playerOf(round, 'p2').hand = [PLAIN_CARD];
    const drawn = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p2' }));
    const playedCard = handCardOf(drawn.state, 'p2');

    const result = expectSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p2',
        cardInstanceId: playedCard.instanceId,
      }),
    );

    expect(result.state.currentPlayerId).toBe('p1');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
  });

  it('play skips an eliminated player and expires the next actor protection', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').eliminated = true;
    playerOf(round, 'p3').protected = true;
    // The seeded deal gives p1 the Ratón Trampero; play a plain card instead.
    playerOf(round, 'p1').hand = [PLAIN_CARD];
    const drawn = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const playedCard = handCardOf(drawn.state, 'p1');

    const result = expectSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: playedCard.instanceId,
      }),
    );

    expect(result.state.currentPlayerId).toBe('p3');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(playerOf(result.state, 'p3').protected).toBe(false);
  });

  it('lets the next active player draw after the current actor is eliminated mid-round', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const elimination = eliminatePlayer(round, 'p1');
    if (!elimination.ok) {
      throw new Error('Test fixture expected a successful elimination');
    }

    const result = expectSuccess(
      applyTurnCommand(elimination.state, { type: 'DRAW_CARD', actorId: 'p2' }),
    );

    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('PLAY_REQUIRED');
    expect(playerOf(result.state, 'p2').hand).toHaveLength(2);
  });

  it('rejects a command from the wrong actor and leaves state structurally unchanged', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p2' });

    expect(result).toMatchObject({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(result.state).toEqual(before);
    expect(round).toEqual(before);
  });

  it('rejects a draw while a play is required', () => {
    const round = createRound(['p1', 'p2']);
    const drawn = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const before = snapshotOf(drawn.state);

    const result = applyTurnCommand(drawn.state, { type: 'DRAW_CARD', actorId: 'p1' });

    expect(result).toMatchObject({ ok: false, error: 'UNEXPECTED_COMMAND' });
    expect(result.state).toEqual(before);
    expect(drawn.state).toEqual(before);
  });

  it('rejects a play while a draw is required', () => {
    const round = createRound(['p1', 'p2']);
    const handCard = handCardOf(round, 'p1');
    const before = snapshotOf(round);

    const result = applyTurnCommand(round, {
      type: 'PLAY_CARD',
      actorId: 'p1',
      cardInstanceId: handCard.instanceId,
    });

    expect(result).toMatchObject({ ok: false, error: 'UNEXPECTED_COMMAND' });
    expect(result.state).toEqual(before);
    expect(round).toEqual(before);
  });

  it('rejects a play for a card that is not in the actor hand', () => {
    const round = createRound(['p1', 'p2']);
    const drawn = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const before = snapshotOf(drawn.state);

    const result = applyTurnCommand(drawn.state, {
      type: 'PLAY_CARD',
      actorId: 'p1',
      cardInstanceId: 'card-not-in-hand',
    });

    expect(result).toMatchObject({ ok: false, error: 'CARD_NOT_IN_HAND' });
    expect(result.state).toEqual(before);
    expect(drawn.state).toEqual(before);
  });

  it('rejects turn commands while a pending interaction is open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.pendingInteraction = { type: 'PECERA_TARGET', actorId: 'p1' };
    const before = snapshotOf(round);

    const result = applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' });

    expect(result).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(result.state).toEqual(before);
    expect(round).toEqual(before);
  });

  it('rejects decision commands while a pending interaction is open but not at the matching stage', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.pendingInteraction = { type: 'PECERA_GUESS', actorId: 'p1', targetId: 'p2' };
    const before = snapshotOf(round);

    // A guess is owed: a target choice cannot bypass or restart the pending flow.
    const choose = applyTurnCommand(round, {
      type: 'CHOOSE_TARGET',
      actorId: 'p1',
      targetId: 'p3',
    });
    expect(choose).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(choose.state).toEqual(before);

    // Normal turn commands stay rejected for any pending stage.
    const play = applyTurnCommand(round, {
      type: 'PLAY_CARD',
      actorId: 'p1',
      cardInstanceId: handCardOf(round, 'p1').instanceId,
    });
    expect(play).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(play.state).toEqual(before);
    expect(round).toEqual(before);
  });

  it('rejects CHOOSE_TARGET, SUBMIT_GUESS, CHOOSE_HIDDEN_SWAP, and CHOOSE_DECK_POSITION when no pending interaction is open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const drawn = expectSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const before = snapshotOf(drawn.state);

    const choose = applyTurnCommand(drawn.state, {
      type: 'CHOOSE_TARGET',
      actorId: 'p1',
      targetId: 'p2',
    });
    expect(choose).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(choose.state).toEqual(before);

    const guess = applyTurnCommand(drawn.state, {
      type: 'SUBMIT_GUESS',
      actorId: 'p1',
      value: 5,
    });
    expect(guess).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(guess.state).toEqual(before);

    // Card 6 decision without an open SAQUEADOG_SWAP stage (regression).
    const hiddenSwap = applyTurnCommand(drawn.state, {
      type: 'CHOOSE_HIDDEN_SWAP',
      actorId: 'p1',
      swap: true,
    });
    expect(hiddenSwap).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(hiddenSwap.state).toEqual(before);

    // Card 2 decision without an open RATON_INSERT_POSITION stage (regression).
    const deckPosition = applyTurnCommand(drawn.state, {
      type: 'CHOOSE_DECK_POSITION',
      actorId: 'p1',
      index: 0,
    });
    expect(deckPosition).toMatchObject({ ok: false, error: 'PENDING_DECISION_REQUIRED' });
    expect(deckPosition.state).toEqual(before);
    expect(drawn.state).toEqual(before);
  });
});
