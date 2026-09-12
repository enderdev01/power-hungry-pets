import type { MatchState, PlayerId } from './models';
import type { Rng } from './rng';

export interface FirstPlayerPolicyContext {
  match: MatchState;
  playerIds: readonly PlayerId[];
  rng: Rng;
}

export type FirstPlayerPolicy = (context: FirstPlayerPolicyContext) => PlayerId;

/** Temporary default from the open-questions document; replace when official rules are decided. */
export const randomFirstPlayerPolicy: FirstPlayerPolicy = ({ playerIds, rng }) => {
  return playerIds[Math.floor(rng.next() * playerIds.length)];
};
