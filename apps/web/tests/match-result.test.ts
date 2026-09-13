/**
 * Match-result derivation contract (WU10): match-over is derived client-side
 * only from the authoritative public projection (`publicView.match.status ===
 * 'MATCH_END'`); the live `matchEnded`/`matchWinners` broadcast state is
 * supplemental evidence at most. Names and final victory tokens resolve only
 * from the projected roster, winner ids come from the MATCH_END projection
 * (preferred) or the match broadcast, unknown ids are dropped fail-closed, and
 * no raw id can ever reach the render model.
 */
import { evaluateMatchResult, isMatchOver } from '@/lib/game/match-result';
import { OTHER_ID, SELF_ID, publicView } from './helpers/game-views';
import type { PublicGameView } from '@power-hungry-pets/protocol';

/** A two-seat MATCH_END projection: Ana 3 tokens (winner), Bruno 1 token. */
function matchEndView(overrides: Partial<PublicGameView['match']> = {}): PublicGameView {
  const base = publicView();
  return {
    match: { ...base.match, status: 'MATCH_END', roundNumber: 4, winners: [SELF_ID], ...overrides },
    players: [
      {
        id: SELF_ID,
        name: 'Ana',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 3,
        handCount: 0,
        discards: [],
      },
      {
        id: OTHER_ID,
        name: 'Bruno',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 1,
        handCount: 0,
        discards: [],
      },
    ],
    round: null,
  };
}

describe('isMatchOver', () => {
  it('is true exactly when the authoritative projection announces MATCH_END', () => {
    expect(isMatchOver(matchEndView())).toBe(true);
  });

  it('is false for a live projection, a missing projection, and a malformed one', () => {
    expect(isMatchOver(publicView())).toBe(false);
    expect(isMatchOver(null)).toBe(false);
    // Fail-closed on malformed projections: no status, no match-over.
    expect(isMatchOver({ ...publicView(), match: undefined } as unknown as PublicGameView)).toBe(
      false,
    );
  });

  it('never trusts live broadcast flags alone', () => {
    // Supplemental evidence never triggers match-over: only the projection does.
    expect(isMatchOver(publicView({ round: null }))).toBe(false);
  });
});

describe('evaluateMatchResult', () => {
  it('stays none without a MATCH_END projection, even with broadcast evidence', () => {
    expect(evaluateMatchResult(null, [SELF_ID])).toEqual({ kind: 'none' });
    expect(evaluateMatchResult(publicView(), [SELF_ID])).toEqual({ kind: 'none' });
  });

  it('derives the visible result from the projection alone (reconnect-safe)', () => {
    const model = evaluateMatchResult(matchEndView(), []);
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.winners).toEqual([{ playerId: SELF_ID, name: 'Ana' }]);
    expect(model.sharedWin).toBe(false);
    expect(model.totals).toEqual([
      { playerId: SELF_ID, name: 'Ana', tokens: 3 },
      { playerId: OTHER_ID, name: 'Bruno', tokens: 1 },
    ]);
  });

  it('prefers the projection winners over the supplemental broadcast ids', () => {
    const model = evaluateMatchResult(matchEndView(), [OTHER_ID]);
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.winners).toEqual([{ playerId: SELF_ID, name: 'Ana' }]);
  });

  it('falls back to the supplemental broadcast ids when the projection names none', () => {
    const model = evaluateMatchResult(matchEndView({ winners: [] }), [OTHER_ID]);
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.winners).toEqual([{ playerId: OTHER_ID, name: 'Bruno' }]);
  });

  it('deduplicates winner ids preserving first-seen order', () => {
    const model = evaluateMatchResult(matchEndView({ winners: [OTHER_ID, SELF_ID, OTHER_ID] }), []);
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.winners).toEqual([
      { playerId: OTHER_ID, name: 'Bruno' },
      { playerId: SELF_ID, name: 'Ana' },
    ]);
    expect(model.sharedWin).toBe(true);
  });

  it('drops unknown winner ids fail-closed and never carries a raw id', () => {
    const model = evaluateMatchResult(
      matchEndView({ winners: [OTHER_ID, 'p-ghost', 42 as unknown as string] }),
      [],
    );
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.winners).toEqual([{ playerId: OTHER_ID, name: 'Bruno' }]);
    expect(model.sharedWin).toBe(false);
    expect(JSON.stringify(model)).not.toContain('p-ghost');
  });

  it('treats a malformed winner list as no winners, fail-closed', () => {
    const model = evaluateMatchResult(
      matchEndView({ winners: 'p-self' as unknown as string[] }),
      [],
    );
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.winners).toEqual([]);
    expect(model.sharedWin).toBe(false);
  });

  it('stays honest when no winner can be resolved against the roster', () => {
    const model = evaluateMatchResult(matchEndView({ winners: ['p-ghost'] }), ['p-ghost']);
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    // The surface can still show the final totals; it just never names a
    // winner that the evidence cannot resolve.
    expect(model.winners).toEqual([]);
    expect(model.sharedWin).toBe(false);
    expect(model.totals).toHaveLength(2);
  });

  it('reads final victory tokens for every roster player in roster order', () => {
    const model = evaluateMatchResult(matchEndView({ winners: [SELF_ID, OTHER_ID] }), []);
    if (model.kind !== 'visible') throw new Error('expected a visible model');
    expect(model.sharedWin).toBe(true);
    expect(model.totals.map((total) => total.name)).toEqual(['Ana', 'Bruno']);
  });

  it('is pure: the same inputs always produce a fresh, equal model', () => {
    const view = matchEndView();
    const first = evaluateMatchResult(view, [SELF_ID]);
    const second = evaluateMatchResult(view, [SELF_ID]);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});
