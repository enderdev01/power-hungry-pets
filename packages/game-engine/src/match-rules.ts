/**
 * Centralized match rules: victory-token awarding and match-end resolution
 * (spec §§3,7; rules §§3,11; test plan §19).
 *
 * All public helpers are pure: transitions are applied to a cloned state and
 * the input `MatchState`/`RoundState` are never mutated.
 */
import type { MatchState, PlayerId, PlayerState, RoundState } from './models';

export type TokenAwardedEvent = { type: 'TOKEN_AWARDED'; playerId: PlayerId };
export type MatchEndedEvent = { type: 'MATCH_ENDED'; winnerIds: PlayerId[] };

export type MatchRulesEvent = TokenAwardedEvent | MatchEndedEvent;

export type MatchRulesResult = {
  match: MatchState;
  events: MatchRulesEvent[];
};

/**
 * Stable error codes for the transactional validations of `applyRoundResult`
 * (spec §8). Each code maps to exactly one rejection branch.
 */
export type MatchResolutionErrorCode =
  | 'MATCH_ALREADY_ENDED'
  | 'ROUND_MATCH_MISMATCH'
  | 'ROUND_NOT_ENDED'
  | 'ROSTER_MISMATCH'
  | 'ROUND_NUMBER_NOT_MONOTONIC'
  | 'ROUND_WINNERS_EMPTY'
  | 'ROUND_WINNERS_DUPLICATED'
  | 'ROUND_WINNER_NOT_IN_ROSTER';

/** Typed rejection raised by `applyRoundResult` validation failures. */
export class MatchResolutionError extends Error {
  readonly code: MatchResolutionErrorCode;

  constructor(code: MatchResolutionErrorCode, message: string) {
    super(message);
    this.name = 'MatchResolutionError';
    this.code = code;
    // Keep `instanceof` reliable when TypeScript downlevels the class.
    Object.setPrototypeOf(this, MatchResolutionError.prototype);
  }
}

/**
 * Victory threshold by player count (rules §3): 3 tokens for 2–3 players,
 * 2 tokens for 4–6 players.
 */
export function victoryThresholdFor(playerCount: number): number {
  return playerCount <= 3 ? 3 : 2;
}

/**
 * Pure match-level resolution of one ended round (rules §§4,11): validates the
 * ended round against the match, awards exactly one victory token to every
 * distinct round winner in the token source of truth
 * (`MatchState.players.victoryTokens`), then decides ROUND_END vs MATCH_END.
 *
 * Validations (transactional command processing, spec §8):
 * - the round must belong to this match;
 * - the round must be ROUND_END;
 * - the round must carry the same roster as the match;
 * - the round number must be exactly match.roundNumber + 1 (monotonic; an
 *   already-applied or skipped round is rejected);
 * - round winners must be non-empty, unique roster members.
 *
 * Event ordering: every TOKEN_AWARDED precedes the single MATCH_ENDED.
 */
export function applyRoundResult(match: MatchState, round: RoundState): MatchRulesResult {
  if (match.status === 'MATCH_END') {
    throw new MatchResolutionError(
      'MATCH_ALREADY_ENDED',
      'Match is already in MATCH_END; no further round results can be applied',
    );
  }
  if (round.matchId !== match.matchId) {
    throw new MatchResolutionError('ROUND_MATCH_MISMATCH', 'Round belongs to a different match');
  }
  if (round.status !== 'ROUND_END') {
    throw new MatchResolutionError(
      'ROUND_NOT_ENDED',
      `Round status must be ROUND_END, got ${round.status}`,
    );
  }
  if (!sameRoster(match, round)) {
    throw new MatchResolutionError('ROSTER_MISMATCH', 'Round roster must match the match roster');
  }
  if (round.roundNumber !== match.roundNumber + 1) {
    throw new MatchResolutionError(
      'ROUND_NUMBER_NOT_MONOTONIC',
      `Round number must be ${match.roundNumber + 1} to follow the last applied round, got ${round.roundNumber}`,
    );
  }
  if (round.winners.length === 0) {
    throw new MatchResolutionError(
      'ROUND_WINNERS_EMPTY',
      'An ended round must declare at least one round winner',
    );
  }
  const rosterIds = new Set(match.players.map((player) => player.id));
  if (new Set(round.winners).size !== round.winners.length) {
    throw new MatchResolutionError(
      'ROUND_WINNERS_DUPLICATED',
      'Round winners must be distinct player ids',
    );
  }
  for (const winnerId of round.winners) {
    if (!rosterIds.has(winnerId)) {
      throw new MatchResolutionError(
        'ROUND_WINNER_NOT_IN_ROSTER',
        `Round winner ${winnerId} is not in the match roster`,
      );
    }
  }

  const state = cloneMatchState(match);
  const events: MatchRulesEvent[] = [];

  for (const winnerId of round.winners) {
    const player = state.players.find((candidate) => candidate.id === winnerId) as PlayerState;
    player.victoryTokens += 1;
    events.push({ type: 'TOKEN_AWARDED', playerId: winnerId });
  }
  state.roundNumber = round.roundNumber;

  const threshold = victoryThresholdFor(state.players.length);
  const matchWinners = state.players
    .filter((player) => player.victoryTokens >= threshold)
    .map((player) => player.id);
  if (matchWinners.length > 0) {
    state.status = 'MATCH_END';
    state.winners = matchWinners;
    events.push({ type: 'MATCH_ENDED', winnerIds: matchWinners });
  } else {
    state.status = 'ROUND_END';
    state.winners = [];
  }

  return { match: state, events };
}

function sameRoster(match: MatchState, round: RoundState): boolean {
  if (round.players.length !== match.players.length) {
    return false;
  }
  const matchIds = match.players.map((player) => player.id).sort();
  const roundIds = round.players.map((player) => player.id).sort();
  return matchIds.every((id, index) => id === roundIds[index]);
}

/** Deep clone so applied transitions never alias an input state. */
function cloneMatchState(match: MatchState): MatchState {
  return {
    ...match,
    players: match.players.map((player) => ({
      ...player,
      hand: player.hand.map((card) => ({ ...card })),
      discards: player.discards.map((entry) => ({
        card: { ...entry.card },
        origin: entry.origin,
      })),
    })),
  };
}
