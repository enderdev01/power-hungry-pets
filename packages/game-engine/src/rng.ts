export interface Rng {
  next(): number;
}

/** A deterministic Mulberry32 pseudo-random number generator for engine tests and setup. */
export class SeededRng implements Rng {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }
}

export function randomInt(rng: Rng, upperExclusive: number): number {
  if (!Number.isInteger(upperExclusive) || upperExclusive <= 0) {
    throw new Error('upperExclusive must be a positive integer');
  }

  return Math.floor(rng.next() * upperExclusive);
}
