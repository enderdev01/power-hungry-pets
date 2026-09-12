/**
 * Milestone 4 — match token and victory resolution (spec §§3,7,12; rules §§3,11;
 * test plan §19: token award, thresholds, shared victory).
 *
 * `applyRoundResult` is a pure match-level transition: it validates an ended
 * round, awards exactly one victory token per round winner into
 * `MatchState.players` (the token source of truth), and decides ROUND_END vs
 * MATCH_END. The ended `RoundState` itself is never mutated.
 */
import {
  applyRoundResult,
  createMatchState,
  MatchResolutionError,
  setupRound,
  SeededRng,
  type CardInstance,
  type MatchState,
  type PlayerId,
  type RoundState,
} from '../src';

const HIDDEN_CARD: CardInstance = {
  instanceId: 'hidden-instance',
  value: 1,
  type: 'PECERA_DE_CRISTAL',
};

function makeMatch(playerIds: string[], tokensById: Record<string, number> = {}): MatchState {
  const match = createMatchState({
    matchId: 'match-1',
    players: playerIds.map((id) => ({ id, name: id })),
  });
  for (const player of match.players) {
    player.victoryTokens = tokensById[player.id] ?? 0;
  }
  return match;
}

function endedRound(
  match: MatchState,
  roundNumber: number,
  winnerIds: PlayerId[],
  overrides: Partial<RoundState> = {},
): RoundState {
  return {
    matchId: match.matchId,
    status: 'ROUND_END',
    players: match.players.map((player) => ({
      ...player,
      hand: [],
      discards: [],
    })),
    turnOrder: match.players.map((player) => player.id),
    currentPlayerId: match.players[0]!.id,
    roundNumber,
    drawPile: [],
    hiddenCard: { ...HIDDEN_CARD },
    phase: 'DRAW_REQUIRED',
    pendingInteraction: null,
    winners: winnerIds,
    ...overrides,
  };
}

/**
 * Runs the call and returns the caught rejection as a MatchResolutionError so
 * each validation test can assert the typed error class and its stable code.
 */
function catchMatchResolutionError(execute: () => unknown): MatchResolutionError {
  try {
    execute();
  } catch (error) {
    expect(error).toBeInstanceOf(MatchResolutionError);
    return error as MatchResolutionError;
  }
  throw new Error('Expected the call to reject with a MatchResolutionError');
}

describe('applyRoundResult validation', () => {
  it('rejects a round from a different match with ROUND_MATCH_MISMATCH', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a'], { matchId: 'other-match' });

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROUND_MATCH_MISMATCH');
    expect(error.message).toMatch(/match/i);
  });

  it('rejects a round that has not ended with ROUND_NOT_ENDED', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a'], { status: 'ROUND_ACTIVE' });

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROUND_NOT_ENDED');
    expect(error.message).toMatch(/ROUND_END/);
  });

  it('rejects a non-monotonic (already applied) round number with ROUND_NUMBER_NOT_MONOTONIC', () => {
    const match = makeMatch(['a', 'b']);
    match.roundNumber = 3;
    const round = endedRound(match, 3, ['a']);

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROUND_NUMBER_NOT_MONOTONIC');
    expect(error.message).toMatch(/round/i);
  });

  it('rejects winner ids outside the match roster with ROUND_WINNER_NOT_IN_ROSTER', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['ghost']);

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROUND_WINNER_NOT_IN_ROSTER');
    expect(error.message).toMatch(/winner/i);
  });

  it('rejects duplicate winner ids with ROUND_WINNERS_DUPLICATED', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a', 'a']);

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROUND_WINNERS_DUPLICATED');
    expect(error.message).toMatch(/winner/i);
  });

  it('rejects empty winner lists with ROUND_WINNERS_EMPTY', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, []);

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROUND_WINNERS_EMPTY');
    expect(error.message).toMatch(/winner/i);
  });

  it('rejects applying a round result to a match already in MATCH_END with MATCH_ALREADY_ENDED', () => {
    const match = makeMatch(['a', 'b'], { a: 2 });
    const ended = applyRoundResult(match, endedRound(match, 1, ['a'])).match;
    expect(ended.status).toBe('MATCH_END');

    const round = endedRound(ended, 2, ['a']);
    const endedSnapshot = JSON.parse(JSON.stringify(ended));

    const error = catchMatchResolutionError(() => applyRoundResult(ended, round));
    expect(error.code).toBe('MATCH_ALREADY_ENDED');
    expect(error.message).toMatch(/MATCH_END/);

    // No double award and no mutation of the already-ended match.
    expect(JSON.parse(JSON.stringify(ended))).toEqual(endedSnapshot);
    expect(ended.players.find((p) => p.id === 'a')!.victoryTokens).toBe(3);
    expect(ended.players.find((p) => p.id === 'b')!.victoryTokens).toBe(0);
  });

  it('rejects a roster that no longer matches the match players with ROSTER_MISMATCH', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a']);
    round.players = round.players.filter((player) => player.id !== 'b');

    const error = catchMatchResolutionError(() => applyRoundResult(match, round));
    expect(error.code).toBe('ROSTER_MISMATCH');
    expect(error.message).toMatch(/roster/i);
  });
});

