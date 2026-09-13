/**
 * Game-flow state: pure, framework-free reducer for the M7 game-table slice.
 * Server projections are the only truth — the reducer stores authoritative
 * public/private views unchanged, keeps a bounded animation-only event feed,
 * and records match end. It never computes rules and never invents state.
 */
import type { GamePublicEvent, PrivateGameView, PublicGameView } from '@power-hungry-pets/protocol';
import { nextRoundResult, type RoundResultEvidence } from './round-result';

/** Maximum number of animation-only events retained for the feed. */
export const GAME_EVENT_LOG_LIMIT = 20;

/** Server-projection state for the game table this tab is seated at. */
export interface GameState {
  /** Shared public view; `null` until an authoritative projection arrives. */
  publicView: PublicGameView | null;
  /** This viewer's private view; `null` until addressed to this seat. */
  privateView: PrivateGameView | null;
  /** Whether the server announced the match has ended. */
  matchEnded: boolean;
  /** Player ids of the match winners as announced by the server. */
  matchWinners: string[];
  /** Bounded, animation-only feed of sanitized public events. */
  recentEvents: GamePublicEvent[];
  /**
   * WU9: evidence of the last announced round end, captured only from an
   * atomic `game:event` batch that carried ROUND_ENDED without MATCH_ENDED
   * (match-ending presentation belongs to WU10). Cleared when actual gameplay
   * resumes via the next non-round-end event batch; projections alone never
   * touch it.
   */
  roundResult: RoundResultEvidence | null;
}

export type GameAction =
  | { type: 'game/public-state'; publicView: PublicGameView }
  | { type: 'game/private-state'; privateView: PrivateGameView }
  | { type: 'game/events'; events: GamePublicEvent[] }
  | { type: 'game/match-ended'; winners: string[] }
  | { type: 'game/cleared' };

/** Truthful starting state: no projections, no match end, empty event feed. */
export function createInitialGameState(): GameState {
  return {
    publicView: null,
    privateView: null,
    matchEnded: false,
    matchWinners: [],
    recentEvents: [],
    roundResult: null,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'game/public-state':
      return { ...state, publicView: action.publicView };
    case 'game/private-state':
      return { ...state, privateView: action.privateView };
    case 'game/events':
      return {
        ...state,
        recentEvents: [...state.recentEvents, ...action.events].slice(-GAME_EVENT_LOG_LIMIT),
        // WU9: a ROUND_ENDED batch (without MATCH_ENDED) captures and re-arms
        // the round result; any other event batch means actual gameplay
        // resumed and clears it. Projections alone never touch it, so the
        // server's immediate post-result fanout cannot erase the slip.
        roundResult: nextRoundResult(state.roundResult, action.events, state.publicView),
      };
    case 'game/match-ended':
      return { ...state, matchEnded: true, matchWinners: [...action.winners] };
    case 'game/cleared':
      return createInitialGameState();
    default:
      return state;
  }
}
