/**
 * In-memory authoritative game-session aggregate (Milestone 6 server work
 * unit 3; multiplayer spec §§5,6,8; engine spec §§9,15,16,21).
 *
 * One session per room code. A session owns exactly one per-session engine RNG
 * stream — derived from an injected/default nonnegative seed factory through
 * `createRngStream(seed, ENGINE_STREAM)` — and passes it to `setupRound` and
 * every `applyTurnCommand`, so Card 7's random re-deal is always safe and every
 * session replays deterministically from its seed.
 *
 * Command processing (engine spec §8): `handleCommand` rejects actor spoofing
 * before the engine ever sees the command, then delegates semantic validation
 * to the pure `applyTurnCommand`. The engine never mutates its input and
 * failures return the input state unchanged, so a rejection cannot partially
 * mutate the session; typed error details are returned, not thrown.
 *
 * After a successful command the session asserts engine invariants before
 * committing. On ROUND_END it immediately applies `applyRoundResult`, then
 * either auto-sets-up the next round with a random starter drawn from the same
 * engine RNG (match continues) or retains the ended round for reveal/discard
 * projection (match ended).
 *
 * Projections compose engine views over deep copies whose transport
 * connectivity is overlaid from a RoomSnapshot by player id; the authoritative
 * engine state is never mutated by projecting.
 */
import { randomBytes } from 'node:crypto';
import {
  applyRoundResult,
  applyTurnCommand,
  assertMatchInvariants,
  assertRoundInvariants,
  createMatchState,
  createRngStream,
  ENGINE_STREAM,
  getPlayerPrivateView,
  getPublicGameView,
  type GameSnapshot,
  type MatchRulesEvent,
  type MatchState,
  type PrivateGameView,
  type PublicGameView,
  type RoundState,
  type Rng,
  type TurnCommand,
  type TurnErrorCode,
  setupRound,
} from '@power-hungry-pets/game-engine';
import { sanitizePublicEvents } from '../projection/public-events';
import type { RoomSnapshot } from '../room/room.types';
import { GameSessionError, GameSessionErrorCode } from './session.errors';
import type {
  GameSessionOptions,
  GameSessionSnapshot,
  HandleCommandResult,
  SeedFactory,
} from './session.types';
import { MAX_SEATS_PER_ROOM, MIN_SEATS_TO_START_MATCH } from '../room/room.types';

/** Default seed: 32 crypto-random bits, always nonnegative. */
const DEFAULT_SEED_FACTORY: SeedFactory = () => randomBytes(4).readUInt32BE(0);

/** Normalizes a room code for lookup: trim + uppercase (registry convention). */
function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Deep copy of JSON-safe canonical state; keeps session internals unaliased. */
function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Transactional RNG view over the session's one underlying engine stream:
 * every command runs against a checkpointed wrapper. Values consumed during a
 * transaction are buffered; if the command's post-engine validation or
 * sanitization throws, `rewindToCheckpoint` queues those values for replay, so
 * a retry draws the identical sequence and deterministically produces the same
 * outcome as a fresh session with the same seed. A committed transaction
 * simply keeps the advanced underlying stream. One per-session stream is
 * preserved — the wrapper never forks or replaces it.
 */
class CheckpointedRng implements Rng {
  private readonly underlying: Rng;
  /** Values queued for replay after a rollback (empty during normal draws). */
  private replay: number[] = [];
  /** Values consumed since the current transaction's checkpoint. */
  private buffer: number[] = [];

  constructor(underlying: Rng) {
    this.underlying = underlying;
  }

  next(): number {
    if (this.replay.length > 0) {
      const replayed = this.replay.shift() as number;
      this.buffer.push(replayed);
      return replayed;
    }
    const value = this.underlying.next();
    this.buffer.push(value);
    return value;
  }

  /**
   * Opens the transaction: the stream's next values are buffered, so
   * `rewindToCheckpoint` can requeue exactly what this command consumed. Any
   * replay queue pending from an earlier rollback is preserved for retry.
   */
  beginTransaction(): void {
    this.buffer = [];
  }

  /**
   * Rolls the stream back to the transaction checkpoint: draws consumed since
   * `beginTransaction` become the replay queue for the retry. Returns the
   * number of logically discarded (re-queued) draws.
   */
  rewindToCheckpoint(): number {
    const discarded = this.buffer.length;
    // This command's draws (replayed or fresh) go back to the front of the
    // queue, ahead of any still-pending replay tail from older rollbacks.
    this.replay = [...this.buffer, ...this.replay];
    this.buffer = [];
    return discarded;
  }

  /** Commits the transaction: consumed draws are permanent and never replayed. */
  commitTransaction(): void {
    this.buffer = [];
  }
}

