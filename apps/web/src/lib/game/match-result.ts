/**
 * Match-result evidence and presentation (WU10): the client-safe derivation
 * layer for the end-of-match surface.
 *
 * Match-over is derived client-side from exactly one authoritative source: the
 * public projection's `match.status === 'MATCH_END'`. The live
 * `matchEnded`/`matchWinners` broadcast state is supplemental evidence only —
 * it never triggers the result and only fills winner ids when the MATCH_END
 * projection itself names none — so a reconnect after the finish renders the
 * full result from the re-fanned projection alone.
 *
 * Names and final victory tokens resolve only from the projected roster
 * (`publicView.players`), winner ids come from the MATCH_END projection
 * (preferred) or the match broadcast evidence, ids are deduplicated in
 * first-seen order, and every id that the roster cannot resolve is dropped
 * fail-closed — a raw id is never surfaced for rendering. When no winner can
 * be resolved the model stays honest: the surface still shows the final
 * totals but never names an unresolvable winner.
 */
import type { PublicGameView } from '@power-hungry-pets/protocol';

/**
 * Whether the authoritative public projection announces the match is over.
 * Supplementation never triggers match-over: only the projection does.
 */
export function isMatchOver(publicView: PublicGameView | null): boolean {
  return publicView?.match?.status === 'MATCH_END';
}

/** The render model the match-result surface renders from. */
export type MatchResultModel =
  | { kind: 'none' }
  | {
      kind: 'visible';
      /** Fail-closed resolved winners, in announced order, deduplicated. */
      winners: Array<{ playerId: string; name: string }>;
      /** True exactly when more than one winner resolved against the roster. */
      sharedWin: boolean;
      /** Every roster player's final victory tokens, in roster order. */
      totals: Array<{ playerId: string; name: string; tokens: number }>;
    };

export const NO_MATCH_RESULT: MatchResultModel = { kind: 'none' };

/** Validates a winner-id list: strings only, deduplicated, first-seen order. */
function normalizeWinnerIds(raw: unknown): string[] {
  const ids: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id === 'string' && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Derives the match-result render model from the authoritative public view,
 * with the live match broadcast's winner ids as supplemental evidence. Every
 * id is resolved against the roster and unknown ids are dropped fail-closed:
 * the model never carries a raw id, so the surface can never render one.
 */
export function evaluateMatchResult(
  publicView: PublicGameView | null,
  broadcastWinnerIds: readonly string[] = [],
): MatchResultModel {
  if (!isMatchOver(publicView)) {
    return NO_MATCH_RESULT;
  }
  const view = publicView as PublicGameView;

  // Roster is the only naming/totals source; unknown ids never resolve.
  const nameById = new Map<string, string>();
  if (Array.isArray(view.players)) {
    for (const player of view.players) {
      if (typeof player?.id === 'string' && typeof player.name === 'string') {
        nameById.set(player.id, player.name);
      }
    }
  }

  // Winner provenance is single-sourced: the projection's MATCH_END winners
  // when it names any (validated) ids, otherwise the live match broadcast.
  const projectedWinners = normalizeWinnerIds(view.match.winners);
  const winnerIds =
    projectedWinners.length > 0 ? projectedWinners : normalizeWinnerIds(broadcastWinnerIds);
  const winners = winnerIds
    .filter((playerId) => nameById.has(playerId))
    .map((playerId) => ({ playerId, name: nameById.get(playerId) as string }));

  const totals = Array.isArray(view.players)
    ? view.players
        .filter(
          (player) =>
            typeof player?.id === 'string' &&
            typeof player.name === 'string' &&
            typeof player.victoryTokens === 'number',
        )
        .map((player) => ({
          playerId: player.id,
          name: player.name,
          tokens: player.victoryTokens,
        }))
    : [];

  return { kind: 'visible', winners, sharedWin: winners.length > 1, totals };
}
