/**
 * Complete match simulation runner (Milestone 5 work unit 3; engine spec §16,
 * implementation plan Milestone 5 "seeded simulation runner").
 *
 * The runner hosts the existing engine unchanged: it creates a match, then
 * repeatedly sets up rounds and drives them — through the canonical
 * legal-action generator and the deterministic one-draw action policy — until
 * every round reaches ROUND_END, applies round results until MATCH_END, and
 * asserts invariants around every transition:
 *
 * - after match creation and every applied round result (`assertMatchInvariants`);
 * - after round setup, every successful command, and every ended round
 *   (`assertRoundInvariants`).
 *
 * Starter policy decision: every round chooses a random starter through the
 * server/engine RNG (`randomFirstPlayerPolicy` by default, injectable through
 * `firstPlayerPolicy` without changing setup); previous winners never
 * influence the starter.
 *
 * Randomness separation: engine randomness (deck shuffle, starter, card
 * effects such as Card 7) comes from the `engine` stream; the action policy
 * consumes exactly one draw from the `policy` stream per command decision.
 * Both streams derive reproducibly from the input seed (see
 * `simulation-policy.ts`), so identical seed/config always replays a
 * deep-equal match, and action-selection changes can never perturb engine,
 * deck, or card-effect randomness.
 *
 * Failure discipline: a generated action that the turn engine rejects, and an
 * empty legal-action list (no legal action / deadlock) while a round is
 * active, both raise the typed `SimulationError` immediately — the runner
 * never retries, mutates around, or hides an engine rejection. Round and
 * per-round command budgets are configurable; exhausting one ends the run
 * gracefully with the matching termination mode.
 */
import { assertMatchInvariants, assertRoundInvariants } from './invariants';
import { applyRoundResult } from './match-rules';
import type { MatchRulesEvent } from './match-rules';
import type { MatchState, PlayerId, PlayerInput, RoundState } from './models';
import { createMatchState, setupRound } from './setup';
import type { Rng } from './rng';
import {
  createRngStream,
  ENGINE_STREAM,
  POLICY_STREAM,
  selectLegalAction,
  SimulationPolicyError,
} from './simulation-policy';
import type { FirstPlayerPolicy } from './turn-order';
import { applyTurnCommand } from './turn-engine';
import type { TurnCommand, TurnEngineDependencies, TurnEvent, TurnErrorCode } from './turn-engine';

/** Stable error codes raised by the simulation runner. */
export type SimulationErrorCode =
  'INVALID_RUNNER_INPUT' | 'NO_LEGAL_ACTIONS' | 'GENERATED_ACTION_REJECTED';

/**
 * Typed error raised by the simulation runner: invalid run input, a
 * legal-action deadlock, or a generated action rejected by the turn engine.
 */
export class SimulationError extends Error {
  readonly code: SimulationErrorCode;
  /** The turn-engine rejection code, when the failure came from a command. */
  readonly engineErrorCode?: TurnErrorCode;
  /** The rejected command, when the failure came from a command. */
  readonly command?: TurnCommand;

  constructor(
    code: SimulationErrorCode,
    message: string,
    options?: { engineErrorCode?: TurnErrorCode; command?: TurnCommand },
  ) {
    super(message);
    this.name = 'SimulationError';
    this.code = code;
    this.engineErrorCode = options?.engineErrorCode;
    this.command = options?.command;
    // Keep `instanceof` reliable when TypeScript downlevels the class.
    Object.setPrototypeOf(this, SimulationError.prototype);
  }
}

/** Budgets that bound every run; both must be positive integers. */
export interface MatchRunnerConfig {
  /** Maximum number of rounds to set up and drive. */
  maxRounds: number;
  /** Maximum number of commands accepted per round. */
  maxCommandsPerRound: number;
}

export const DEFAULT_MATCH_RUNNER_CONFIG: Readonly<MatchRunnerConfig> = Object.freeze({
  maxRounds: 1_000,
  maxCommandsPerRound: 1_000,
});

/** Why the simulation stopped. Budget exhaustion is graceful, not an error. */
export type MatchTerminationMode =
  'MATCH_END' | 'ROUND_BUDGET_EXCEEDED' | 'COMMAND_BUDGET_EXCEEDED';

/** Per-round deterministic summary. */
export interface RoundSimulationSummary {
  readonly roundNumber: number;
  /** The player the engine RNG handed the round to at setup. */
  readonly starterId: PlayerId;
  readonly winners: readonly PlayerId[];
  readonly commandCount: number;
  readonly eventCount: number;
}

/** Deterministic, immutable-enough top-level run summary. */
export interface MatchSimulationSummary {
  readonly seed: number;
  readonly matchId: string;
  readonly playerCount: number;
  readonly terminationMode: MatchTerminationMode;
  readonly matchStatus: MatchState['status'];
  /** Winners at MATCH_END; empty otherwise. */
  readonly winners: readonly PlayerId[];
  readonly roundsPlayed: number;
  readonly rounds: readonly RoundSimulationSummary[];
  readonly totalCommands: number;
  /** Transcript-wide event count, including events from partial rounds. */
  readonly totalEvents: number;
  readonly config: Readonly<MatchRunnerConfig>;
}

