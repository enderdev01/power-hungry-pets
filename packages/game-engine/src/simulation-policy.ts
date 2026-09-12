/**
 * Deterministic legal-action policy and reproducible RNG stream derivation
 * (Milestone 5 work unit 3; engine spec §15–§16).
 *
 * `selectLegalAction` is the complete player policy of the simulation runner:
 * given the current round state and a policy RNG, it chooses exactly one
 * canonical action out of `getLegalActions` (work unit 1) with exactly one RNG
 * draw. Legality, canonical ordering, and every legality seam stay
 * single-sourced in `getLegalActions`; this module only reduces that list.
 *
 * Randomness separation: the runner derives two independent `SeededRng`
 * streams from one input seed — the engine stream (deck shuffling, the random
 * starter of every round, and card-effect randomness such as Card 7) and the
 * policy stream (one draw per action decision). Streams are derived
 * reproducibly from `(seed, streamName)` through a deterministic FNV-1a-style
 * hash plus an avalanche mix, so the derivation is a pure function of the
 * seed and the stable stream name. Because the two streams never share
 * state, changing how actions are selected can never perturb engine, deck, or
 * card-effect randomness, and every full match replays identically from one
 * seed.
 */
import { getLegalActions } from './legal-actions';
import type { PlayerId, RoundState } from './models';
import { randomInt, SeededRng } from './rng';
import type { Rng } from './rng';
import type { TurnCommand } from './turn-engine';

/** Stable stream names used by the simulation runner. */
export const ENGINE_STREAM = 'engine';
export const POLICY_STREAM = 'policy';

/** Stable error codes raised by the action-selection policy. */
export type SimulationPolicyErrorCode = 'NO_LEGAL_ACTIONS';

/** Typed error raised when the policy is asked to act with no legal action. */
export class SimulationPolicyError extends Error {
  readonly code: SimulationPolicyErrorCode;

  constructor(code: SimulationPolicyErrorCode, message: string) {
    super(message);
    this.name = 'SimulationPolicyError';
    this.code = code;
    // Keep `instanceof` reliable when TypeScript downlevels the class.
    Object.setPrototypeOf(this, SimulationPolicyError.prototype);
  }
}

/**
 * Derive a reproducible, independent RNG stream from the input seed and a
 * stable stream name. The same `(seed, streamName)` pair always yields the
 * same sequence; different names or seeds yield independent sequences.
 */
export function createRngStream(seed: number, streamName: string): SeededRng {
  return new SeededRng(deriveStreamSeed(seed, streamName));
}

/**
 * Deterministic FNV-1a-style hash of the stream name seeded with the input
 * seed, finished with a Murmur-style avalanche mix so that small seed or name
 * changes spread across the full 32-bit output.
 */
function deriveStreamSeed(seed: number, streamName: string): number {
  let hash = (seed >>> 0) ^ 0x811c9dc5;
  for (let index = 0; index < streamName.length; index += 1) {
    hash = Math.imul(hash ^ streamName.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * Choose exactly one canonical legal action for the actor (defaults to the
 * round's current player, which also covers open pending interactions) using
 * exactly one RNG draw over `getLegalActions`' canonical order. Throws the
 * typed `SimulationPolicyError` with code `NO_LEGAL_ACTIONS` when the actor
 * has no legal action — ended rounds, wrong/unknown/eliminated actors, and
 * otherwise impossible states included. The input state is never mutated.
 */
export function selectLegalAction(round: RoundState, rng: Rng, actorId?: PlayerId): TurnCommand {
  const actions = getLegalActions(round, actorId);
  if (actions.length === 0) {
    throw new SimulationPolicyError(
      'NO_LEGAL_ACTIONS',
      `No legal action exists for actor ${actorId ?? round.currentPlayerId} in round status ${round.status}`,
    );
  }
  return actions[randomInt(rng, actions.length)];
}
