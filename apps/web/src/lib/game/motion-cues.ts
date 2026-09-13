/**
 * Motion-cue seam (M8 Work Unit 1): reducer-owned, projection-authoritative
 * animation cues derived from sanitized GamePublicEvent batches.
 *
 * Cues are pure derivations of one atomic `game:event` batch: only already
 * public fields (player ids, published card values/types) are carried, and no
 * cue ever carries instance identity, guesses, indexes, swap choices, or
 * inferred card identity/targets. Events whose evidence the current M8 slice
 * does not need (Pecera resolution, exhaustion reveals, round/match end) are
 * unsupported here and produce no cue — so an unsupported-only batch cannot
 * create false motion.
 *
 * The layer fails closed: unknown event types, malformed payloads, non-array
 * batches, or a malformed previous state never throw; they simply produce no
 * cue. Cards are re-built field by field so any runtime extras (such as an
 * instance id) are stripped before the cue can be seen by presentation.
 */
import type { GamePublicEvent, PublicCard } from '@power-hungry-pets/protocol';

/** Maximum number of motion cues retained, mirroring the event-feed bound. */
export const MOTION_CUE_LOG_LIMIT = 20;

/** One typed, presentation-safe animation cue derived from a public event. */
export type MotionCue =
  | { kind: 'card-drawn'; playerId: string }
  | { kind: 'card-played'; playerId: string; card: PublicCard }
  | { kind: 'card-forced-face-up'; playerId: string; card: PublicCard }
  | { kind: 'hands-redealt' }
  | { kind: 'hands-swapped'; playerIds: [string, string] }
  | { kind: 'private-effect-resolved'; effect: 'SAQUEADOG' | 'RATON'; playerId: string }
  | { kind: 'protection-activated'; playerId: string }
  | { kind: 'protection-expired'; playerId: string }
  | { kind: 'player-eliminated'; playerId: string }
  | { kind: 'token-awarded'; playerId: string };

/**
 * Reducer-owned motion-cue state: a monotonic sequence that advances exactly
 * once per accepted cue-bearing batch, a bounded list of recent cues, and the
 * newest batch's own cues. Consumers identify the newest batch by the monotonic
 * sequence — never by the bounded array's length — so motion survives the log
 * saturating.
 */
export interface MotionCueState {
  /** Monotonic batch counter; 0 until the first cue-bearing batch. */
  sequence: number;
  /** Recent cues in arrival order; oldest dropped once the bound is exceeded. */
  cues: MotionCue[];
  /**
   * The cues of the most recent cue-bearing batch, stamped with the sequence it
   * advanced to. `null` until the first cue-bearing batch; a batch without a
   * supported cue leaves it unchanged.
   */
  lastBatch: MotionCueBatch | null;
}

/** The cues of exactly one accepted batch, stamped with its own sequence. */
export interface MotionCueBatch {
  sequence: number;
  cues: MotionCue[];
}

/** Truthful starting state: no motion has been announced yet. */
export function createInitialMotionCueState(): MotionCueState {
  return { sequence: 0, cues: [], lastBatch: null };
}

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
]);

function isPublicCard(value: unknown): value is PublicCard {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { value?: unknown }).value !== 'number' ||
    !Number.isFinite((value as { value?: unknown }).value) ||
    typeof (value as { type?: unknown }).type !== 'string'
  ) {
    return false;
  }
  return CARD_TYPES.has((value as { type?: string }).type ?? '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Maps one sanitized public event onto its public cue, or `null` when the
 * event is unsupported, unknown, or malformed. Only published fields survive:
 * cards are copied field by field so instance identity can never ride along.
 */
function toCue(event: unknown): MotionCue | null {
  if (!isPlainObject(event)) {
    return null;
  }
  const playerId = event.playerId;
  switch (event.type) {
    case 'CARD_DRAWN':
      return typeof playerId === 'string' ? { kind: 'card-drawn', playerId } : null;
    case 'CARD_PLAYED':
      return typeof playerId === 'string' && isPublicCard(event.card)
        ? {
            kind: 'card-played',
            playerId,
            card: { value: event.card.value, type: event.card.type },
          }
        : null;
    case 'CARD_FORCED_FACE_UP':
      return typeof playerId === 'string' && isPublicCard(event.card)
        ? {
            kind: 'card-forced-face-up',
            playerId,
            card: { value: event.card.value, type: event.card.type },
          }
        : null;
    case 'HANDS_REDEALT':
      return { kind: 'hands-redealt' };
    case 'HANDS_SWAPPED': {
      const playerIds = event.playerIds;
      if (
        Array.isArray(playerIds) &&
        playerIds.length === 2 &&
        typeof playerIds[0] === 'string' &&
        typeof playerIds[1] === 'string'
      ) {
        return { kind: 'hands-swapped', playerIds: [playerIds[0], playerIds[1]] };
      }
      return null;
    }
    case 'SAQUEADOG_RESOLVED':
    case 'RATON_RESOLVED':
      return typeof playerId === 'string'
        ? {
            kind: 'private-effect-resolved',
            effect: event.type === 'SAQUEADOG_RESOLVED' ? 'SAQUEADOG' : 'RATON',
            playerId,
          }
        : null;
    case 'PLAYER_PROTECTED':
      return typeof playerId === 'string' ? { kind: 'protection-activated', playerId } : null;
    case 'PROTECTION_EXPIRED':
      return typeof playerId === 'string' ? { kind: 'protection-expired', playerId } : null;
    case 'PLAYER_ELIMINATED':
      return typeof playerId === 'string' ? { kind: 'player-eliminated', playerId } : null;
    case 'TOKEN_AWARDED':
      return typeof playerId === 'string' ? { kind: 'token-awarded', playerId } : null;
    default:
      // Unsupported or unknown event: fail closed, no false motion.
      return null;
  }
}

function isMotionCueBatch(value: unknown): value is MotionCueBatch {
  return (
    isPlainObject(value) &&
    typeof value.sequence === 'number' &&
    Number.isFinite(value.sequence) &&
    Array.isArray(value.cues)
  );
}

function isMotionCueState(value: unknown): value is MotionCueState {
  return (
    isPlainObject(value) &&
    typeof value.sequence === 'number' &&
    Number.isFinite(value.sequence) &&
    Array.isArray(value.cues) &&
    (value.lastBatch == null || isMotionCueBatch(value.lastBatch))
  );
}

/**
 * The game reducer's motion-cue transition for one atomic `game/events` batch:
 * the sequence advances exactly once when the batch carries at least one
 * supported cue, the bounded cue list absorbs the new cues, and the newest
 * batch's own cues are stamped with the sequence they advanced to. A batch with
 * no supported cue (unsupported-only, empty, or malformed) returns the
 * previous state unchanged so no false motion is announced. Never throws.
 */
export function deriveMotionCues(prev: MotionCueState, events: GamePublicEvent[]): MotionCueState {
  const base = isMotionCueState(prev) ? prev : createInitialMotionCueState();
  if (!Array.isArray(events)) {
    return base;
  }
  const cues: MotionCue[] = [];
  for (const event of events) {
    const cue = toCue(event);
    if (cue !== null) {
      cues.push(cue);
    }
  }
  if (cues.length === 0) {
    return base;
  }
  const sequence = base.sequence + 1;
  return {
    sequence,
    cues: [...base.cues, ...cues].slice(-MOTION_CUE_LOG_LIMIT),
    // The batch snapshot is stamped with its own sequence so consumers can
    // always resolve the newest batch by sequence, even after the bounded
    // log saturates and starts dropping old entries.
    lastBatch: { sequence, cues },
  };
}
