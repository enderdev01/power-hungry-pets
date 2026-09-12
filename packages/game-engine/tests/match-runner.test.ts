/**
 * Milestone 5 work unit 3 — complete match simulation runner.
 *
 * Normative design under test:
 * - The runner drives full matches for generated (2–6) or explicit players:
 *   every round is set up through `setupRound` with the engine RNG stream, all
 *   pending stages are driven to ROUND_END with the deterministic legal-action
 *   policy, and round results are applied until MATCH_END or a configured
 *   budget is exhausted.
 * - Every round's starter is chosen through the server/engine RNG
 *   (`randomFirstPlayerPolicy` by default, injectable seam unchanged);
 *   previous winners never influence the starter.
 * - Round invariants are asserted after setup, after every successful
 *   command, and after each ended round; match invariants after creation and
 *   after every applied round result.
 * - A failed generated action or an empty legal-action list (deadlock) is a
 *   typed `SimulationError`, never a silent retry.
 * - Round and per-round command budgets are configurable; exceeding one ends
 *   the simulation with the matching termination mode.
 * - The returned summary/transcript is deterministic, deeply frozen, and
 *   deep-equal for identical seed/config.
 */
import * as invariantsModule from '../src/invariants';
import * as legalActionsModule from '../src/legal-actions';
import { DEFAULT_MATCH_RUNNER_CONFIG, runMatch } from '../src/match-runner';
import type { PlayerId, PlayerInput } from '../src';
import type { CommandTranscriptEntry, MatchSimulationResult } from '../src/match-runner';
import * as turnEngineModule from '../src/turn-engine';
import type { TurnCommand } from '../src/turn-engine';

const PLAYER_COUNTS = [2, 6];

const EXPLICIT_PLAYERS: PlayerInput[] = [
  { id: 'ana', name: 'Ana' },
  { id: 'bo', name: 'Bo' },
  { id: 'cy', name: 'Cy' },
];

function runAt(playerCount: number, seed: number): MatchSimulationResult {
  return runMatch({ seed, playerCount });
}

function allActorIds(result: MatchSimulationResult): PlayerId[] {
  return result.transcript
    .filter((entry): entry is CommandTranscriptEntry => entry.kind === 'COMMAND')
    .map((entry) => entry.command.actorId);
}

