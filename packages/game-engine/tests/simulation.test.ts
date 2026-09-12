/**
 * Milestone 5 work unit 4 — deterministic >=1,000-match simulation corpus.
 *
 * Normative design under test:
 * - The seeded simulation runner (`runMatch`) drives complete matches for every
 *   generated player count 2–6 to MATCH_END with winners, over a deterministic
 *   corpus of stable seeds distributed across player counts.
 * - Transcript accounting is coherent everywhere: one COMMAND entry per applied
 *   command, one ROUND_RESULT entry per ended round, per-round command and
 *   event counts matching the summary, and round numbers consecutive.
 * - No run throws a `SimulationError`, turn-engine rejection, or invariant
 *   failure: any throw escapes the corpus with a diagnostic including seed and
 *   playerCount.
 * - Both round-end paths occur across the corpus: at least one exhaustion
 *   reveal round (HANDS_REVEALED during the round's commands) and at least one
 *   last-survivor round (ROUND_RESULT with no HANDS_REVEALED in that round).
 * - Determinism is verified by bounded replay of representative samples (deep
 *   equality on the full result), not by doubling the whole corpus.
 *
 * The corpus size comes from `SIMULATION_MATCH_COUNT` (positive integer,
 * default 1000) so CI can shrink or grow the corpus deliberately.
 */
import { runMatch } from '../src/match-runner';
import type { MatchSimulationResult, RoundResultTranscriptEntry } from '../src/match-runner';

const DEFAULT_MATCH_COUNT = 1_000;
/** Stable base so corpus seeds never collide with ad-hoc test seeds. */
const CORPUS_SEED_BASE = 1_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
/** Player counts the corpus visits deterministically: 2..MAX_PLAYERS. */
const PLAYER_COUNT_SPREAD = MAX_PLAYERS - MIN_PLAYERS + 1;
/** Generous ceiling for slow CI; the measured corpus runs in seconds. */
const CORPUS_TIMEOUT_MS = 120_000;

/** Resolve the corpus size: unset/blank env falls back to 1000. */
function resolveMatchCount(): number {
  const raw = process.env.SIMULATION_MATCH_COUNT;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MATCH_COUNT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `SIMULATION_MATCH_COUNT must be a positive integer, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

/** Deterministic player count for corpus index i. */
function playerCountForIndex(index: number): number {
  return MIN_PLAYERS + (index % PLAYER_COUNT_SPREAD);
}

/** Deterministic stable seed for corpus index i. */
function seedForIndex(index: number): number {
  return CORPUS_SEED_BASE + index;
}

/**
 * Run one corpus match, annotating any throw (SimulationError, engine
 * rejection, invariant failure) with the seed and player count.
 */
function runCorpusMatch(playerCount: number, seed: number): MatchSimulationResult {
  try {
    return runMatch({ seed, playerCount });
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Simulation run failed (seed=${seed}, playerCount=${playerCount}): ${detail}`);
  }
}

interface CorpusRun {
  readonly index: number;
  readonly seed: number;
  readonly playerCount: number;
  readonly result: MatchSimulationResult;
}

/** Roster ids for a generated player count (p1..pN). */
function rosterFor(playerCount: number): string[] {
  return Array.from({ length: playerCount }, (_, index) => `p${index + 1}`);
}

/** Per-round flags: whether that round saw a HANDS_REVEALED event. */
function roundSawHandsRevealed(result: MatchSimulationResult): Map<number, boolean> {
  const revealed = new Map<number, boolean>();
  for (const entry of result.transcript) {
    if (entry.kind !== 'COMMAND') {
      continue;
    }
    for (const event of entry.events) {
      if (event.type === 'HANDS_REVEALED') {
        revealed.set(entry.roundNumber, true);
      }
    }
  }
  return revealed;
}

function roundResultEntries(result: MatchSimulationResult): RoundResultTranscriptEntry[] {
  return result.transcript.filter(
    (entry): entry is RoundResultTranscriptEntry => entry.kind === 'ROUND_RESULT',
  );
}

