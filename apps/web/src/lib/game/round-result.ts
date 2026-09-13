/**
 * Round-result evidence and presentation (WU9): the client-safe derivation layer
 * for end-of-round presentation.
 *
 * Evidence comes from exactly one source: an atomic `game:event` batch. A round
 * result is captured only when the batch carries ROUND_ENDED and does not also
 * carry MATCH_ENDED (match-ending presentation belongs to WU10). The ended
 * round number is taken from the pre-batch public view; when it is absent the
 * result stays honest with `null` and generic copy.
 *
 * The layer never infers winners, tie-break totals, or hidden hands from public
 * state: names, award totals, and reveal cards resolve only from server-published
 * evidence plus the current public view, and every unknown id is dropped
 * fail-closed — a raw id or instance id is never surfaced for rendering. The
 * current client-safe protocol carries no winning hands for last-survivor
 * rounds, so the copy never promises them.
 */
import type {
  CardType,
  GamePublicEvent,
  PublicCard,
  PublicGameView,
} from '@power-hungry-pets/protocol';

/** The canonical protocol card-type domain; anything outside it is fail-closed. */
const CARD_TYPES: ReadonlySet<string> = new Set<string>([
  'ROBOT_ASPIRADOR_REAL',
  'PECERA_DE_CRISTAL',
  'RATON_TRAMPERO',
  'CONEJITO_GUERRILLERO',
  'CAPARAZON_ARMAZON',
  'SERPIENTE_ENCANTADORA',
  'SAQUEADOG_DE_TUMBAS',
  'MALABARISTA_DE_OCHO_PATAS',
  'ERMITANO_BUSCA_CASA',
  'NO_SOY_UNA_MASCOTA',
  'REY_GATO',
] satisfies readonly CardType[]);

/** Why the round ended, decided only by the events the server published. */
export type RoundResultReason = 'exhaustion' | 'last-survivor';

/**
 * Server-evidence-only snapshot of one ended round, captured by the game
 * reducer at the moment the ROUND_ENDED batch arrived. It stores ids and
 * counts exactly as announced; naming and token totals resolve at render time
 * from the current public view so they always stay authoritative.
 */
export interface RoundResultEvidence {
  /** The ended round's number from the pre-batch public view; `null` when unknown. */
  roundNumber: number | null;
  /** Winner player ids exactly as the ROUND_ENDED event announced them. */
  winnerIds: string[];
  /** TOKEN_AWARDED evidence, folded per player in first-seen order. */
  awards: Array<{ playerId: string; amount: number }>;
  /** Exhaustion only when the batch carried HANDS_REVEALED; otherwise last survivor. */
  reason: RoundResultReason;
  /** Exhaustion reveal cards from HANDS_REVEALED; empty for last-survivor rounds. */
  revealedHands: Array<{ playerId: string; card: PublicCard }>;
}

/** The render model the result slip renders from. */
export type RoundResultModel =
  | { kind: 'none' }
  | {
      kind: 'visible';
      roundNumber: number | null;
      /** Fail-closed resolved winners, in announced order, deduplicated. */
      winners: Array<{ playerId: string; name: string }>;
      /** True exactly when more than one winner resolved against the roster
       * (post-resolution visible winners); a shared announcement whose ids
       * fail roster resolution is not a visible shared win. */
      sharedWin: boolean;
      reason: RoundResultReason;
      /** Roster-resolved awards. `total` is the authoritative current victoryTokens
       * only when the current public view is demonstrably the post-result or
       * new-round projection (its round number differs from the captured
       * pre-batch round number); otherwise `null` so the copy stays award-only
       * and never risks showing a stale pre-award total. */
      awards: Array<{ playerId: string; name: string; amount: number; total: number | null }>;
      /** Roster-resolved exhaustion reveals, in published order. */
      reveals: Array<{ playerId: string; name: string; card: PublicCard }>;
    };

export const NO_ROUND_RESULT: RoundResultModel = { kind: 'none' };

function isPublicCard(value: unknown): value is PublicCard {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Partial<PublicCard>).value !== 'number' ||
    !Number.isFinite((value as Partial<PublicCard>).value) ||
    typeof (value as Partial<PublicCard>).type !== 'string'
  ) {
    return false;
  }
  // An unknown type would make cardPresentation throw at render time; drop it
  // here so a malformed published card can never reach the slip.
  return CARD_TYPES.has((value as { type?: string }).type ?? '');
}

