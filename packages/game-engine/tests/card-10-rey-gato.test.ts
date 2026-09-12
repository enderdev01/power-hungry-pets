import {
  SeededRng,
  createMatchState,
  eliminatePlayer,
  resolveFaceUpCardEffect,
  setupRound,
  type CardInstance,
  type PlayerId,
  type PlayerState,
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
const RATON_TRAMPERO_CARD: CardInstance = {
  instanceId: 'raton-trampero-instance',
  value: 2,
  type: 'RATON_TRAMPERO',
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

function expectEliminationSuccess(result: EliminationResult): SuccessfulElimination {
  if (!result.ok) {
    throw new Error(`Expected a successful elimination, got error ${String(result.error)}`);
  }
  return result;
}

/** Deals Rey Gato to the actor, runs the normal draw, and returns the drawn companion card. */
function drawWithReyGatoInHand(round: RoundState, actorId: PlayerId): CardInstance {
  playerOf(round, actorId).hand = [REY_GATO_CARD];
  const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
  const companion = playerOf(drawn.state, actorId).hand.find(
    (card) => card.instanceId !== REY_GATO_CARD.instanceId,
  );
  if (!companion) {
    throw new Error('Test fixture expected the actor to draw a companion card');
  }
  return companion;
}

describe('Card 10 Rey Gato — voluntary play', () => {
  it('eliminates the holder immediately, reveals the remaining hand card, and advances the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const companion = drawWithReyGatoInHand(round, 'p1');

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: REY_GATO_CARD.instanceId,
      }),
    );

    const actor = playerOf(result.state, 'p1');
    expect(actor.eliminated).toBe(true);
    expect(actor.hand).toEqual([]);
    expect(actor.discards).toEqual([
      { card: REY_GATO_CARD, origin: 'PLAYED' },
      { card: companion, origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
    ]);
  });

  it("ends the round via draw-pile exhaustion when the holder's self-elimination leaves several active players", () => {
    const round = createRound(['p1', 'p2', 'p3']);
    drawWithReyGatoInHand(round, 'p1');

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    drawn.state.drawPile = [];

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: REY_GATO_CARD.instanceId,
      }),
    );

    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: survivors p2 (value 5) and p3 (value 1) — p2 wins.
    expect(result.state.winners).toEqual(['p2']);
    const p2Hand = playerOf(round, 'p2').hand[0];
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p2', card: p2Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('ends the round with the last survivor when only two players remain', () => {
    const round = createRound(['p1', 'p2']);
    drawWithReyGatoInHand(round, 'p1');

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: REY_GATO_CARD.instanceId,
      }),
    );

    expect(result.state.status).toBe('ROUND_END');
    expect(result.state.winners).toEqual(['p2']);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('lets the next active player take a normal turn after the holder eliminates themselves', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    drawWithReyGatoInHand(round, 'p1');

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: REY_GATO_CARD.instanceId,
      }),
    );
    const next = expectTurnSuccess(
      applyTurnCommand(result.state, { type: 'DRAW_CARD', actorId: 'p2' }),
    );

    expect(next.state.currentPlayerId).toBe('p2');
    expect(next.state.phase).toBe('PLAY_REQUIRED');
    expect(playerOf(next.state, 'p2').hand).toHaveLength(2);
  });

  it('ignores a stray targetId and keeps eliminating the holder unchanged', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const companion = drawWithReyGatoInHand(round, 'p1');

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: REY_GATO_CARD.instanceId,
        // A stray targetId on a non-target card is ignored (Milestone 3).
        targetId: 'p2',
      }),
    );

    expect(playerOf(result.state, 'p1').eliminated).toBe(true);
    expect(playerOf(result.state, 'p1').hand).toEqual([]);
    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: REY_GATO_CARD, origin: 'PLAYED' },
      { card: companion, origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(result.events.some((event) => event.type === 'HANDS_SWAPPED')).toBe(false);
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: REY_GATO_CARD },
      { type: 'PLAYER_ELIMINATED', playerId: 'p1' },
    ]);
  });

  it('keeps private draw-pile and hidden-card information out of the public events', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    drawWithReyGatoInHand(round, 'p1');

    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: REY_GATO_CARD.instanceId,
      }),
    );

    const serializedEvents = JSON.stringify(result.events);
    for (const pileCard of result.state.drawPile) {
      expect(serializedEvents).not.toContain(pileCard.instanceId);
    }
    expect(serializedEvents).not.toContain(result.state.hiddenCard.instanceId);
  });
});

describe('Card 10 Rey Gato — elimination reveal', () => {
  it('places the revealed Rey Gato face up without recursively resolving effects or printed actions', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [REY_GATO_CARD];
    const before = snapshotOf(round);

    const result = expectEliminationSuccess(eliminatePlayer(round, 'p2'));

    const eliminated = playerOf(result.state, 'p2');
    expect(eliminated.eliminated).toBe(true);
    expect(eliminated.discards).toEqual([{ card: REY_GATO_CARD, origin: 'ELIMINATION_REVEAL' }]);
    expect(result.events).toEqual([{ type: 'PLAYER_ELIMINATED', playerId: 'p2' }]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.currentPlayerId).toBe(before.currentPlayerId);
    expect(playerOf(result.state, 'p1').hand).toEqual(playerOf(before, 'p1').hand);
    expect(playerOf(result.state, 'p3').hand).toEqual(playerOf(before, 'p3').hand);
    expect(round).toEqual(before);
  });
});

describe('resolveFaceUpCardEffect dispatch', () => {
  it('eliminates the holder through the canonical path for a forced public play origin', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const holder = playerOf(round, 'p2');
    holder.hand = [REY_GATO_CARD];
    // Forced-play contract: the forcing effect places Rey Gato face up in the
    // holder's public area first, then dispatches the canonical effect.
    holder.hand = [];
    holder.discards.push({ card: REY_GATO_CARD, origin: 'FORCED_PLAY' });
    const before = snapshotOf(round);

    const result = resolveFaceUpCardEffect(round, {
      playerId: 'p2',
      card: REY_GATO_CARD,
      origin: 'FORCED_PLAY',
    });

    expect(playerOf(result.state, 'p2').eliminated).toBe(true);
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: REY_GATO_CARD, origin: 'FORCED_PLAY' },
    ]);
    expect(result.eliminatedPlayerId).toBe('p2');
    expect(result.events).toEqual([{ type: 'PLAYER_ELIMINATED', playerId: 'p2' }]);
    expect(round).toEqual(before);
  });

  it('suppresses the printed Ratón action for a forced public play origin', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = resolveFaceUpCardEffect(round, {
      playerId: 'p2',
      card: RATON_TRAMPERO_CARD,
      // Forced face-up placement (catalog §5) suppresses the printed action
      // (spec §18): no deck inspection, no pending interaction, no events.
      origin: 'FORCED_PLAY',
    });

    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
  });
});
