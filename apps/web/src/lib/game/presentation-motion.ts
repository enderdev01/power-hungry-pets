/**
 * Presentation-motion mapping (M8 card-action work unit): the pure seam between
 * the reducer-owned motion-cue state and the game table's one-shot CSS cues.
 *
 * The thesis: the focal moment is the card landing. Each cue-bearing event
 * batch yields at most ONE authoritative destination cue — the newest
 * motion-worthy cue of that batch — and motion only starts once the
 * authoritative projection actually shows the destination: the newest public
 * discard the cue describes, or, for a card draw, the addressed player's
 * public handCount actually changing from its pre-cue value. Projection-only
 * reconnects, cleared games, and unsupported-only batches are motionless by
 * construction.
 *
 * Every mapping is fail-closed: unknown cue kinds, unresolvable player ids, a
 * draw the projection never confirms, or a projection that never shows the
 * destination simply produce no motion. No plan ever carries card instance
 * identity, guesses, or invented seat attribution — the displayed public card
 * always comes from the projection.
 */
import type { PublicGameView } from '@power-hungry-pets/protocol';
import type { MotionCue, MotionCueState } from './motion-cues';

/** The one-shot CSS motion kinds this work unit ships. */
export type MotionKind =
  'draw-settle' | 'card-landing' | 'card-flip' | 'hand-shuffle' | 'hand-exchange' | 'effect-settle';

/** A motion addressed to one rendered surface, stamped with its batch sequence. */
export interface ZoneMotion {
  kind: MotionKind;
  sequence: number;
}

/** Motion addressed to a player's public discard surface. */
export interface DiscardMotion {
  kind: 'card-landing' | 'card-flip';
  sequence: number;
}

/** The active motion plan the table renders from; `null` means motionless. */
export type ActiveMotion =
  | {
      kind: Extract<MotionKind, 'draw-settle' | 'card-landing' | 'card-flip' | 'effect-settle'>;
      sequence: number;
      playerId: string;
    }
  | { kind: 'hand-exchange'; sequence: number; playerIds: [string, string] }
  | { kind: 'hand-shuffle'; sequence: number };

/**
 * The cue batch currently awaiting its destination confirmation. The batch is
 * identified by its monotonic sequence and holds a snapshot of its own cues,
 * plus the pre-cue public handCount snapshot captured on arrival.
 */
export interface PendingMotionBatch {
  sequence: number;
  cues: MotionCue[];
  /** Addressed player's public handCount per seat, captured when the batch arrived. */
  preCounts: Record<string, number> | null;
}

/** Consumer-side cursor: the newest cue batch this consumer has already observed. */
export interface MotionCursor {
  sequence: number;
}

/**
 * Full consumer state held by the table: the observed cursor, the batch still
 * waiting for the projection to confirm its destination, and the plan that is
 * currently rendered. Held outside React state so re-renders can never replay
 * a consumed batch.
 */
export interface MotionConsumerState {
  cursor: MotionCursor;
  pending: PendingMotionBatch | null;
  plan: ActiveMotion | null;
}

/** What one batch resolved to against the current projection. */
export type BatchMotionOutcome =
  | { verdict: 'animate'; plan: ActiveMotion }
  | { verdict: 'await-projection' }
  | { verdict: 'none' };

/** Truthful starting state: nothing observed, nothing pending, motionless. */
export function initialMotionConsumerState(): MotionConsumerState {
  return { cursor: { sequence: 0 }, pending: null, plan: null };
}

/** The cue kinds this work unit turns into motion, in the seam's vocabulary. */
function isMotionWorthy(cue: MotionCue): boolean {
  return (
    cue.kind === 'card-drawn' ||
    cue.kind === 'card-played' ||
    cue.kind === 'card-forced-face-up' ||
    cue.kind === 'hands-redealt' ||
    cue.kind === 'hands-swapped' ||
    cue.kind === 'private-effect-resolved' ||
    cue.kind === 'player-eliminated'
  );
}