describe('token awarding below threshold', () => {
  it('awards one token per winner and stays in ROUND_END with no winners (2 players)', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('ROUND_END');
    expect(result.match.winners).toEqual([]);
    expect(result.match.roundNumber).toBe(1);
    expect(result.match.players.find((p) => p.id === 'a')!.victoryTokens).toBe(1);
    expect(result.match.players.find((p) => p.id === 'b')!.victoryTokens).toBe(0);
    expect(result.events).toEqual([{ type: 'TOKEN_AWARDED', playerId: 'a' }]);
  });

  it('awards one token to each of multiple round winners (3 players, threshold 3)', () => {
    const match = makeMatch(['a', 'b', 'c']);
    match.roundNumber = 1;
    const round = endedRound(match, 2, ['a', 'b']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('ROUND_END');
    expect(result.match.players.find((p) => p.id === 'a')!.victoryTokens).toBe(1);
    expect(result.match.players.find((p) => p.id === 'b')!.victoryTokens).toBe(1);
    expect(result.match.players.find((p) => p.id === 'c')!.victoryTokens).toBe(0);
    expect(result.events).toEqual([
      { type: 'TOKEN_AWARDED', playerId: 'a' },
      { type: 'TOKEN_AWARDED', playerId: 'b' },
    ]);
  });

  it('keeps a non-winning near-threshold player short of victory (4 players, threshold 2)', () => {
    const match = makeMatch(['a', 'b', 'c', 'd'], { a: 1 });
    const round = endedRound(match, 1, ['b']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('ROUND_END');
    expect(result.match.winners).toEqual([]);
    expect(result.match.players.find((p) => p.id === 'a')!.victoryTokens).toBe(1);
    expect(result.match.players.find((p) => p.id === 'b')!.victoryTokens).toBe(1);
  });

  it('stacks tokens across consecutive rounds toward the threshold (6 players, threshold 2)', () => {
    let match = makeMatch(['a', 'b', 'c', 'd', 'e', 'f']);
    match = applyRoundResult(match, endedRound(match, 1, ['a'])).match;
    match = applyRoundResult(match, endedRound(match, 2, ['a'])).match;

    expect(match.status).toBe('MATCH_END');
    expect(match.winners).toEqual(['a']);
    expect(match.players.find((p) => p.id === 'a')!.victoryTokens).toBe(2);
  });
});

describe('match victory resolution', () => {
  it('ends the match exactly at the 2–3 player threshold of 3 tokens', () => {
    const match = makeMatch(['a', 'b'], { a: 2 });
    const round = endedRound(match, 1, ['a']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('MATCH_END');
    expect(result.match.winners).toEqual(['a']);
    expect(result.match.players.find((p) => p.id === 'a')!.victoryTokens).toBe(3);
    expect(result.events).toEqual([
      { type: 'TOKEN_AWARDED', playerId: 'a' },
      { type: 'MATCH_ENDED', winnerIds: ['a'] },
    ]);
  });

  it('ends the match exactly at the 4–6 player threshold of 2 tokens', () => {
    const match = makeMatch(['a', 'b', 'c', 'd'], { a: 1 });
    const round = endedRound(match, 1, ['a']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('MATCH_END');
    expect(result.match.winners).toEqual(['a']);
  });

  it('declares a player above the threshold a winner (4 players, threshold 2)', () => {
    const match = makeMatch(['a', 'b', 'c', 'd'], { a: 3 });
    const round = endedRound(match, 1, ['b']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('MATCH_END');
    expect(result.match.winners).toEqual(['a']);
  });

  it('declares shared winners when several players cross the threshold at once', () => {
    const match = makeMatch(['a', 'b', 'c'], { a: 2, b: 2 });
    const round = endedRound(match, 1, ['a', 'b']);

    const result = applyRoundResult(match, round);

    expect(result.match.status).toBe('MATCH_END');
    expect(result.match.winners).toEqual(['a', 'b']);
  });

  it('emits all TOKEN_AWARDED events before MATCH_ENDED', () => {
    const match = makeMatch(['a', 'b'], { a: 2 });
    const round = endedRound(match, 1, ['a']);

    const result = applyRoundResult(match, round);

    expect(result.events).toEqual([
      { type: 'TOKEN_AWARDED', playerId: 'a' },
      { type: 'MATCH_ENDED', winnerIds: ['a'] },
    ]);
  });
});

describe('purity and state separation', () => {
  it('never mutates the input match or the ended round', () => {
    const match = makeMatch(['a', 'b'], { a: 2 });
    const round = endedRound(match, 1, ['a']);
    const matchSnapshot = JSON.parse(JSON.stringify(match));
    const roundSnapshot = JSON.parse(JSON.stringify(round));

    applyRoundResult(match, round);

    expect(JSON.parse(JSON.stringify(match))).toEqual(matchSnapshot);
    expect(JSON.parse(JSON.stringify(round))).toEqual(roundSnapshot);
  });

  it('returns a new match state whose players do not alias the inputs', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a']);

    const result = applyRoundResult(match, round);

    expect(result.match).not.toBe(match);
    expect(result.match.players[0]).not.toBe(match.players[0]);
    expect(result.match.players[0]!.victoryTokens).toBe(1);
    expect(match.players[0]!.victoryTokens).toBe(0);
  });

  it('leaves the ended round untouched, including its own winners', () => {
    const match = makeMatch(['a', 'b']);
    const round = endedRound(match, 1, ['a']);

    const result = applyRoundResult(match, round);

    expect(round.winners).toEqual(['a']);
    expect(round.status).toBe('ROUND_END');
    expect(result.match.winners).toEqual([]);
  });
});

describe('continuing and ending the match lifecycle', () => {
  it('preserves tokens and advances the round number for the next setupRound', () => {
    let match = makeMatch(['a', 'b']);
    match = applyRoundResult(match, endedRound(match, 1, ['a'])).match;

    const nextRound = setupRound(match, new SeededRng(42));

    expect(nextRound.roundNumber).toBe(2);
    expect(nextRound.players.find((p) => p.id === 'a')!.victoryTokens).toBe(1);
    expect(nextRound.players.find((p) => p.id === 'b')!.victoryTokens).toBe(0);
  });

  it('refuses to set up a round after the match has ended', () => {
    let match = makeMatch(['a', 'b'], { a: 2 });
    match = applyRoundResult(match, endedRound(match, 1, ['a'])).match;

    expect(match.status).toBe('MATCH_END');
    expect(() => setupRound(match, new SeededRng(42))).toThrow(/MATCH_END/);
  });
});