/** One command applied during a round, with its public events. */
export interface CommandTranscriptEntry {
  readonly kind: 'COMMAND';
  readonly roundNumber: number;
  readonly command: TurnCommand;
  readonly events: readonly TurnEvent[];
}

/** One applied round result. */
export interface RoundResultTranscriptEntry {
  readonly kind: 'ROUND_RESULT';
  readonly roundNumber: number;
  readonly starterId: PlayerId;
  readonly winners: readonly PlayerId[];
  readonly events: readonly MatchRulesEvent[];
}

export type SimulationTranscriptEntry = CommandTranscriptEntry | RoundResultTranscriptEntry;

export interface MatchSimulationResult {
  readonly summary: MatchSimulationSummary;
  readonly transcript: readonly SimulationTranscriptEntry[];
}

/** Runner input: either generated players (`playerCount`) or explicit `players`. */
export interface MatchRunnerInput {
  readonly seed: number;
  /** Explicit roster (2–6 unique ids); mutually exclusive with `playerCount`. */
  readonly players?: readonly PlayerInput[];
  /** Generated roster size (2–6); mutually exclusive with `players`. */
  readonly playerCount?: number;
  /** Defaults to a seed-derived id so runs stay reproducible. */
  readonly matchId?: string;
  readonly config?: Partial<MatchRunnerConfig>;
  /**
   * First-player seam forwarded to `setupRound` unchanged; defaults to the
   * engine's `randomFirstPlayerPolicy`, so every round draws a fresh starter
   * from the engine stream and previous winners never influence it.
   */
  readonly firstPlayerPolicy?: FirstPlayerPolicy;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/**
 * Run a complete deterministic match and return its frozen summary and
 * transcript. Same seed and config produce deep-equal output.
 */
export function runMatch(input: MatchRunnerInput): MatchSimulationResult {
  const { seed, roster, matchId, config, firstPlayerPolicy } = resolveRunnerInput(input);

  const engineRng = createRngStream(seed, ENGINE_STREAM);
  const policyRng = createRngStream(seed, POLICY_STREAM);
  const dependencies: TurnEngineDependencies = { rng: engineRng };

  let match = createMatchState({ matchId, players: roster });
  assertMatchInvariants(match);

  const transcript: SimulationTranscriptEntry[] = [];
  const rounds: RoundSimulationSummary[] = [];
  let totalCommands = 0;
  let terminationMode: MatchTerminationMode = 'MATCH_END';

  while (match.status !== 'MATCH_END') {
    if (rounds.length >= config.maxRounds) {
      terminationMode = 'ROUND_BUDGET_EXCEEDED';
      break;
    }

    let round = setupRound(match, engineRng, firstPlayerPolicy);
    assertRoundInvariants(round);
    const starterId = round.currentPlayerId;

    let commandCount = 0;
    let roundEvents = 0;
    while (round.status === 'ROUND_ACTIVE') {
      if (commandCount >= config.maxCommandsPerRound) {
        terminationMode = 'COMMAND_BUDGET_EXCEEDED';
        break;
      }

      // The pending interaction pauses the turn on its actor, who is also the
      // current player (engine invariant); pick the actor the state owes.
      const actorId = round.pendingInteraction?.actorId ?? round.currentPlayerId;
      const command = selectCommandOrThrow(round, policyRng, actorId);

      const result = applyTurnCommand(round, command, dependencies);
      if (!result.ok) {
        throw new SimulationError(
          'GENERATED_ACTION_REJECTED',
          `Generated action ${JSON.stringify(command)} was rejected by the turn engine with ${result.error}`,
          { engineErrorCode: result.error, command },
        );
      }
      assertRoundInvariants(result.state);

      transcript.push(
        deepFreeze({
          kind: 'COMMAND' as const,
          roundNumber: round.roundNumber,
          command,
          events: result.events,
        }),
      );
      round = result.state;
      commandCount += 1;
      totalCommands += 1;
      roundEvents += result.events.length;
    }
    if (round.status !== 'ROUND_END') {
      // Only the command budget can leave a set-up round unfinished.
      break;
    }
    assertRoundInvariants(round);

    const applied = applyRoundResult(match, round);
    assertMatchInvariants(applied.match);
    transcript.push(
      deepFreeze({
        kind: 'ROUND_RESULT' as const,
        roundNumber: round.roundNumber,
        starterId,
        winners: round.winners,
        events: applied.events,
      }),
    );
    rounds.push(
      deepFreeze({
        roundNumber: round.roundNumber,
        starterId,
        winners: round.winners,
        commandCount,
        eventCount: roundEvents + applied.events.length,
      }),
    );
    match = applied.match;
  }

  const summary: MatchSimulationSummary = deepFreeze({
    seed,
    matchId,
    playerCount: match.players.length,
    terminationMode,
    matchStatus: match.status,
    winners: match.winners,
    roundsPlayed: rounds.length,
    rounds,
    totalCommands,
    totalEvents: transcript.reduce((sum, entry) => sum + entry.events.length, 0),
    config,
  });

  return deepFreeze({ summary, transcript });
}

/** Select one action, surfacing an empty legal-action list as a deadlock. */
function selectCommandOrThrow(round: RoundState, policyRng: Rng, actorId: PlayerId): TurnCommand {
  try {
    return selectLegalAction(round, policyRng, actorId);
  } catch (error) {
    if (error instanceof SimulationPolicyError) {
      throw new SimulationError(
        'NO_LEGAL_ACTIONS',
        `Simulation deadlock: no legal action for actor ${actorId} at round ${round.roundNumber} (phase ${round.phase}, pending ${round.pendingInteraction?.type ?? 'none'})`,
      );
    }
    throw error;
  }
}

function resolveRunnerInput(input: MatchRunnerInput): {
  seed: number;
  roster: PlayerInput[];
  matchId: string;
  config: MatchRunnerConfig;
  firstPlayerPolicy: FirstPlayerPolicy | undefined;
} {
  const { seed, players, playerCount, matchId, config } = input;
  if (!Number.isInteger(seed) || seed < 0) {
    throw new SimulationError(
      'INVALID_RUNNER_INPUT',
      `seed must be a nonnegative integer, got ${String(seed)}`,
    );
  }
  if (players !== undefined && playerCount !== undefined) {
    throw new SimulationError(
      'INVALID_RUNNER_INPUT',
      'Provide either players or playerCount, not both',
    );
  }
  let roster: PlayerInput[];
  if (players !== undefined) {
    roster = validateExplicitRoster(players);
  } else if (playerCount !== undefined) {
    if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
      throw new SimulationError(
        'INVALID_RUNNER_INPUT',
        `playerCount must be an integer from ${MIN_PLAYERS} to ${MAX_PLAYERS}, got ${String(playerCount)}`,
      );
    }
    roster = generatePlayers(playerCount);
  } else {
    throw new SimulationError(
      'INVALID_RUNNER_INPUT',
      'Provide players or playerCount to run a match',
    );
  }

