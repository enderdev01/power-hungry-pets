/**
 * Motion-cue seam contract (M8 Work Unit 1): pure, fail-closed derivation of
 * animation cues from sanitized GamePublicEvent batches. The derivation is
 * reducer-owned — it never infers hidden state, never carries instance ids,
 * and never throws on malformed input.
 */
import {
  createInitialMotionCueState,
  deriveMotionCues,
  MOTION_CUE_LOG_LIMIT,
  type MotionCueState,
} from '@/lib/game/motion-cues';
import type { GamePublicEvent } from '@power-hungry-pets/protocol';

describe('motion cue derivation', () => {
  it('starts truthful: sequence 0, no cues, and no batch snapshot', () => {
    expect(createInitialMotionCueState()).toEqual({ sequence: 0, cues: [], lastBatch: null });
  });

  it('derives typed public cues from a supported batch in event order', () => {
    const events: GamePublicEvent[] = [
      { type: 'CARD_DRAWN', playerId: 'p-self' },
      { type: 'CARD_PLAYED', playerId: 'p-other', card: { value: 10, type: 'REY_GATO' } },
      {
        type: 'CARD_FORCED_FACE_UP',
        playerId: 'p-third',
        card: { value: 0, type: 'ERMITANO_BUSCA_CASA' },
      },
      { type: 'HANDS_REDEALT', playerIds: ['p-self', 'p-other'] },
      { type: 'HANDS_SWAPPED', playerIds: ['p-self', 'p-other'] },
      { type: 'SAQUEADOG_RESOLVED', playerId: 'p-self' },
      { type: 'RATON_RESOLVED', playerId: 'p-other' },
      { type: 'PLAYER_PROTECTED', playerId: 'p-self' },
      { type: 'PROTECTION_EXPIRED', playerId: 'p-other' },
      { type: 'PLAYER_ELIMINATED', playerId: 'p-third' },
      { type: 'TOKEN_AWARDED', playerId: 'p-self' },
    ];

    const next = deriveMotionCues(createInitialMotionCueState(), events);

    expect(next.sequence).toBe(1);
    expect(next.cues).toEqual([
      { kind: 'card-drawn', playerId: 'p-self' },
      { kind: 'card-played', playerId: 'p-other', card: { value: 10, type: 'REY_GATO' } },
      {
        kind: 'card-forced-face-up',
        playerId: 'p-third',
        card: { value: 0, type: 'ERMITANO_BUSCA_CASA' },
      },
      { kind: 'hands-redealt' },
      { kind: 'hands-swapped', playerIds: ['p-self', 'p-other'] },
      { kind: 'private-effect-resolved', effect: 'SAQUEADOG', playerId: 'p-self' },
      { kind: 'private-effect-resolved', effect: 'RATON', playerId: 'p-other' },
      { kind: 'protection-activated', playerId: 'p-self' },
      { kind: 'protection-expired', playerId: 'p-other' },
      { kind: 'player-eliminated', playerId: 'p-third' },
      { kind: 'token-awarded', playerId: 'p-self' },
    ]);
  });

  it('increments the sequence once per cue-bearing batch, not per cue', () => {
    let state = createInitialMotionCueState();
    state = deriveMotionCues(state, [
      { type: 'CARD_DRAWN', playerId: 'a' },
      { type: 'PLAYER_ELIMINATED', playerId: 'b' },
      { type: 'TOKEN_AWARDED', playerId: 'c' },
    ]);
    expect(state.sequence).toBe(1);
    expect(state.cues).toHaveLength(3);

    state = deriveMotionCues(state, [{ type: 'CARD_DRAWN', playerId: 'a' }]);
    expect(state.sequence).toBe(2);
  });

  it('never creates false motion from unsupported-only batches', () => {
    const prev: MotionCueState = {
      sequence: 4,
      cues: [{ kind: 'card-drawn', playerId: 'p-self' }],
      lastBatch: { sequence: 4, cues: [{ kind: 'card-drawn', playerId: 'p-self' }] },
    };
    const unsupportedOnly: GamePublicEvent[] = [
      { type: 'HANDS_REVEALED', hands: [] },
      { type: 'ROUND_ENDED', winnerIds: ['a'] },
      { type: 'MATCH_ENDED', winnerIds: ['a'] },
    ];

    expect(deriveMotionCues(prev, unsupportedOnly)).toBe(prev);
  });

  it('derives a public Pecera outcome cue without any guessed value', () => {
    const next = deriveMotionCues(createInitialMotionCueState(), [
      { type: 'PECERA_GUESS_RESOLVED', actorId: 'a', targetId: 'b', correct: false },
    ]);
    expect(next.lastBatch?.cues).toEqual([
      { kind: 'pecera-resolved', actorId: 'a', targetId: 'b', correct: false },
    ]);
  });

  it('treats an empty batch as no motion and keeps the previous state', () => {
    const prev: MotionCueState = {
      sequence: 2,
      cues: [{ kind: 'token-awarded', playerId: 'a' }],
      lastBatch: { sequence: 2, cues: [{ kind: 'token-awarded', playerId: 'a' }] },
    };
    expect(deriveMotionCues(prev, [])).toBe(prev);
  });

  it('fails closed on malformed input without throwing', () => {
    const prev = createInitialMotionCueState();
    const malformed = [
      null,
      undefined,
      42,
      'CARD_DRAWN',
      { playerId: 'a' },
      { type: 'TOTALLY_UNKNOWN', playerId: 'a' },
      { type: 'CARD_DRAWN' },
      { type: 'TOKEN_AWARDED', playerId: 7 },
    ] as unknown as GamePublicEvent[];

    expect(() => deriveMotionCues(prev, malformed)).not.toThrow();
    expect(deriveMotionCues(prev, malformed)).toBe(prev);
  });

  it('treats a non-array events payload as no motion', () => {
    const prev = createInitialMotionCueState();
    expect(deriveMotionCues(prev, undefined as unknown as GamePublicEvent[])).toBe(prev);
    expect(deriveMotionCues(prev, 'CARD_DRAWN' as unknown as GamePublicEvent[])).toBe(prev);
  });

  it('keeps only the well-formed cues of a mixed batch', () => {
    const next = deriveMotionCues(createInitialMotionCueState(), [
      { type: 'CARD_PLAYED', playerId: 'a', card: { value: 99, type: 'NOT_A_REAL_CARD' } },
      { type: 'CARD_PLAYED', playerId: 'b', card: { value: Number.NaN, type: 'REY_GATO' } },
      { type: 'CARD_PLAYED', playerId: 'c', card: { value: 10, type: 'REY_GATO' } },
    ] as unknown as GamePublicEvent[]);

    expect(next.cues).toEqual([
      { kind: 'card-played', playerId: 'c', card: { value: 10, type: 'REY_GATO' } },
    ]);
    expect(next.sequence).toBe(1);
  });

  it('carries only public card fields, stripping any runtime extras like instanceId', () => {
    const next = deriveMotionCues(createInitialMotionCueState(), [
      {
        type: 'CARD_PLAYED',
        playerId: 'a',
        card: { value: 7, type: 'PECERA_DE_CRISTAL', instanceId: 'inst-1' },
      },
    ] as unknown as GamePublicEvent[]);

    expect(next.cues).toEqual([
      { kind: 'card-played', playerId: 'a', card: { value: 7, type: 'PECERA_DE_CRISTAL' } },
    ]);
    expect(JSON.stringify(next)).not.toContain('inst-1');
  });

  it('keeps the cue list bounded, dropping the oldest cues first', () => {
    let state = createInitialMotionCueState();
    for (let i = 0; i < MOTION_CUE_LOG_LIMIT + 5; i += 1) {
      state = deriveMotionCues(state, [{ type: 'CARD_DRAWN', playerId: `p-${i}` }]);
    }
    expect(state.cues).toHaveLength(MOTION_CUE_LOG_LIMIT);
    expect(state.cues[0]).toEqual({ kind: 'card-drawn', playerId: 'p-5' });
    expect(state.cues.at(-1)).toEqual({ kind: 'card-drawn', playerId: 'p-24' });
    expect(state.sequence).toBe(MOTION_CUE_LOG_LIMIT + 5);
  });

  it('fails closed on a malformed previous state instead of throwing', () => {
    const malformed = { sequence: 'nope', cues: 'nope' } as unknown as MotionCueState;
    const next = deriveMotionCues(malformed, [{ type: 'CARD_DRAWN', playerId: 'a' }]);
    expect(next.sequence).toBe(1);
    expect(next.cues).toEqual([{ kind: 'card-drawn', playerId: 'a' }]);
    expect(next.lastBatch).toEqual({ sequence: 1, cues: [{ kind: 'card-drawn', playerId: 'a' }] });
  });

  it('fails closed on a malformed previous batch snapshot instead of trusting it', () => {
    const malformed = {
      sequence: 3,
      cues: [],
      lastBatch: { sequence: 'nope', cues: 'nope' },
    } as unknown as MotionCueState;
    const next = deriveMotionCues(malformed, [{ type: 'CARD_DRAWN', playerId: 'a' }]);
    expect(next.sequence).toBe(1);
    expect(next.lastBatch).toEqual({ sequence: 1, cues: [{ kind: 'card-drawn', playerId: 'a' }] });
  });

  it('stamps the newest batch snapshot with the sequence it advanced to', () => {
    let state = createInitialMotionCueState();
    state = deriveMotionCues(state, [{ type: 'CARD_DRAWN', playerId: 'a' }]);
    expect(state.lastBatch).toEqual({ sequence: 1, cues: [{ kind: 'card-drawn', playerId: 'a' }] });

    const second = deriveMotionCues(state, [
      { type: 'CARD_PLAYED', playerId: 'b', card: { value: 10, type: 'REY_GATO' } },
      { type: 'TOKEN_AWARDED', playerId: 'c' },
    ]);
    expect(second.sequence).toBe(2);
    expect(second.lastBatch).toEqual({
      sequence: 2,
      cues: [
        { kind: 'card-played', playerId: 'b', card: { value: 10, type: 'REY_GATO' } },
        { kind: 'token-awarded', playerId: 'c' },
      ],
    });

    // An unsupported-only batch leaves the snapshot unchanged.
    expect(deriveMotionCues(second, [{ type: 'ROUND_ENDED', winnerIds: ['a'] }])).toBe(second);
  });

  it('keeps the newest batch resolvable by sequence after the cue log saturates', () => {
    let state = createInitialMotionCueState();
    for (let i = 0; i < MOTION_CUE_LOG_LIMIT; i += 1) {
      state = deriveMotionCues(state, [{ type: 'CARD_DRAWN', playerId: `p-${i}` }]);
    }
    expect(state.cues).toHaveLength(MOTION_CUE_LOG_LIMIT);

    // Batch 21 crosses the bound: the bounded log drops its oldest entry, but
    // the newest batch stays fully resolvable by its own sequence stamp.
    const crossed = deriveMotionCues(state, [
      { type: 'CARD_PLAYED', playerId: 'late', card: { value: 10, type: 'REY_GATO' } },
    ]);
    expect(crossed.sequence).toBe(MOTION_CUE_LOG_LIMIT + 1);
    expect(crossed.cues).toHaveLength(MOTION_CUE_LOG_LIMIT);
    expect(crossed.cues[0]).toEqual({ kind: 'card-drawn', playerId: 'p-1' });
    expect(crossed.lastBatch).toEqual({
      sequence: MOTION_CUE_LOG_LIMIT + 1,
      cues: [{ kind: 'card-played', playerId: 'late', card: { value: 10, type: 'REY_GATO' } }],
    });
  });
});
