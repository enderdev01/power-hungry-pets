/**
 * Milestone 5 work unit 3 — deterministic legal-action policy and RNG streams.
 *
 * Normative design under test:
 * - RNG streams are derived reproducibly from the input seed and a stable
 *   stream name: the same (seed, stream) pair always produces the same
 *   sequence, and different streams/seeds produce independent sequences. This
 *   keeps action-selection randomness strictly separated from engine, deck,
 *   and card-effect randomness so policy changes can never perturb them.
 * - `selectLegalAction(round, rng, actorId?)` chooses exactly one canonical
 *   legal action from `getLegalActions` using exactly one RNG draw, leaves the
 *   input state untouched, and never mutates the returned command.
 * - An empty legal-action list (including a pending stage with no decisions)
 *   throws the typed `SimulationPolicyError` with code `NO_LEGAL_ACTIONS`.
 */
import {
  applyTurnCommand,
  createMatchState,
  setupRound,
  type MatchState,
  type PlayCardCommand,
  type PlayerInput,
  type RoundState,
  type Rng,
} from '../src';
import { createRngStream, POLICY_STREAM, selectLegalAction } from '../src/simulation-policy';
import { SeededRng } from '../src/rng';

const PLAYERS: PlayerInput[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
];

function createTestMatch(): MatchState {
  return createMatchState({ matchId: 'match-policy', players: PLAYERS });
}

/** Active round in DRAW_REQUIRED: exactly one legal action (DRAW_CARD). */
function drawRequiredRound(seed: number): RoundState {
  return setupRound(createTestMatch(), new SeededRng(seed));
}

/** Active round in PLAY_REQUIRED: one action per hand card. */
function playRequiredRound(seed: number): RoundState {
  const round = drawRequiredRound(seed);
  const result = applyTurnCommand(round, { type: 'DRAW_CARD', actorId: round.currentPlayerId });
  if (!result.ok) {
    throw new Error('test setup failed: DRAW_CARD rejected');
  }
  return result.state;
}

/** Counting RNG wrapper that records how many draws were consumed. */
class CountingRng implements Rng {
  public calls = 0;

  constructor(private readonly inner: Rng) {}

  public next(): number {
    this.calls += 1;
    return this.inner.next();
  }
}

describe('createRngStream — reproducible separated streams', () => {
  it('derives the same sequence for the same seed and stream name', () => {
    const first = createRngStream(1234, POLICY_STREAM);
    const second = createRngStream(1234, POLICY_STREAM);

    const firstSequence = Array.from({ length: 8 }, () => first.next());
    const secondSequence = Array.from({ length: 8 }, () => second.next());

    expect(secondSequence).toEqual(firstSequence);
  });

  it('derives different sequences for different stream names on the same seed', () => {
    const policy = createRngStream(1234, 'policy');
    const engine = createRngStream(1234, 'engine');

    const policySequence = Array.from({ length: 8 }, () => policy.next());
    const engineSequence = Array.from({ length: 8 }, () => engine.next());

    expect(engineSequence).not.toEqual(policySequence);
  });

  it('derives different sequences for different seeds on the same stream', () => {
    const first = createRngStream(1234, POLICY_STREAM);
    const second = createRngStream(5678, POLICY_STREAM);

    const firstSequence = Array.from({ length: 8 }, () => first.next());
    const secondSequence = Array.from({ length: 8 }, () => second.next());

    expect(secondSequence).not.toEqual(firstSequence);
  });
});

describe('selectLegalAction — single deterministic choice', () => {
  it('returns the sole DRAW_CARD action while DRAW_REQUIRED', () => {
    const round = drawRequiredRound(42);

    const command = selectLegalAction(round, new SeededRng(7));

    expect(command).toEqual({ type: 'DRAW_CARD', actorId: round.currentPlayerId });
  });

  it('uses exactly one RNG draw for the decision', () => {
    const round = drawRequiredRound(42);
    const counting = new CountingRng(new SeededRng(7));

    selectLegalAction(round, counting);

    expect(counting.calls).toBe(1);
  });

  it('returns a canonical legal action while PLAY_REQUIRED without mutating the state', () => {
    const round = playRequiredRound(99);
    const snapshot = JSON.stringify(round);

    const command = selectLegalAction(round, new SeededRng(7));

    const hand = round.players.find((player) => player.id === round.currentPlayerId)?.hand ?? [];
    const playCommand = command as PlayCardCommand;
    expect(command.type).toBe('PLAY_CARD');
    expect(playCommand.actorId).toBe(round.currentPlayerId);
    expect(hand.some((card) => card.instanceId === playCommand.cardInstanceId)).toBe(true);
    expect(JSON.stringify(round)).toBe(snapshot);
  });

  it('throws the typed NO_LEGAL_ACTIONS error on an ended round', () => {
    const round = drawRequiredRound(42);
    const ended = { ...round, status: 'ROUND_END' as const, winners: [round.currentPlayerId] };

    expect(() => selectLegalAction(ended, new SeededRng(7))).toThrowError(
      expect.objectContaining({ name: 'SimulationPolicyError', code: 'NO_LEGAL_ACTIONS' }),
    );
  });

  it('throws the typed NO_LEGAL_ACTIONS error for an unknown actor', () => {
    const round = drawRequiredRound(42);

    expect(() => selectLegalAction(round, new SeededRng(7), 'ghost')).toThrowError(
      expect.objectContaining({ name: 'SimulationPolicyError', code: 'NO_LEGAL_ACTIONS' }),
    );
  });
});
