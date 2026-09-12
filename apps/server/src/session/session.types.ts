/**
 * Typed domain contracts for the in-memory authoritative game-session
 * aggregate (Milestone 6 server work unit 3).
 *
 * Snapshots are plain deep copies of engine-canonical state: safe to hand to any
 * caller and never aliased with session internals.
 */
import type { MatchState, RoundState, TurnErrorCode } from '@power-hungry-pets/game-engine';
import type { PublicEvent } from '../projection/public-events';
import type { GameSessionErrorCode } from './session.errors';

/**
 * Produces the nonnegative integer seed from which a session's engine RNG
 * stream is derived. Called exactly once per started session.
 */
export type SeedFactory = () => number;

/** Injectable seams used by tests; production defaults are crypto-strong. */
export interface GameSessionOptions {
  /**
   * Nonnegative seed factory. Must return an integer `>= 0`; any other value
   * rejects the start with `INVALID_SEED` before any state is created.
   */
  seedFactory?: SeedFactory;
}

/**
 * Read-only, deep-copied view of one live session's authoritative state:
 * the match plus the live round (or `null` between rounds / after match end)
 * and the retained last ended round (or `null` before the first round ends).
 */
export interface GameSessionSnapshot {
  roomCode: string;
  roomId: string;
  match: MatchState;
  round: RoundState | null;
  lastRound: RoundState | null;
}

/** Successful authoritative command outcome with gateway-facing metadata. */
export interface GameSessionSuccess {
  ok: true;
  /** Sanitized public events emitted by the command, in emission order. */
  events: PublicEvent[];
  /** True when the command ended a round and a new round was auto-set-up. */
  roundAdvanced: boolean;
  /** True when the command ended the whole match. */
  matchEnded: boolean;
}

/**
 * Rejected command outcome with typed error details. `engineCode` carries the
 * engine's own `TurnErrorCode` when and only when the rejection came from the
 * engine (error `ENGINE_REJECTED`); session-level rejections use `null`.
 */
export interface GameSessionRejection {
  ok: false;
  error: GameSessionErrorCode;
  engineCode: TurnErrorCode | null;
  message: string;
}

export type HandleCommandResult = GameSessionSuccess | GameSessionRejection;