function resolvePlayer(publicView: PublicGameView | null, playerId: string): boolean {
  return (
    publicView !== null &&
    Array.isArray(publicView.players) &&
    publicView.players.some((player) => player?.id === playerId)
  );
}

/** The player's public handCount, or `null` when the seat is unresolvable. */
function handCountOf(publicView: PublicGameView | null, playerId: string): number | null {
  if (publicView === null || !Array.isArray(publicView.players)) {
    return null;
  }
  const player = publicView.players.find((candidate) => candidate?.id === playerId);
  const count = player?.handCount;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/**
 * The public handCount of every resolvable seat, captured at the moment a cue
 * batch arrives — before the batch's own projection lands. `null` when no
 * projection has arrived yet, so a draw can never be confirmed without evidence.
 */
function capturedHandCounts(publicView: PublicGameView | null): Record<string, number> | null {
  if (publicView === null || !Array.isArray(publicView.players)) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const player of publicView.players) {
    if (
      player !== null &&
      typeof player === 'object' &&
      typeof player.id === 'string' &&
      typeof player.handCount === 'number' &&
      Number.isFinite(player.handCount)
    ) {
      counts[player.id] = player.handCount;
    }
  }
  return counts;
}

/** Only finite, seat-keyed counts survive; anything else fails closed. */
function isPreCounts(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, count]) => key.length > 0 && typeof count === 'number' && Number.isFinite(count),
  );
}

/** The player's newest public discard, or `null` when the pile is empty. */
function newestDiscard(
  publicView: PublicGameView | null,
  playerId: string,
): { card: { value: number; type: string }; origin: string } | null {
  if (publicView === null || !Array.isArray(publicView.players)) {
    return null;
  }
  const player = publicView.players.find((candidate) => candidate?.id === playerId);
  const discards = player?.discards;
  if (!Array.isArray(discards) || discards.length === 0) {
    return null;
  }
  const newest = discards[discards.length - 1];
  if (
    newest === null ||
    typeof newest !== 'object' ||
    typeof newest.origin !== 'string' ||
    newest.card === null ||
    typeof newest.card !== 'object' ||
    typeof newest.card.value !== 'number' ||
    typeof newest.card.type !== 'string'
  ) {
    return null;
  }
  return { card: newest.card, origin: newest.origin };
}

function sameCard(
  cueCard: { value: number; type: string },
  discardCard: { value: number; type: string },
): boolean {
  return cueCard.value === discardCard.value && cueCard.type === discardCard.type;
}

/**
 * Maps one consumed batch onto its single authoritative motion, verifying the
 * destination against the projection. Scanning from the newest cue keeps the
 * card landing as the focal moment; everything else in the batch stays still.
 */