  const resolvedConfig: MatchRunnerConfig = {
    maxRounds: config?.maxRounds ?? DEFAULT_MATCH_RUNNER_CONFIG.maxRounds,
    maxCommandsPerRound:
      config?.maxCommandsPerRound ?? DEFAULT_MATCH_RUNNER_CONFIG.maxCommandsPerRound,
  };
  for (const [key, value] of Object.entries(resolvedConfig)) {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new SimulationError(
        'INVALID_RUNNER_INPUT',
        `config.${key} must be a positive integer, got ${String(value)}`,
      );
    }
  }

  return {
    seed,
    roster,
    matchId: matchId ?? `match-seed-${seed}`,
    config: resolvedConfig,
    firstPlayerPolicy: input.firstPlayerPolicy,
  };
}

/**
 * Validate and copy an explicit roster: 2–6 entries with unique nonempty string
 * ids. Every failure is normalized to the typed `INVALID_RUNNER_INPUT` error
 * instead of leaking an engine `createMatchState` Error, and the caller's array
 * and entries are copied, never referenced or mutated.
 */
function validateExplicitRoster(players: readonly PlayerInput[]): PlayerInput[] {
  if (!Array.isArray(players)) {
    throw new SimulationError(
      'INVALID_RUNNER_INPUT',
      `players must be an array of ${MIN_PLAYERS} to ${MAX_PLAYERS} player inputs`,
    );
  }
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new SimulationError(
      'INVALID_RUNNER_INPUT',
      `players must contain ${MIN_PLAYERS} to ${MAX_PLAYERS} entries, got ${players.length}`,
    );
  }
  const seenIds = new Set<string>();
  const roster: PlayerInput[] = [];
  players.forEach((player, index) => {
    if (typeof player !== 'object' || player === null) {
      throw new SimulationError(
        'INVALID_RUNNER_INPUT',
        `players[${index}] must be a player input object, got ${String(player)}`,
      );
    }
    if (typeof player.id !== 'string' || player.id.length === 0) {
      throw new SimulationError(
        'INVALID_RUNNER_INPUT',
        `players[${index}].id must be a nonempty string, got ${String(player.id)}`,
      );
    }
    if (seenIds.has(player.id)) {
      throw new SimulationError(
        'INVALID_RUNNER_INPUT',
        `players[${index}].id ${JSON.stringify(player.id)} is duplicated`,
      );
    }
    seenIds.add(player.id);
    roster.push({ ...player });
  });
  return roster;
}

/** Generated roster ids p1..pN with matching display names. */
function generatePlayers(playerCount: number): PlayerInput[] {
  return Array.from({ length: playerCount }, (_, index) => {
    const id = `p${index + 1}`;
    return { id, name: `Player ${index + 1}` };
  });
}

/** Freeze an object graph so the returned result stays immutable-enough. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const property of Object.values(value as Record<string, unknown>)) {
      if (property !== null && typeof property === 'object') {
        deepFreeze(property);
      }
    }
    Object.freeze(value);
  }
  return value;
}
