import type { MatchState, PlayerId } from './models';
import type { Rng } from './rng';

export interface FirstPlayerPolicyContext {
  match: MatchState;
  playerIds: readonly PlayerId[];
  rng: Rng;
}

export type FirstPlayerPolicy = (context: FirstPlayerPolicyContext) => PlayerId;

/**
 * Resolved M5 first-player policy: every round — including the first — draws
 * its starter with this policy through the injected engine RNG.
 */
export const randomFirstPlayerPolicy: FirstPlayerPolicy = ({ playerIds, rng }) => {
  return playerIds[Math.floor(rng.next() * playerIds.length)];
};