export function evaluateBatchMotion(
  batch: PendingMotionBatch,
  publicView: PublicGameView | null,
): BatchMotionOutcome {
  if (batch === null || !Array.isArray(batch.cues)) {
    return { verdict: 'none' };
  }
  let focal: MotionCue | null = null;
  for (let index = batch.cues.length - 1; index >= 0; index -= 1) {
    const cue = batch.cues[index];
    if (cue !== null && typeof cue === 'object' && isMotionWorthy(cue)) {
      focal = cue;
      break;
    }
  }
  if (focal === null) {
    return { verdict: 'none' };
  }
  const sequence = batch.sequence;
  switch (focal.kind) {
    case 'card-drawn': {
      // The draw destination is the addressed player's hand zone; the event
      // carries no instance id, so no card is ever named or revealed. Motion
      // waits for the authoritative projection to confirm the destination:
      // the player's public handCount actually changing from its captured
      // pre-cue value. A draw the projection never confirms stays motionless.
      if (!resolvePlayer(publicView, focal.playerId)) {
        return { verdict: 'none' };
      }
      const preCounts = isPreCounts(batch.preCounts) ? batch.preCounts : null;
      const preCount = preCounts !== null ? preCounts[focal.playerId] : undefined;
      if (typeof preCount !== 'number') {
        return { verdict: 'await-projection' };
      }
      const current = handCountOf(publicView, focal.playerId);
      if (current === null || current === preCount) {
        return { verdict: 'await-projection' };
      }
      return {
        verdict: 'animate',
        plan: { kind: 'draw-settle', sequence, playerId: focal.playerId },
      };
    }
    case 'card-played': {
      if (!resolvePlayer(publicView, focal.playerId)) {
        return { verdict: 'none' };
      }
      const newest = newestDiscard(publicView, focal.playerId);
      if (newest === null || !sameCard(focal.card, newest.card)) {
        return { verdict: 'await-projection' };
      }
      return {
        verdict: 'animate',
        plan: { kind: 'card-landing', sequence, playerId: focal.playerId },
      };
    }
    case 'card-forced-face-up': {
      if (!resolvePlayer(publicView, focal.playerId)) {
        return { verdict: 'none' };
      }
      const newest = newestDiscard(publicView, focal.playerId);
      if (
        newest === null ||
        newest.origin !== 'FORCED_PLAY' ||
        !sameCard(focal.card, newest.card)
      ) {
        return { verdict: 'await-projection' };
      }
      return {
        verdict: 'animate',
        plan: { kind: 'card-flip', sequence, playerId: focal.playerId },
      };
    }
    case 'player-eliminated': {
      if (!resolvePlayer(publicView, focal.playerId)) {
        return { verdict: 'none' };
      }
      const newest = newestDiscard(publicView, focal.playerId);
      if (newest === null || newest.origin !== 'ELIMINATION_REVEAL') {
        return { verdict: 'await-projection' };
      }
      return {
        verdict: 'animate',
        plan: { kind: 'card-flip', sequence, playerId: focal.playerId },
      };
    }
    case 'hands-redealt':
      // The cue deliberately carries no ids: the honest cue is table-level,
      // never a per-seat attribution the evidence does not carry.
      return { verdict: 'animate', plan: { kind: 'hand-shuffle', sequence } };
    case 'hands-swapped':
      return resolvePlayer(publicView, focal.playerIds[0]) &&
        resolvePlayer(publicView, focal.playerIds[1])
        ? {
            verdict: 'animate',
            plan: { kind: 'hand-exchange', sequence, playerIds: [...focal.playerIds] },
          }
        : { verdict: 'none' };
    case 'private-effect-resolved':
      return resolvePlayer(publicView, focal.playerId)
        ? {
            verdict: 'animate',
            plan: { kind: 'effect-settle', sequence, playerId: focal.playerId },
          }
        : { verdict: 'none' };
    default:
      return { verdict: 'none' };
  }
}

/**
 * The table's motion transition for one render observation: consumes newly
 * arrived cue batches (newest batch wins over a still-waiting one), resolves
 * the pending batch against the current projection, and returns the plan to
 * render. Batches are identified only by the monotonic sequence — never by the
 * bounded cue log's length — so motion keeps working after the log saturates.
 * A sequence reset — a cleared game or a reconnect — collapses everything to
 * motionless instead of replaying stale cues.
 */
