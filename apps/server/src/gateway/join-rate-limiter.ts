/**
 * Minimal deterministic rate limiter for `room:join` attempts
 * (multiplayer spec §14 anti-cheat baseline: rate-limit room join attempts).
 *
 * Keying decision: the gateway keys this limiter per socket connection
 * (`socket.id`), not per remote address. Rationale:
 * - One socket id is one client connection at the gateway boundary, so the
 *   limiter bounds per-connection join spam deterministically (including
 *   malformed/invalid joins, which are counted before any payload validation).
 * - It is testable without network topology: every real client socket gets a
 *   fresh key, so gateway suites stay hermetic.
 * - Per-address limiting belongs at the transport/proxy layer, where the real
 *   client address can be trusted; a future work unit can reuse this class
 *   with an address key unchanged.
 *
 * Scope: join attempts only. It never touches gameplay (`game:command`,
 * `room:start`, `room:leave`) on an already-bound socket, and it intentionally
 * implements no room TTL or token expiry.
 */
export interface JoinRateLimiterOptions {
  /** Sliding-window length in milliseconds. Default: 60_000. */
  windowMs?: number;
  /** Maximum accepted attempts per key per window. Default: 8. */
  maxAttempts?: number;
  /** Injectable monotonic clock (epoch ms) for deterministic tests. */
  now?: () => number;
}

/** Typed rejection raised when a key exceeds its attempt budget. */
export class JoinRateLimitError extends Error {
  /** Milliseconds until the oldest attempt in the window expires. */
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`room:join rate limit exceeded; retry after ${retryAfterMs}ms`);
    this.name = 'JoinRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

interface RateLimiterConfig {
  windowMs: number;
  maxAttempts: number;
  now: () => number;
}

export class JoinRateLimiter {
  private readonly config: RateLimiterConfig;
  /** key -> accepted attempt timestamps inside the current window. */
  private readonly attempts = new Map<string, number[]>();

  constructor(options: JoinRateLimiterOptions = {}) {
    this.config = {
      windowMs: options.windowMs ?? 60_000,
      maxAttempts: options.maxAttempts ?? 8,
      now: options.now ?? Date.now,
    };
  }

  /**
   * Counts one join attempt for `key` and throws {@link JoinRateLimitError}
   * when the bounded budget for the window is already exhausted. Malformed and
   * invalid joins are counted exactly like successful ones, because this is
   * called before any payload validation at the gateway boundary.
   */
  consume(key: string): void {
    const now = this.config.now();
    const windowStart = now - this.config.windowMs;
    const stamps = (this.attempts.get(key) ?? []).filter((at) => at > windowStart);

    if (stamps.length >= this.config.maxAttempts) {
      const oldest = stamps[0]!;
      throw new JoinRateLimitError(Math.max(oldest + this.config.windowMs - now, 0));
    }

    stamps.push(now);
    this.attempts.set(key, stamps);
  }

  /**
   * Drops every recorded attempt for `key`. The gateway calls this when a
   * socket disconnects so finished connection ids cannot accumulate limiter
   * state forever; if the key ever reappears it starts with a full budget.
   * Unknown keys are ignored.
   */
  forget(key: string): void {
    this.attempts.delete(key);
  }
}
