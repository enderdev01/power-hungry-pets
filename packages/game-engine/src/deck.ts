import type { CardInstance } from './models';
import { randomInt, type Rng } from './rng';

/** Returns a shuffled copy using the deterministic Fisher–Yates algorithm. */
export function shuffleDeck(deck: readonly CardInstance[], rng: Rng): CardInstance[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(rng, index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}
