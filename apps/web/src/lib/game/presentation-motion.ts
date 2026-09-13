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

/** The one-shot status-channel motion kinds (persistent table states). */
export type StatusMotionKind = 'token-settle' | 'protection-settle' | 'protection-expire';

/**
 * One addressed status motion: one kind for one resolved public seat. A
 * batch's status plan carries one of these per supporting cue, so a batch
 * with a protection activation for one player and an expiry for another
 * preserves BOTH supporting cues — no single-status precedence ever drops
 * one — and a token award never structurally precludes another status cue.
 */
export interface StatusMotion {
  kind: StatusMotionKind;
  sequence: number;
  playerId: string;
}

/**
 * The status-channel plan of one batch: every confirmed status motion, in
 * batch order, all stamped with the batch's sequence. `null` is motionless.
 */
export interface StatusPlan {
  sequence: number;
  motions: StatusMotion[];
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
  /**
   * Addressed seat's public victoryTokens per seat, captured when the batch
   * arrived. A TOKEN_AWARDED cue animates only once the authoritative
   * projection's committed count actually differs from this pre-cue value —
   * a stale count never cues, exactly like a draw's handCount gate.
   */
  preTokens: Record<string, number> | null;
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
  /** The active status-channel plan (tokens, protection); `null` is motionless. */
  statusPlan: StatusPlan | null;
}

/** What one batch resolved to against the current projection. */
export type BatchMotionOutcome =
  | { verdict: 'animate'; plan: ActiveMotion }
  | { verdict: 'await-projection' }
  | { verdict: 'none' };

/**
 * What one batch resolved to on the status channel. `animate` means every
 * supported status cue resolved to motion; `await-projection` may carry a
 * partial plan — the cues that already confirmed animate while the rest of
 * the batch keeps waiting.
 */
export type BatchStatusOutcome =
  | { verdict: 'animate'; plan: StatusPlan }
  | { verdict: 'await-projection'; plan: StatusPlan | null }
  | { verdict: 'none' };

/** Truthful starting state: nothing observed, nothing pending, motionless. */
export function initialMotionConsumerState(): MotionConsumerState {
  return { cursor: { sequence: 0 }, pending: null, plan: null, statusPlan: null };
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

/**
 * The public victoryTokens of every resolvable seat, captured at the moment a
 * cue batch arrives — before the batch's own projection lands. `null` when no
 * projection has arrived yet, so a token award can never be confirmed without
 * evidence.
 */
function capturedVictoryTokens(publicView: PublicGameView | null): Record<string, number> | null {
  if (publicView === null || !Array.isArray(publicView.players)) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const player of publicView.players) {
    if (
      player !== null &&
      typeof player === 'object' &&
      typeof player.id === 'string' &&
      typeof player.victoryTokens === 'number' &&
      Number.isFinite(player.victoryTokens)
    ) {
      counts[player.id] = player.victoryTokens;
    }
  }
  return counts;
}

