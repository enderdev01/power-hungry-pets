import {
  SeededRng,
  createMatchState,
  setupRound,
  type FirstPlayerPolicy,
  type PlayerId,
} from '../src';

const playerCounts = [2, 3, 4, 5, 6];

const firstListedPlayer: FirstPlayerPolicy = ({ playerIds }) => playerIds[0];

describe.each(playerCounts)('round setup with %i players', (playerCount) => {
  it('shuffles, deals one card per player, then removes one hidden card', () => {
    const playerIds = Array.from({ length: playerCount }, (_, index) => `player-${index + 1}`);
    const match = createMatchState({
      matchId: `match-${playerCount}`,
      players: playerIds.map((id) => ({ id, name: id })),
    });
    const round = setupRound(match, new SeededRng(9876), firstListedPlayer);
    const allRoundCards = [
      ...round.drawPile,
      round.hiddenCard,
      ...round.players.flatMap((player) => player.hand),
    ];

    expect(round.status).toBe('ROUND_ACTIVE');
    expect(round.currentPlayerId).toBe(playerIds[0] as PlayerId);
    expect(round.turnOrder).toEqual(playerIds);
    expect(round.players).toHaveLength(playerCount);
    expect(round.players.every((player) => player.hand.length === 1)).toBe(true);
    expect(round.hiddenCard).not.toBeNull();
    expect(round.drawPile).toHaveLength(20 - playerCount);
    expect(round.players.every((player) => !player.eliminated)).toBe(true);
    expect(round.players.every((player) => !player.protected)).toBe(true);
    expect(round.players.every((player) => player.discards.length === 0)).toBe(true);
    expect(allRoundCards).toHaveLength(21);
    expect(new Set(allRoundCards.map((card) => card.instanceId)).size).toBe(21);
  });
});

describe('first-player policy', () => {
  it('selects the first player through a replaceable policy', () => {
    const match = createMatchState({
      matchId: 'match-policy',
      players: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    const lastListedPlayer: FirstPlayerPolicy = ({ playerIds }) => playerIds[playerIds.length - 1];

    const round = setupRound(match, new SeededRng(1), lastListedPlayer);

    expect(round.currentPlayerId).toBe('b');
  });
});

describe('setupRound match-end guard', () => {
  it('refuses to set up a round once the match is over', () => {
    const match = createMatchState({
      matchId: 'match-ended',
      players: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    const endedMatch: typeof match = {
      ...match,
      status: 'MATCH_END',
      winners: ['a'],
    };

    expect(() => setupRound(endedMatch, new SeededRng(1), firstListedPlayer)).toThrow(/MATCH_END/);
  });
});