describe('deterministic simulation corpus', () => {
  const matchCount = resolveMatchCount();
  const corpus: CorpusRun[] = [];

  beforeAll(() => {
    for (let index = 0; index < matchCount; index += 1) {
      const playerCount = playerCountForIndex(index);
      const seed = seedForIndex(index);
      corpus.push({ index, seed, playerCount, result: runCorpusMatch(playerCount, seed) });
    }
  }, CORPUS_TIMEOUT_MS);

  it('runs the configured corpus size (default 1000, all MATCH_END with winners)', () => {
    expect(corpus).toHaveLength(matchCount);
    if (matchCount < DEFAULT_MATCH_COUNT) {
      console.warn(`simulation corpus reduced by SIMULATION_MATCH_COUNT=${matchCount}`);
    }

    for (const run of corpus) {
      const { result, seed, playerCount } = run;
      const summary = result.summary;
      expect(summary.terminationMode).toBe('MATCH_END');
      expect(summary.matchStatus).toBe('MATCH_END');
      expect(summary.seed).toBe(seed);
      expect(summary.playerCount).toBe(playerCount);
      expect(summary.roundsPlayed).toBeGreaterThanOrEqual(1);
      expect(summary.rounds).toHaveLength(summary.roundsPlayed);
      expect(summary.totalCommands).toBeGreaterThan(0);
      expect(summary.totalEvents).toBeGreaterThan(0);

      const roster = rosterFor(playerCount);
      expect(summary.winners.length).toBeGreaterThanOrEqual(1);
      for (const winnerId of summary.winners) {
        expect(roster).toContain(winnerId);
      }
      expect(new Set(summary.winners).size).toBe(summary.winners.length);
    }
  });

  it('keeps transcript accounting coherent for every run', () => {
    for (const run of corpus) {
      // The annotated runner already proved no throw; summary checks below are
      // per-run accounting, not seed/playerCount assertions (covered above).
      const { result } = run;
      const summary = result.summary;

      const commandEntries = result.transcript.filter((entry) => entry.kind === 'COMMAND');
      const roundEntries = roundResultEntries(result);
      expect(commandEntries).toHaveLength(summary.totalCommands);
      expect(roundEntries).toHaveLength(summary.roundsPlayed);
      expect(summary.roundsPlayed).toBeGreaterThanOrEqual(1);

      // Round numbers are consecutive and match the summary order.
      for (let roundIndex = 0; roundIndex < summary.rounds.length; roundIndex += 1) {
        const round = summary.rounds[roundIndex]!;
        expect(round.roundNumber).toBe(roundIndex + 1);
      }
      roundEntries.forEach((entry, index) => {
        expect(entry.roundNumber).toBe(index + 1);
      });

      // Per-round command and event counts match the transcript entries.
      let commandEventsTotal = 0;
      let roundResultEventsTotal = 0;
      for (const round of summary.rounds) {
        const roundCommands = commandEntries.filter(
          (entry) => entry.kind === 'COMMAND' && entry.roundNumber === round.roundNumber,
        );
        expect(roundCommands).toHaveLength(round.commandCount);
        for (const entry of roundCommands) {
          expect(entry.kind).toBe('COMMAND');
          if (entry.kind === 'COMMAND') {
            commandEventsTotal += entry.events.length;
          }
        }

        const roundResult = roundEntries[round.roundNumber - 1]!;
        expect(roundResult.starterId).toBe(round.starterId);
        expect(roundResult.winners).toEqual(round.winners);
        expect(roundResult.winners.length).toBeGreaterThanOrEqual(1);
        roundResultEventsTotal += roundResult.events.length;
      }

      // The runner counts round eventCount as command events + applied result
      // events, so both sums must reproduce the transcript-wide total.
      expect(commandEventsTotal + roundResultEventsTotal).toBe(summary.totalEvents);
      const perRoundEventSum = summary.rounds.reduce((sum, round) => sum + round.eventCount, 0);
      expect(perRoundEventSum).toBe(summary.totalEvents);
      expect(summary.totalCommands).toBe(
        summary.rounds.reduce((sum, round) => sum + round.commandCount, 0),
      );
    }
  });

  it('surfaces no thrown invariant/engine errors anywhere in the corpus', () => {
    // runCorpusMatch rethrows with (seed, playerCount) context, so reaching
    // this assertion already proves every run completed without a throw.
    expect(corpus).toHaveLength(matchCount);
    expect(corpus.every((run) => run.result.summary.roundsPlayed >= 1)).toBe(true);
  });

  it('exercises both round-end paths across the corpus', () => {
    let exhaustionRevealRounds = 0;
    let lastSurvivorRounds = 0;

    for (const run of corpus) {
      const revealed = roundSawHandsRevealed(run.result);
      for (const round of run.result.summary.rounds) {
        if (revealed.get(round.roundNumber)) {
          exhaustionRevealRounds += 1;
        } else {
          lastSurvivorRounds += 1;
        }
      }
    }

    expect(exhaustionRevealRounds).toBeGreaterThanOrEqual(1);
    expect(lastSurvivorRounds).toBeGreaterThanOrEqual(1);
  });

  it('replays representative samples deterministically (bounded, not full corpus)', () => {
    // One run per player count plus the middle and last corpus indices.
    const sampleIndices = Array.from(
      new Set([
        ...Array.from({ length: PLAYER_COUNT_SPREAD }, (_, offset) => offset),
        Math.floor(matchCount / 2),
        matchCount - 1,
      ]),
    ).filter((index) => index >= 0 && index < matchCount);

    for (const index of sampleIndices) {
      const run = corpus[index]!;
      const replay = runCorpusMatch(run.playerCount, run.seed);
      expect(replay).toEqual(run.result);
    }
  });
});