describe.each(PLAYER_COUNTS)('match runner with %i generated players', (playerCount) => {
  it('simulates a complete match to MATCH_END', () => {
    const result = runAt(playerCount, 42);

    expect(result.summary.terminationMode).toBe('MATCH_END');
    expect(result.summary.matchStatus).toBe('MATCH_END');
    expect(result.summary.seed).toBe(42);
    expect(result.summary.playerCount).toBe(playerCount);
    expect(result.summary.roundsPlayed).toBeGreaterThanOrEqual(1);
    expect(result.summary.rounds).toHaveLength(result.summary.roundsPlayed);
    expect(result.summary.winners.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalCommands).toBeGreaterThan(0);
    expect(result.summary.totalEvents).toBeGreaterThan(0);
  });

  it('records one deterministic transcript entry per command and per round result', () => {
    const result = runAt(playerCount, 42);

    const commandEntries = result.transcript.filter((entry) => entry.kind === 'COMMAND');
    const roundEntries = result.transcript.filter((entry) => entry.kind === 'ROUND_RESULT');

    expect(commandEntries).toHaveLength(result.summary.totalCommands);
    expect(roundEntries).toHaveLength(result.summary.roundsPlayed);

    for (const entry of commandEntries) {
      expect(entry.command.actorId).toBeDefined();
      expect(entry.roundNumber).toBeGreaterThanOrEqual(1);
    }
    for (const entry of roundEntries) {
      expect(entry.winners.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('never lets an actor act outside the roster', () => {
    const result = runAt(playerCount, 42);
    const roster = Array.from({ length: playerCount }, (_, index) => `p${index + 1}`);

    for (const actorId of allActorIds(result)) {
      expect(roster).toContain(actorId);
    }
  });

  it('applies a fresh starter for every round through the engine RNG', () => {
    const result = runAt(playerCount, 42);

    expect(result.summary.rounds.length).toBeGreaterThanOrEqual(1);
    for (const round of result.summary.rounds) {
      expect(round.starterId).toBeDefined();
      expect(round.winners.length).toBeGreaterThanOrEqual(1);
      expect(round.commandCount).toBeGreaterThan(0);
    }
  });
});

describe('match runner determinism', () => {
  it('produces deep-equal results for the same seed and config', () => {
    const first = runAt(3, 4242);
    const second = runAt(3, 4242);

    expect(second).toEqual(first);
  });

  it('produces different transcripts for different seeds', () => {
    const first = runAt(3, 4242);
    const second = runAt(3, 99);

    expect(second.transcript).not.toEqual(first.transcript);
  });
});

describe('match runner explicit player config', () => {
  it('simulates an explicitly configured roster', () => {
    const result = runMatch({ seed: 7, players: EXPLICIT_PLAYERS });

    expect(result.summary.playerCount).toBe(3);
    expect(result.summary.terminationMode).toBe('MATCH_END');
    const rosterIds = EXPLICIT_PLAYERS.map((player) => player.id);
    for (const actorId of allActorIds(result)) {
      expect(rosterIds).toContain(actorId);
    }
  });
});

describe('match runner first-player seam', () => {
  it('forwards the injected policy to setupRound without changing setup', () => {
    const lastListed = ({ playerIds }: { playerIds: readonly PlayerId[] }) =>
      playerIds[playerIds.length - 1];
    const result = runMatch({
      seed: 11,
      players: EXPLICIT_PLAYERS,
      firstPlayerPolicy: lastListed,
    });

    const firstCommand = result.transcript.find(
      (entry): entry is CommandTranscriptEntry => entry.kind === 'COMMAND',
    );
    expect(firstCommand?.command.actorId).toBe('cy');
    expect(result.summary.rounds[0]?.starterId).toBe('cy');
  });
});

describe('match runner guards', () => {
  it('rejects a playerCount below 2 with a typed error', () => {
    expect(() => runMatch({ seed: 1, playerCount: 1 })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects a playerCount above 6 with a typed error', () => {
    expect(() => runMatch({ seed: 1, playerCount: 7 })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects a run without players or playerCount', () => {
    expect(() => runMatch({ seed: 1 })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects ambiguous input with both players and playerCount', () => {
    expect(() => runMatch({ seed: 1, players: EXPLICIT_PLAYERS, playerCount: 3 })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('stops gracefully when the round budget is exhausted', () => {
    const result = runMatch({ seed: 42, playerCount: 2, config: { maxRounds: 1 } });

    expect(result.summary.terminationMode).toBe('ROUND_BUDGET_EXCEEDED');
    expect(result.summary.roundsPlayed).toBe(1);
    expect(result.summary.matchStatus).toBe('ROUND_END');
    expect(result.summary.winners).toEqual([]);
  });

  it('stops gracefully when the per-round command budget is exhausted', () => {
    const result = runMatch({
      seed: 42,
      playerCount: 2,
      config: { maxCommandsPerRound: 1 },
    });

    expect(result.summary.terminationMode).toBe('COMMAND_BUDGET_EXCEEDED');
    expect(result.summary.totalCommands).toBe(1);
  });
});

describe('match runner deadlock detection', () => {
  it('raises a typed NO_LEGAL_ACTIONS error when no legal action exists', () => {
    const legalActions = jest.spyOn(legalActionsModule, 'getLegalActions');
    legalActions.mockReturnValue([]);

    try {
      expect(() => runMatch({ seed: 42, playerCount: 2 })).toThrowError(
        expect.objectContaining({ name: 'SimulationError', code: 'NO_LEGAL_ACTIONS' }),
      );
    } finally {
      legalActions.mockRestore();
    }
  });
});

describe('match runner generated-action discipline', () => {
  it('replays a burst of seeds for every player count without invariant violations', () => {
    for (let playerCount = 2; playerCount <= 6; playerCount += 1) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const result = runMatch({ seed, playerCount });
        expect(result.summary.terminationMode).toBe('MATCH_END');
        expect(result.summary.winners.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('maps a generated-action rejection to GENERATED_ACTION_REJECTED with the engine code and command', () => {
    const originalApplyTurnCommand = turnEngineModule.applyTurnCommand;
    const spy = jest.spyOn(turnEngineModule, 'applyTurnCommand');
    let calls = 0;
    let rejectedCommand: TurnCommand | undefined;
    spy.mockImplementation((round, command, dependencies) => {
      calls += 1;
      if (calls === 2) {
        rejectedCommand = command;
        return { ok: false, error: 'NOT_YOUR_TURN', state: round };
      }
      return originalApplyTurnCommand(round, command, dependencies);
    });

    try {
      let thrown: unknown;
      try {
        runMatch({ seed: 42, playerCount: 2 });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        name: 'SimulationError',
        code: 'GENERATED_ACTION_REJECTED',
        engineErrorCode: 'NOT_YOUR_TURN',
      });
      expect((thrown as { command?: unknown }).command).toEqual(rejectedCommand);
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('match runner explicit roster guards', () => {
  it('rejects an explicit roster below 2 players with a typed error', () => {
    expect(() => runMatch({ seed: 1, players: [EXPLICIT_PLAYERS[0]] })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects an explicit roster above 6 players with a typed error', () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
    }));
    expect(() => runMatch({ seed: 1, players: seven })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects duplicate explicit player ids with a typed error', () => {
    const duplicated = [
      { id: 'ana', name: 'Ana' },
      { id: 'ana', name: 'Ana again' },
    ];
    expect(() => runMatch({ seed: 1, players: duplicated })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects an empty explicit player id with a typed error', () => {
    const emptyId = [
      { id: '', name: 'Ghost' },
      { id: 'bo', name: 'Bo' },
    ];
    expect(() => runMatch({ seed: 1, players: emptyId })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects a non-string explicit player id with a typed error', () => {
    const numericId = [
      { id: 3 as unknown as PlayerId, name: 'Three' },
      { id: 'bo', name: 'Bo' },
    ];
    expect(() => runMatch({ seed: 1, players: numericId })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('rejects a malformed explicit roster entry with a typed error', () => {
    const malformed = [null as unknown as PlayerInput, { id: 'bo', name: 'Bo' }];
    expect(() => runMatch({ seed: 1, players: malformed })).toThrowError(
      expect.objectContaining({ name: 'SimulationError', code: 'INVALID_RUNNER_INPUT' }),
    );
  });

  it('leaves the caller-provided roster untouched', () => {
    const players: PlayerInput[] = [
      { id: 'ana', name: 'Ana' },
      { id: 'bo', name: 'Bo' },
    ];
    const snapshot = JSON.stringify(players);

    runMatch({ seed: 7, players });

    expect(JSON.stringify(players)).toBe(snapshot);
  });
});

describe('match runner event accounting', () => {
  it('counts totalEvents as the transcript-wide event total on MATCH_END', () => {
    const result = runMatch({ seed: 42, playerCount: 2 });

    expect(result.summary.terminationMode).toBe('MATCH_END');
    expect(result.summary.totalEvents).toBe(transcriptEventTotal(result));
    expect(result.summary.totalEvents).toBeGreaterThan(0);
  });

  it('counts totalEvents across the partial round when COMMAND_BUDGET_EXCEEDED', () => {
    const result = runMatch({
      seed: 42,
      playerCount: 2,
      config: { maxCommandsPerRound: 1 },
    });

    expect(result.summary.terminationMode).toBe('COMMAND_BUDGET_EXCEEDED');
    expect(result.transcript).toHaveLength(1);
    expect(result.summary.totalEvents).toBe(transcriptEventTotal(result));
    expect(result.summary.totalEvents).toBeGreaterThan(0);
  });
});

describe('match runner immutability', () => {
  it('freezes DEFAULT_MATCH_RUNNER_CONFIG at runtime', () => {
    expect(Object.isFrozen(DEFAULT_MATCH_RUNNER_CONFIG)).toBe(true);
  });

  it('returns a deeply frozen summary and transcript', () => {
    const result = runMatch({ seed: 42, playerCount: 2, config: { maxRounds: 1 } });

    expectDeeplyFrozen(result);
  });

  it('returns a deeply frozen summary and transcript on the budget path too', () => {
    const result = runMatch({
      seed: 42,
      playerCount: 2,
      config: { maxCommandsPerRound: 1 },
    });

    expectDeeplyFrozen(result);
  });
});

describe('match runner default starter policy', () => {
  it('replays the same starter sequence for the same seed', () => {
    const first = runMatch({ seed: 4242, playerCount: 3 });
    const second = runMatch({ seed: 4242, playerCount: 3 });

    expect(second.summary.rounds.map((round) => round.starterId)).toEqual(
      first.summary.rounds.map((round) => round.starterId),
    );
  });

  it('does not inherit the previous round winners by default', () => {
    let foundIndependentStarter = false;
    for (let seed = 1; seed <= 50 && !foundIndependentStarter; seed += 1) {
      const result = runMatch({ seed, playerCount: 3 });
      for (let index = 1; index < result.summary.rounds.length; index += 1) {
        const previousWinners = result.summary.rounds[index - 1].winners;
        const starterId = result.summary.rounds[index].starterId;
        if (!previousWinners.includes(starterId)) {
          foundIndependentStarter = true;
          break;
        }
      }
    }

    expect(foundIndependentStarter).toBe(true);
  });
});

describe('match runner invariant assertions', () => {
  it('asserts round invariants after setup, every command, and round end', () => {
    const roundSpy = jest.spyOn(invariantsModule, 'assertRoundInvariants');
    const matchSpy = jest.spyOn(invariantsModule, 'assertMatchInvariants');
    try {
      const result = runMatch({ seed: 42, playerCount: 2, config: { maxRounds: 1 } });

      expect(result.summary.terminationMode).toBe('ROUND_BUDGET_EXCEEDED');
      expect(result.summary.roundsPlayed).toBe(1);
      // match creation plus the one applied round result
      expect(matchSpy).toHaveBeenCalledTimes(2);
      // setup plus every successful command plus the ended round
      expect(roundSpy).toHaveBeenCalledTimes(result.summary.totalCommands + 2);
    } finally {
      roundSpy.mockRestore();
      matchSpy.mockRestore();
    }
  });

  it('asserts invariants on the full MATCH_END path too', () => {
    const roundSpy = jest.spyOn(invariantsModule, 'assertRoundInvariants');
    const matchSpy = jest.spyOn(invariantsModule, 'assertMatchInvariants');
    try {
      const result = runMatch({ seed: 42, playerCount: 2 });

      expect(result.summary.terminationMode).toBe('MATCH_END');
      // match creation plus one applied round result per played round
      expect(matchSpy).toHaveBeenCalledTimes(1 + result.summary.roundsPlayed);
      // setup plus every successful command plus every ended round
      expect(roundSpy).toHaveBeenCalledTimes(
        result.summary.roundsPlayed * 2 + result.summary.totalCommands,
      );
    } finally {
      roundSpy.mockRestore();
      matchSpy.mockRestore();
    }
  });

  it('asserts invariants on the partial-round command-budget path too', () => {
    const roundSpy = jest.spyOn(invariantsModule, 'assertRoundInvariants');
    const matchSpy = jest.spyOn(invariantsModule, 'assertMatchInvariants');
    try {
      const result = runMatch({
        seed: 42,
        playerCount: 2,
        config: { maxCommandsPerRound: 1 },
      });

      expect(result.summary.terminationMode).toBe('COMMAND_BUDGET_EXCEEDED');
      // match creation only; no round result is applied
      expect(matchSpy).toHaveBeenCalledTimes(1);
      // setup plus the single successful command
      expect(roundSpy).toHaveBeenCalledTimes(2);
    } finally {
      roundSpy.mockRestore();
      matchSpy.mockRestore();
    }
  });
});

function transcriptEventTotal(result: MatchSimulationResult): number {
  return result.transcript.reduce((sum, entry) => sum + entry.events.length, 0);
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child);
  }
}