/** The player's public victoryTokens, or `null` when the seat is unresolvable. */
function tokenCountOf(publicView: PublicGameView | null, playerId: string): number | null {
  if (publicView === null || !Array.isArray(publicView.players)) {
    return null;
  }
  const player = publicView.players.find((candidate) => candidate?.id === playerId);
  const count = player?.victoryTokens;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
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
/** Whether the seat's public projection currently carries the persistent protected state. */
function isProtected(publicView: PublicGameView | null, playerId: string): boolean {
  if (publicView === null || !Array.isArray(publicView.players)) {
    return false;
  }
  const player = publicView.players.find((candidate) => candidate?.id === playerId);
  return player?.protected === true;
}

/**
 * Maps one consumed batch onto its authoritative STATUS motions for the
 * persistent table states: protection activation/expiry and victory-token
 * awards. Every supported status cue of the batch resolves INDEPENDENTLY, so a
 * batch that carries a protection activation for one player and an expiry for
 * another keeps BOTH supporting cues — the old single-status precedence that
 * let the newest cue erase the rest is gone — and a token award never
 * structurally precludes another status cue. The card-channel scan
 * (evaluateBatchMotion) never consults these cues, so a status cue can never
 * steal the focal card moment, and a card cue can never be displaced by a
 * status cue. At most one focal CARD cue exists; the status channel is not
 * focal-limited because each cue addresses its own persistent surface.
 *
 * Token awards gate on the authoritative projection exactly like a draw:
 * the addressed seat's public victoryTokens must actually differ from the
 * pre-cue count captured on batch arrival. An award the projection never
 * confirms (event-before-projection with a stale count, a projection-only
 * reconnect) stays motionless — never an optimistic cue. Protection cues
 * verify against the projection's persistent state: an activation animates
 * only once the projection shows the persistent protected state, and an
 * expiry animates only once the projection has dropped it — so the cue is
 * always one-shot and never leaves a false persistent marker behind.
 *
 * Every cue fails closed: unresolvable seats are dropped (never a raw id),
 * and each supported cue either animates once or keeps its batch waiting.
 */
export function evaluateBatchStatusMotion(
  batch: PendingMotionBatch,
  publicView: PublicGameView | null,
): BatchStatusOutcome {
  if (batch === null || !Array.isArray(batch.cues)) {
    return { verdict: 'none' };
  }
  const sequence = batch.sequence;
  const motions: StatusMotion[] = [];
  let awaitingAny = false;
  for (const cue of batch.cues) {
    if (cue === null || typeof cue !== 'object') {
      continue;
    }
    switch (cue.kind) {
      case 'token-awarded': {
        // One settle per awarded seat, in first-seen order: repeated awards in
        // one batch are one moment on one rack, never a doubled pulse.
        if (motions.some((m) => m.kind === 'token-settle' && m.playerId === cue.playerId)) {
          break;
        }
        // Unresolvable seat: dropped fail-closed so no raw id is ever attributed.
        if (!resolvePlayer(publicView, cue.playerId)) {
          break;
        }
        // Gate on the authoritative projected count change, exactly like a
        // draw's handCount confirmation: no captured pre-cue count, or a
        // projection still showing the stale count, can never confirm.
        const preTokens = isPreCounts(batch.preTokens) ? batch.preTokens : null;
        const preCount = preTokens !== null ? preTokens[cue.playerId] : undefined;
        if (typeof preCount !== 'number') {
          awaitingAny = true;
          break;
        }
        const current = tokenCountOf(publicView, cue.playerId);
        if (current === null || current === preCount) {
          awaitingAny = true;
          break;
        }
        motions.push({ kind: 'token-settle', sequence, playerId: cue.playerId });
        break;
      }
      case 'protection-activated': {
        if (!resolvePlayer(publicView, cue.playerId)) {
          break;
        }
        if (!isProtected(publicView, cue.playerId)) {
          awaitingAny = true;
          break;
        }
        motions.push({ kind: 'protection-settle', sequence, playerId: cue.playerId });
        break;
      }
      case 'protection-expired': {
        if (!resolvePlayer(publicView, cue.playerId)) {
          break;
        }
        if (isProtected(publicView, cue.playerId)) {
          awaitingAny = true;
          break;
        }
        motions.push({ kind: 'protection-expire', sequence, playerId: cue.playerId });
        break;
      }
      default:
        break;
    }
  }
  if (motions.length === 0 && !awaitingAny) {
    return { verdict: 'none' };
  }
  if (awaitingAny) {
    return {
      verdict: 'await-projection',
      plan: motions.length > 0 ? { sequence, motions } : null,
    };
  }
  return { verdict: 'animate', plan: { sequence, motions } };
}

/**
 * The table's motion transition for one render observation: consumes newly
 * arrived cue batches (newest batch wins over a still-waiting one), resolves
 * the pending batch against the current projection, and returns the plans to
 * render. Batches are identified only by the monotonic sequence — never by the
 * bounded cue log's length — so motion keeps working after the log saturates.
 * A sequence reset — a cleared game or a reconnect — collapses everything to
 * motionless instead of replaying stale cues.
 */
export function advanceMotionConsumer(
  state: MotionConsumerState,
  cueState: MotionCueState,
  publicView: PublicGameView | null,
): { state: MotionConsumerState; plan: ActiveMotion | null; statusPlan: StatusPlan | null } {
  const safeCueState =
    cueState !== null &&
    typeof cueState === 'object' &&
    typeof cueState.sequence === 'number' &&
    Number.isFinite(cueState.sequence) &&
    Array.isArray(cueState.cues)
      ? cueState
      : { sequence: 0, cues: [], lastBatch: null };

  // A reset (the sequence moved backwards) is never motion: reconnects and
  // cleared games restart motionless, on both channels.
  if (safeCueState.sequence < state.cursor.sequence) {
    return {
      state: {
        cursor: { sequence: safeCueState.sequence },
        pending: null,
        plan: null,
        statusPlan: null,
      },
      plan: null,
      statusPlan: null,
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
        // Remember the pre-cue public snapshots so a card-drawn cue can wait
        // for the addressed player's projected handCount to actually change,
        // and a TOKEN_AWARDED cue can wait for the projected victoryTokens
        // to actually differ — both fail closed without a snapshot.
        preCounts: capturedHandCounts(publicView),
        preTokens: capturedVictoryTokens(publicView),
      },
      plan: state.plan,
      statusPlan: state.statusPlan,
    };
  }

  let plan = next.plan;
  let statusPlan = next.statusPlan;
  let awaiting = false;
  if (next.pending !== null) {
    // Both channels resolve from the same pending batch; either channel still
    // awaiting its destination keeps the batch pending, while any channel
    // that already resolved updates its plan immediately.
    const cardOutcome = evaluateBatchMotion(next.pending, publicView);
    const statusOutcome = evaluateBatchStatusMotion(next.pending, publicView);
    if (cardOutcome.verdict === 'animate') {
      plan = cardOutcome.plan;
    } else if (cardOutcome.verdict === 'none') {
      // Unsupported-only or unattributable card batch: clear the plan honestly.
      plan = null;
    } else {
      awaiting = true;
    }
    if (statusOutcome.verdict === 'animate') {
      statusPlan = statusOutcome.plan;
    } else if (statusOutcome.verdict === 'none') {
      statusPlan = null;
    } else {
      awaiting = true;
      // A partially confirmed batch already animates its confirmed cues
      // while the rest keep the batch waiting for their own destinations.
      if (statusOutcome.plan !== null && statusOutcome.plan !== undefined) {
        statusPlan = statusOutcome.plan;
      }
    }
    if (!awaiting) {
      next = { ...next, pending: null };
    }
  }
  return { state: { ...next, plan, statusPlan }, plan, statusPlan };
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

/** One-shot token-award motion for one player's rack; `null` stays motionless. */
export function tokenMotionForPlayer(
  statusPlan: StatusPlan | null,
  playerId: string,
): { kind: StatusMotionKind; sequence: number } | null {
  if (statusPlan === null || !Array.isArray(statusPlan.motions)) {
    return null;
  }
  const motion = statusPlan.motions.find(
    (candidate) => candidate?.kind === 'token-settle' && candidate?.playerId === playerId,
  );
  return motion !== undefined ? { kind: motion.kind, sequence: motion.sequence } : null;
}

/**
 * One-shot protection motion (activation settle, expiry clear) for one
 * player's status surface; `null` stays motionless.
 */
export function protectionMotionForPlayer(
  statusPlan: StatusPlan | null,
  playerId: string,
): { kind: Exclude<StatusMotionKind, 'token-settle'>; sequence: number } | null {
  if (statusPlan === null || !Array.isArray(statusPlan.motions)) {
    return null;
  }
  const motion = statusPlan.motions.find(
    (candidate) =>
      (candidate?.kind === 'protection-settle' || candidate?.kind === 'protection-expire') &&
      candidate?.playerId === playerId,
  );
  return motion !== undefined
    ? { kind: motion.kind as Exclude<StatusMotionKind, 'token-settle'>, sequence: motion.sequence }
    : null;
}

/** The table-level shuffle cue, when the plan is a HANDS_REDEALT gather. */
export function tableShuffleMotion(plan: ActiveMotion | null): ZoneMotion | null {
  return plan !== null && plan.kind === 'hand-shuffle'
    ? { kind: 'hand-shuffle', sequence: plan.sequence }
    : null;
}