function roundNumberOf(publicView: PublicGameView | null): number | null {
  const raw = publicView?.round?.roundNumber;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * Captures the round-result evidence of one atomic `game:event` batch. Returns
 * `null` unless the batch carries ROUND_ENDED without MATCH_ENDED: a match-end
 * batch belongs to WU10, and any other batch means actual gameplay resumed.
 * The round number comes only from the pre-batch public view.
 */
export function captureRoundResultEvidence(
  events: GamePublicEvent[],
  preBatchRoundNumber: number | null,
): RoundResultEvidence | null {
  if (!Array.isArray(events)) {
    return null;
  }
  const hasMatchEnd = events.some((event) => event.type === 'MATCH_ENDED');
  const roundEnd = [...events].reverse().find((event) => event.type === 'ROUND_ENDED');
  if (hasMatchEnd || roundEnd === undefined) {
    return null;
  }

  const winnerIds: string[] = [];
  // Fail-closed: a non-array winnerIds (malformed published batch) is
  // treated as an announcement of no winners rather than a crash.
  const announcedWinnerIds: unknown = (roundEnd as { winnerIds: unknown }).winnerIds;
  for (const id of Array.isArray(announcedWinnerIds) ? announcedWinnerIds : []) {
    if (typeof id === 'string' && !winnerIds.includes(id)) {
      winnerIds.push(id);
    }
  }

  const awardCounts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'TOKEN_AWARDED' || typeof event.playerId !== 'string') {
      continue;
    }
    awardCounts.set(event.playerId, (awardCounts.get(event.playerId) ?? 0) + 1);
  }
  const awards = [...awardCounts].map(([playerId, amount]) => ({ playerId, amount }));

  const handsEvent = [...events]
    .reverse()
    .find(
      (event): event is Extract<GamePublicEvent, { type: 'HANDS_REVEALED' }> =>
        event.type === 'HANDS_REVEALED',
    );
  const revealedHands: RoundResultEvidence['revealedHands'] = [];
  if (handsEvent !== undefined && Array.isArray(handsEvent.hands)) {
    for (const hand of handsEvent.hands) {
      if (typeof hand?.playerId === 'string' && isPublicCard(hand.card)) {
        revealedHands.push({ playerId: hand.playerId, card: hand.card });
      }
    }
  }

  return {
    roundNumber: preBatchRoundNumber,
    winnerIds,
    awards,
    reason: handsEvent !== undefined ? 'exhaustion' : 'last-survivor',
    revealedHands,
  };
}

/**
 * The game reducer's round-result transition for one `game/events` batch: a
 * fresh ROUND_ENDED batch (without MATCH_ENDED) captures and re-arms the
 * result; any other batch means actual gameplay resumed and clears a visible
 * result. Projection-only actions never reach this function, so the server's
 * immediate post-result fanout cannot erase a result before it is seen.
 */
export function nextRoundResult(
  _current: RoundResultEvidence | null,
  events: GamePublicEvent[],
  preBatchPublicView: PublicGameView | null,
): RoundResultEvidence | null {
  return captureRoundResultEvidence(events, roundNumberOf(preBatchPublicView));
}

/**
 * Derives the render model from captured evidence plus the current public
 * view. Every id is resolved against the roster and unknown ids are dropped
 * fail-closed: the model never carries a raw id, so the slip can never render
 * one. Award totals come from the authoritative current public view when the
 * roster carries them and stay `null` (honest omission) when unavailable.
 */
export function evaluateRoundResult(
  evidence: RoundResultEvidence | null,
  publicView: PublicGameView | null,
): RoundResultModel {
  if (evidence === null) {
    return NO_ROUND_RESULT;
  }

  const nameById = new Map<string, string>();
  const tokensById = new Map<string, number>();
  if (publicView !== null && Array.isArray(publicView.players)) {
    for (const player of publicView.players) {
      if (typeof player?.id === 'string') {
        if (typeof player.name === 'string') {
          nameById.set(player.id, player.name);
        }
        if (typeof player.victoryTokens === 'number') {
          tokensById.set(player.id, player.victoryTokens);
        }
      }
    }
  }

  const winners = (Array.isArray(evidence.winnerIds) ? evidence.winnerIds : [])
    .filter((playerId) => nameById.has(playerId))
    .map((playerId) => ({ playerId, name: nameById.get(playerId) as string }));

  // Staleness gate: the current view's round number differs from the captured
  // pre-batch one only once the server's post-result (or next-round) fanout
  // has actually arrived, so the tokens read here demonstrably include the
  // award. A same-round view (or an unknown round) yields `null` totals and
  // award-only copy instead of a possibly pre-award number.
  const currentRoundNumber = roundNumberOf(publicView);
  const postResultProjection =
    evidence.roundNumber !== null &&
    currentRoundNumber !== null &&
    currentRoundNumber !== evidence.roundNumber;

  const awards = (Array.isArray(evidence.awards) ? evidence.awards : [])
    .filter((award) => nameById.has(award.playerId))
    .map((award) => ({
      playerId: award.playerId,
      name: nameById.get(award.playerId) as string,
      amount: award.amount,
      total:
        postResultProjection && tokensById.has(award.playerId)
          ? (tokensById.get(award.playerId) as number)
          : null,
    }));

  const reveals = (Array.isArray(evidence.revealedHands) ? evidence.revealedHands : [])
    .filter((hand) => nameById.has(hand.playerId))
    .map((hand) => ({
      playerId: hand.playerId,
      name: nameById.get(hand.playerId) as string,
      card: hand.card,
    }));

  return {
    kind: 'visible',
    roundNumber: evidence.roundNumber,
    winners,
    sharedWin: winners.length > 1,
    reason: evidence.reason,
    awards,
    reveals,
  };
}

/** Human sentence for the round's ending reason; no hand is ever promised. */
export function roundResultReasonSentence(reason: RoundResultReason): string {
  return reason === 'exhaustion'
    ? 'The draw pile ran out — the remaining hands were revealed.'
    : 'The last survivor took the round.';
}
