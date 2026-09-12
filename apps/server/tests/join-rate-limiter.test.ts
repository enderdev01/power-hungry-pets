import { JoinRateLimitError, JoinRateLimiter } from '../src/gateway/join-rate-limiter';

describe('JoinRateLimiter', () => {
  it('allows up to the configured attempt count and rejects the next with a typed error', () => {
    const now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 3, now: () => now });

    limiter.consume('socket-a');
    limiter.consume('socket-a');
    limiter.consume('socket-a');

    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);
    try {
      limiter.consume('socket-a');
      throw new Error('expected JoinRateLimitError');
    } catch (error) {
      expect(error).toBeInstanceOf(JoinRateLimitError);
      const limited = error as JoinRateLimitError;
      expect(limited.retryAfterMs).toBe(60_000);
      expect(limited.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('admits the key again once the bounded window has passed', () => {
    let now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 2, now: () => now });

    limiter.consume('socket-a');
    limiter.consume('socket-a');
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);

    now = 61_001;
    expect(() => limiter.consume('socket-a')).not.toThrow();
    // The new window holds its own budget: two more attempts, then rejection.
    expect(() => limiter.consume('socket-a')).not.toThrow();
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);
  });

  it('reports a retry horizon inside the remaining window, not the full window', () => {
    let now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 2, now: () => now });

    limiter.consume('socket-a');
    now = 20_000;
    limiter.consume('socket-a');

    try {
      limiter.consume('socket-a');
      throw new Error('expected JoinRateLimitError');
    } catch (error) {
      const limited = error as JoinRateLimitError;
      // Oldest attempt at 1_000 expires at 61_000, i.e. 41_000ms from now.
      expect(limited.retryAfterMs).toBe(41_000);
    }
  });

  it('counts every attempt independently, including one whose caller fails afterwards', () => {
    let now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 2, now: () => now });

    limiter.consume('socket-a');
    // The caller's downstream operation rejects, but the attempt was counted.
    now = 2_000;
    limiter.consume('socket-a');
    now = 3_000;
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);
  });

  it('isolates keys so one exhausted connection never blocks another', () => {
    const now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 1, now: () => now });

    limiter.consume('socket-a');
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);
    expect(() => limiter.consume('socket-b')).not.toThrow();
    expect(() => limiter.consume('socket-c')).not.toThrow();
  });

  it('uses deterministic production defaults (60s window, 8 attempts) injectable for tests', () => {
    const limiter = new JoinRateLimiter();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(() => limiter.consume('socket-a')).not.toThrow();
    }
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);
  });

  it('forget removes a key so its next window starts with a full budget', () => {
    const now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 2, now: () => now });

    limiter.consume('socket-a');
    limiter.consume('socket-a');
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);

    limiter.forget('socket-a');
    // The clock is frozen at 1_000, so only state removal — never window
    // expiry — can explain the restored budget.
    expect(() => limiter.consume('socket-a')).not.toThrow();
    expect(() => limiter.consume('socket-a')).not.toThrow();
    expect(() => limiter.consume('socket-a')).toThrow(JoinRateLimitError);
  });

  it('forget is a no-op for an unknown key and removes only the target key', () => {
    const now = 1_000;
    const limiter = new JoinRateLimiter({ windowMs: 60_000, maxAttempts: 1, now: () => now });

    limiter.consume('socket-a');
    limiter.consume('socket-b');

    expect(() => limiter.forget('socket-never-seen')).not.toThrow();
    limiter.forget('socket-a');

    // The forgotten key restarts with a full budget; every other key keeps
    // its exact recorded state.
    expect(() => limiter.consume('socket-a')).not.toThrow();
    expect(() => limiter.consume('socket-b')).toThrow(JoinRateLimitError);
  });
});