interface SessionRecord {
  roomId: string;
  match: MatchState;
  round: RoundState | null;
  lastRound: RoundState | null;
  /** The one checkpointed, transactional engine RNG stream owned by this session. */
  rng: CheckpointedRng;
}

export class GameSessionService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly seedFactory: SeedFactory;

  constructor(options: GameSessionOptions = {}) {
    this.seedFactory = options.seedFactory ?? DEFAULT_SEED_FACTORY;
  }

  /**
   * Starts the one session for the room code from the room's seat roster.
   * Requires the room to be in LOBBY status (the guarded pre-match state),
   * a 2-6 seat roster with unique non-blank identities, and a fresh code.
   */
  startSession(room: RoomSnapshot): GameSessionSnapshot {
    const roomCode = normalizeRoomCode(room.code);
    if (roomCode.length === 0) {
      throw new GameSessionError(GameSessionErrorCode.InvalidRoomCode, 'room code is blank');
    }
    if (this.sessions.has(roomCode)) {
      throw new GameSessionError(
        GameSessionErrorCode.SessionAlreadyExists,
        `a session is already running for room ${roomCode}`,
      );
    }
    if (room.status !== 'LOBBY') {
      throw new GameSessionError(
        GameSessionErrorCode.InvalidRoomStatus,
        `a match can only start from a LOBBY room, got ${room.status}`,
      );
    }
    const seats = room.players;
    if (seats.length < MIN_SEATS_TO_START_MATCH || seats.length > MAX_SEATS_PER_ROOM) {
      throw new GameSessionError(
        GameSessionErrorCode.InvalidRoster,
        `a match needs ${MIN_SEATS_TO_START_MATCH}-${MAX_SEATS_PER_ROOM} seats, got ${seats.length}`,
      );
    }
    if (new Set(seats.map((seat) => seat.playerId)).size !== seats.length) {
      throw new GameSessionError(
        GameSessionErrorCode.InvalidRoster,
        'seat player ids must be unique',
      );
    }
    if (seats.some((seat) => seat.displayName.trim().length === 0)) {
      throw new GameSessionError(
        GameSessionErrorCode.InvalidRoster,
        'seat display names must be non-blank',
      );
    }

    const seed = this.seedFactory();
    if (!Number.isInteger(seed) || seed < 0) {
      throw new GameSessionError(
        GameSessionErrorCode.InvalidSeed,
        'seed factory must produce a nonnegative integer seed',
      );
    }

    const match = createMatchState({
      matchId: room.roomId,
      players: seats.map((seat) => ({ id: seat.playerId, name: seat.displayName })),
    });
    assertMatchInvariants(match);
    const rng = new CheckpointedRng(createRngStream(seed, ENGINE_STREAM));
    const round = setupRound(match, rng);
    assertRoundInvariants(round);
    const record: SessionRecord = { roomId: room.roomId, match, round, lastRound: null, rng };
    this.sessions.set(roomCode, record);
    return this.snapshotOf(roomCode, record);
  }

  /** Snapshot copy for a live session, or `undefined` when unknown. */
  getSnapshot(roomCode: string): GameSessionSnapshot | undefined {
    const record = this.sessions.get(normalizeRoomCode(roomCode));
    return record === undefined ? undefined : this.snapshotOf(roomCode, record);
  }

  /**
   * Authoritative command processing for one session (engine spec §8): spoofing
   * is rejected before the engine; semantic validation is delegated to the pure
   * `applyTurnCommand` with the session's checkpointed engine RNG; rejections
   * mutate nothing and return typed error details.
   *
   * Successes are fully transactional across authoritative state and public
   * events: every candidate event is sanitized BEFORE any commit, and only a
   * completely validated result (post-engine round/match invariants, ROUND_END
   * resolution, auto-setup) is written to the record in one step. Any thrown
   * post-engine failure leaves the session state unchanged and rewinds the RNG
   * stream to its pre-command checkpoint, so a retry deterministically produces
   * the same outcome as a fresh session with the same seed; a successful
   * transaction advances the one underlying stream normally.
   */
  handleCommand(
    roomCode: string,
    authenticatedPlayerId: string,
    command: TurnCommand,
  ): HandleCommandResult {
    const record = this.sessions.get(normalizeRoomCode(roomCode));
    if (record === undefined) {
      return this.rejection(
        GameSessionErrorCode.SessionNotFound,
        null,
        `no live game session for room ${roomCode}`,
      );
    }
    if (command.actorId !== authenticatedPlayerId) {
      return this.rejection(
        GameSessionErrorCode.ActorNotAuthenticated,
        null,
        `command actor ${command.actorId} does not match the authenticated player ${authenticatedPlayerId}`,
      );
    }
    if (record.round === null) {
      return this.rejection(
        GameSessionErrorCode.NoActiveRound,
        null,
        `no active round is attached to room ${roomCode}`,
      );
    }

    record.rng.beginTransaction();
    try {
      const result = applyTurnCommand(record.round, command, { rng: record.rng });
      if (!result.ok) {
        // The engine rejection is a normal, typed outcome (not a thrown
        // failure): the engine leaves the input state unchanged by contract,
        // and this command's RNG draws are simply discarded.
        return this.rejection(
          GameSessionErrorCode.EngineRejected,
          result.error,
          `engine rejected the command with ${result.error}`,
        );
      }

      const nextRound = result.state;
      assertRoundInvariants(nextRound);

      let match = record.match;
      let liveRound: RoundState | null = nextRound;
      let lastRound = record.lastRound;
      let roundAdvanced = false;
      let matchEnded = false;
      const matchEvents: MatchRulesEvent[] = [];

      if (nextRound.status === 'ROUND_END') {
        const resolution = applyRoundResult(match, nextRound);
        match = resolution.match;
        matchEvents.push(...resolution.events);
        assertMatchInvariants(match);
        lastRound = nextRound;
        if (match.status === 'MATCH_END') {
          liveRound = null;
          matchEnded = true;
        } else {
          // Random starter drawn from the same per-session engine RNG stream.
          liveRound = setupRound(match, record.rng);
          assertRoundInvariants(liveRound);
          roundAdvanced = true;
        }
      }

      // Sanitize ALL candidate events BEFORE committing any state, so a
      // sanitizer failure cannot leave a half-applied transaction behind.
      const events = sanitizePublicEvents([...result.events, ...matchEvents]);

      // Commit point: everything above validated; the transaction's RNG
      // draws become permanent and the state publishes atomically.
      record.rng.commitTransaction();
      record.match = match;
      record.round = liveRound;
      record.lastRound = lastRound;
      return { ok: true, events, roundAdvanced, matchEnded };
    } catch (error) {
      // Any thrown post-engine validation/sanitization failure aborts the
      // transaction: authoritative state is untouched (writes happen only at
      // the commit point above) and the RNG stream rewinds so a retry
      // deterministically replays the same outcome.
      record.rng.rewindToCheckpoint();
      throw error;
    }
  }

  /**
   * Drops the live session for a room code (minimal seam for future empty-room
   * cleanup). Code normalization matches the other lookups; returns whether a
   * session existed and was removed. Snapshots already handed out remain valid
   * deep copies.
   */
  deleteSession(roomCode: string): boolean {
    return this.sessions.delete(normalizeRoomCode(roomCode));
  }

  /**
   * Public game view with the room snapshot's transport connectivity overlaid
   * onto deep copies of the match and live round by player id.
   */
  getPublicView(roomCode: string, room: RoomSnapshot): PublicGameView {
    return getPublicGameView(this.overlayedSnapshot(roomCode, room));
  }

  /**
   * Private view of one rostered player with the same connectivity overlay.
   * A viewer outside the roster fails closed with the engine's
   * `ProjectionError` code `PLAYER_NOT_IN_GAME`.
   */
  getPrivateView(roomCode: string, playerId: string, room: RoomSnapshot): PrivateGameView {
    return getPlayerPrivateView(this.overlayedSnapshot(roomCode, room), playerId);
  }

  // -- internals --------------------------------------------------------------

  private overlayedSnapshot(roomCode: string, room: RoomSnapshot): GameSnapshot {
    const record = this.requireSession(roomCode);
    const connected = new Map(room.players.map((seat) => [seat.playerId, seat.connected]));

    const match = deepCopy(record.match);
    for (const player of match.players) {
      const overlay = connected.get(player.id);
      if (overlay !== undefined) {
        player.connected = overlay;
      }
    }

    let round: RoundState | null = null;
    if (record.round !== null) {
      round = deepCopy(record.round);
      for (const player of round.players) {
        const overlay = connected.get(player.id);
        if (overlay !== undefined) {
          player.connected = overlay;
        }
      }
    }

    return { match, round };
  }

  private requireSession(roomCode: string): SessionRecord {
    const record = this.sessions.get(normalizeRoomCode(roomCode));
    if (record === undefined) {
      throw new GameSessionError(
        GameSessionErrorCode.SessionNotFound,
        `no live game session for room ${roomCode}`,
      );
    }
    return record;
  }

  private snapshotOf(roomCode: string, record: SessionRecord): GameSessionSnapshot {
    return {
      roomCode: normalizeRoomCode(roomCode),
      roomId: record.roomId,
      match: deepCopy(record.match),
      round: record.round === null ? null : deepCopy(record.round),
      lastRound: record.lastRound === null ? null : deepCopy(record.lastRound),
    };
  }

  private rejection(
    error: GameSessionErrorCode,
    engineCode: TurnErrorCode | null,
    message: string,
  ): HandleCommandResult {
    return { ok: false, error, engineCode, message };
  }
}