export function advanceMotionConsumer(
  state: MotionConsumerState,
  cueState: MotionCueState,
  publicView: PublicGameView | null,
): { state: MotionConsumerState; plan: ActiveMotion | null } {
  const safeCueState =
    cueState !== null &&
    typeof cueState === 'object' &&
    typeof cueState.sequence === 'number' &&
    Number.isFinite(cueState.sequence) &&
    Array.isArray(cueState.cues)
      ? cueState
      : { sequence: 0, cues: [], lastBatch: null };

  // A reset (the sequence moved backwards) is never motion: reconnects and
  // cleared games restart motionless.
  if (safeCueState.sequence < state.cursor.sequence) {
    return {
      state: {
        cursor: { sequence: safeCueState.sequence },
        pending: null,
        plan: null,
      },
      plan: null,
    };
  }

  let next: MotionConsumerState = state;
  if (safeCueState.sequence > state.cursor.sequence) {
    // The newest batch is resolved by its monotonic sequence from the
    // reducer's stamped snapshot — never by slicing the bounded log.
    const newestBatch =
      safeCueState.lastBatch !== null &&
      typeof safeCueState.lastBatch === 'object' &&
      safeCueState.lastBatch.sequence === safeCueState.sequence
        ? safeCueState.lastBatch
        : null;
    next = {
      cursor: { sequence: safeCueState.sequence },
      // The newest batch replaces any batch still awaiting confirmation.
      pending: {
        sequence: safeCueState.sequence,
        cues: newestBatch !== null ? newestBatch.cues : [],
        // Remember the pre-cue public handCounts so a card-drawn cue can wait
        // for the addressed player's projected count to actually change.
        preCounts: capturedHandCounts(publicView),
      },
      plan: state.plan,
    };
  }

  if (next.pending !== null) {
    const outcome = evaluateBatchMotion(next.pending, publicView);
    if (outcome.verdict === 'animate') {
      return { state: { ...next, pending: null, plan: outcome.plan }, plan: outcome.plan };
    }
    if (outcome.verdict === 'none') {
      // Unsupported-only or unattributable batch: clear the attributes honestly.
      return { state: { ...next, pending: null, plan: null }, plan: null };
    }
    // await-projection: keep waiting; the next projection re-evaluates.
  }
  return { state: next, plan: next.plan };
}

/** Visible textual origin stamp for a public discard; `null` stays unlabeled. */
export function discardOriginLabel(
  origin: 'PLAYED' | 'FORCED_PLAY' | 'ELIMINATION_REVEAL',
): string | null {
  switch (origin) {
    case 'FORCED_PLAY':
      return 'Forced face up';
    case 'ELIMINATION_REVEAL':
      return 'Revealed by elimination';
    default:
      return null;
  }
}

/** Zone-level motion (exchange pulses, actor settle) for one player's zone. */
export function zoneMotionForPlayer(
  plan: ActiveMotion | null,
  playerId: string,
): ZoneMotion | null {
  if (plan === null) {
    return null;
  }
  if (plan.kind === 'hand-exchange') {
    return plan.playerIds.includes(playerId)
      ? { kind: 'hand-exchange', sequence: plan.sequence }
      : null;
  }
  if (plan.kind === 'effect-settle') {
    return plan.playerId === playerId ? { kind: 'effect-settle', sequence: plan.sequence } : null;
  }
  return null;
}

/** Draw-settle motion for one player's destination hand zone. */
export function handMotionForPlayer(
  plan: ActiveMotion | null,
  playerId: string,
): ZoneMotion | null {
  if (plan === null || plan.kind !== 'draw-settle' || plan.playerId !== playerId) {
    return null;
  }
  return { kind: 'draw-settle', sequence: plan.sequence };
}

/** Landing/flip motion for one player's public discard surface. */
export function discardMotionForPlayer(
  plan: ActiveMotion | null,
  playerId: string,
): DiscardMotion | null {
  if (
    plan === null ||
    (plan.kind !== 'card-landing' && plan.kind !== 'card-flip') ||
    plan.playerId !== playerId
  ) {
    return null;
  }
  return { kind: plan.kind, sequence: plan.sequence };
}

/** The table-level shuffle cue, when the plan is a HANDS_REDEALT gather. */
export function tableShuffleMotion(plan: ActiveMotion | null): ZoneMotion | null {
  return plan !== null && plan.kind === 'hand-shuffle'
    ? { kind: 'hand-shuffle', sequence: plan.sequence }
    : null;
}
