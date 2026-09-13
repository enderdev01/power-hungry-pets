/**
 * Round-result derivation contract (WU9): evidence comes only from an atomic
 * `game:event` batch — never inferred from public state. The render model
 * resolves names and token totals from the current public view and drops
 * unknown ids fail-closed, so no raw id or instance id can ever reach the slip.
 */
import {
  captureRoundResultEvidence,
  evaluateRoundResult,
  nextRoundResult,
  roundResultReasonSentence,
} from '@/lib/game/round-result';
import { OTHER_ID, SELF_ID, publicView, roundView } from './helpers/game-views';
import type { CardType, GamePublicEvent } from '@power-hungry-pets/protocol';

const aView = publicView();

describe('captureRoundResultEvidence', () => {
  it('captures winner ids and the pre-batch round number from a ROUND_ENDED batch', () => {
    const evidence = captureRoundResultEvidence([{ type: 'ROUND_ENDED', winnerIds: [SELF_ID] }], 3);
    expect(evidence).toEqual({
      roundNumber: 3,
      winnerIds: [SELF_ID],
      awards: [],
      reason: 'last-survivor',
      revealedHands: [],
    });
  });

  it('keeps a null round number when the pre-batch public view had no round', () => {
    const evidence = captureRoundResultEvidence(
      [{ type: 'ROUND_ENDED', winnerIds: [SELF_ID] }],
      null,
    );
    expect(evidence?.roundNumber).toBeNull();
  });

  it('folds repeated TOKEN_AWARDED events into per-player award amounts', () => {
    const evidence = captureRoundResultEvidence(
      [
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'TOKEN_AWARDED', playerId: OTHER_ID },
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID, OTHER_ID] },
      ],
      4,
    );
    expect(evidence?.awards).toEqual([
      { playerId: SELF_ID, amount: 2 },
      { playerId: OTHER_ID, amount: 1 },
    ]);
  });

  it('reads the exhaustion reason and reveal cards from HANDS_REVEALED', () => {
    const evidence = captureRoundResultEvidence(
      [
        {
          type: 'HANDS_REVEALED',
          hands: [
            { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
            { playerId: OTHER_ID, card: { value: 10, type: 'REY_GATO' } },
          ],
        },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      2,
    );
    expect(evidence?.reason).toBe('exhaustion');
    expect(evidence?.revealedHands).toEqual([
      { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
      { playerId: OTHER_ID, card: { value: 10, type: 'REY_GATO' } },
    ]);
  });

  it('treats a non-array winnerIds announcement as no winners, fail-closed', () => {
    const evidence = captureRoundResultEvidence(
      [
        {
          type: 'ROUND_ENDED',
          winnerIds: 'p-self' as unknown as string[],
        },
      ],
      3,
    );
    expect(evidence?.winnerIds).toEqual([]);
    // The render model stays visible but carries no winners and no raw id.
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.winners).toEqual([]);
    expect(model.sharedWin).toBe(false);
  });

  it('drops revealed cards whose type is outside the canonical protocol domain', () => {
    const evidence = captureRoundResultEvidence(
      [
        {
          type: 'HANDS_REVEALED',
          hands: [
            { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
            {
              playerId: OTHER_ID,
              card: { value: 5, type: 'NOT_A_REAL_CARD_TYPE' } as unknown as CardType,
            },
          ] as unknown as Array<{ playerId: string; card: { value: number; type: CardType } }>,
        },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID, OTHER_ID] },
      ],
      2,
    );
    // The unknown-type card never enters the evidence, so cardPresentation
    // can never throw on it at render time.
    expect(evidence?.revealedHands).toEqual([
      { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
    ]);
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.reveals).toEqual([
      { playerId: SELF_ID, name: 'Ana', card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
    ]);
  });

  it('stays last-survivor when the batch carries no HANDS_REVEALED', () => {
    const evidence = captureRoundResultEvidence(
      [
        { type: 'PLAYER_ELIMINATED', playerId: OTHER_ID },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      2,
    );
    expect(evidence?.reason).toBe('last-survivor');
    expect(evidence?.revealedHands).toEqual([]);
  });

  it('captures nothing from a batch that also announces the match end (WU10 owns it)', () => {
    const events: GamePublicEvent[] = [
      { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      { type: 'MATCH_ENDED', winnerIds: [SELF_ID] },
    ];
    expect(captureRoundResultEvidence(events, 3)).toBeNull();
  });

  it('captures nothing from a batch without ROUND_ENDED', () => {
    expect(captureRoundResultEvidence([{ type: 'CARD_DRAWN', playerId: SELF_ID }], 3)).toBeNull();
  });

  it('skips malformed batch entries fail-closed without dropping valid ones', () => {
    const evidence = captureRoundResultEvidence(
      [
        { type: 'TOKEN_AWARDED', playerId: 'not-a-seat' as unknown as string },
        // @ts-expect-error exercising a malformed published batch entry
        { type: 'TOKEN_AWARDED', playerId: 7 },
        {
          type: 'HANDS_REVEALED',
          hands: [
            { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
            { playerId: OTHER_ID, card: null },
            { playerId: 9, card: { value: 5, type: 'SERPIENTE_ENCANTADORA' } },
          ] as unknown as Array<{ playerId: string; card: { value: number; type: CardType } }>,
        },
        {
          type: 'ROUND_ENDED',
          winnerIds: [SELF_ID, 42, null] as unknown as string[],
        },
      ],
      5,
    );
    expect(evidence).not.toBeNull();
    expect(evidence?.winnerIds).toEqual([SELF_ID]);
    // A string award id stays in the evidence (it may be a real seat); the
    // numeric one is skipped. Unknown ids are dropped only at render time.
    expect(evidence?.awards).toEqual([{ playerId: 'not-a-seat', amount: 1 }]);
    expect(evidence?.revealedHands).toEqual([
      { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
    ]);

    // Render-time fail-closed resolution drops every id without a roster name.
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    // The announced winner has a roster name and stays; the malformed
    // non-string ids never entered the evidence at all.
    expect(model.winners).toEqual([{ playerId: SELF_ID, name: 'Ana' }]);
    expect(model.awards).toEqual([]);
    expect(model.reveals).toEqual([
      { playerId: SELF_ID, name: 'Ana', card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
    ]);
  });

  it('keeps every announced shared winner in published order after deduplication', () => {
    const evidence = captureRoundResultEvidence(
      [{ type: 'ROUND_ENDED', winnerIds: [OTHER_ID, SELF_ID, OTHER_ID] }],
      6,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.sharedWin).toBe(true);
    expect(model.winners.map((winner) => winner.name)).toEqual(['Bruno', 'Ana']);
  });

  it('deduplicates repeated winner ids while preserving announced order', () => {
    const evidence = captureRoundResultEvidence(
      [{ type: 'ROUND_ENDED', winnerIds: [SELF_ID, SELF_ID, OTHER_ID] }],
      1,
    );
    expect(evidence?.winnerIds).toEqual([SELF_ID, OTHER_ID]);
  });
});

describe('evaluateRoundResult', () => {
  it('is none without evidence', () => {
    expect(evaluateRoundResult(null, aView)).toEqual({ kind: 'none' });
  });

  it('resolves winner names from the current public view', () => {
    const evidence = captureRoundResultEvidence(
      [{ type: 'ROUND_ENDED', winnerIds: [OTHER_ID] }],
      3,
    );
    const model = evaluateRoundResult(evidence, aView);
    expect(model.kind).toBe('visible');
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.winners).toEqual([{ playerId: OTHER_ID, name: 'Bruno' }]);
    expect(model.sharedWin).toBe(false);
  });

  it('drops winner ids that have no public roster counterpart, never carrying raw ids', () => {
    const evidence = captureRoundResultEvidence(
      [{ type: 'ROUND_ENDED', winnerIds: ['p-ghost', SELF_ID] }],
      3,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.winners).toEqual([{ playerId: SELF_ID, name: 'Ana' }]);
    expect(JSON.stringify(model)).not.toContain('p-ghost');
  });

  it('marks the round shared when the server announced more than one winner', () => {
    const evidence = captureRoundResultEvidence(
      [{ type: 'ROUND_ENDED', winnerIds: [SELF_ID, OTHER_ID] }],
      3,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.sharedWin).toBe(true);
    expect(model.winners.map((winner) => winner.name)).toEqual(['Ana', 'Bruno']);
  });

  it('resolves authoritative current token totals for awards', () => {
    const evidence = captureRoundResultEvidence(
      [
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      3,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.awards).toEqual([{ playerId: SELF_ID, name: 'Ana', amount: 1, total: 1 }]);
  });

  it('withholds totals when the current view is not demonstrably post-result', () => {
    // The view still shows the same round the batch ended: its tokens may be
    // the stale pre-award balance, so the model carries null totals.
    const evidence = captureRoundResultEvidence(
      [
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      roundView().roundNumber,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.awards).toEqual([{ playerId: SELF_ID, name: 'Ana', amount: 1, total: null }]);
  });

  it('carries null totals when the roster carries no token count at all', () => {
    const evidence = captureRoundResultEvidence(
      [
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      3,
    );
    const noTokensView = publicView({
      players: [
        {
          id: SELF_ID,
          name: 'Ana',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: undefined as unknown as number,
          handCount: 1,
          discards: [],
        },
      ],
    });
    const model = evaluateRoundResult(evidence, noTokensView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.awards).toEqual([{ playerId: SELF_ID, name: 'Ana', amount: 1, total: null }]);
  });

  it('drops awards for unknown players and omits totals the roster does not carry', () => {
    const evidence = captureRoundResultEvidence(
      [
        { type: 'TOKEN_AWARDED', playerId: 'p-ghost' },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      3,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.awards).toEqual([]);
    expect(JSON.stringify(model)).not.toContain('p-ghost');
  });

  it('names exhaustion reveals from the roster and drops unknown players', () => {
    const evidence = captureRoundResultEvidence(
      [
        {
          type: 'HANDS_REVEALED',
          hands: [
            { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
            { playerId: 'p-ghost', card: { value: 5, type: 'SERPIENTE_ENCANTADORA' } },
          ],
        },
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
      ],
      3,
    );
    const model = evaluateRoundResult(evidence, aView);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.reveals).toEqual([
      {
        playerId: SELF_ID,
        name: 'Ana',
        card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' },
      },
    ]);
    expect(JSON.stringify(model)).not.toContain('p-ghost');
  });

  it('stays honest when the public view is unavailable: nothing is invented', () => {
    const evidence = captureRoundResultEvidence([{ type: 'ROUND_ENDED', winnerIds: [SELF_ID] }], 3);
    const model = evaluateRoundResult(evidence, null);
    if (model.kind !== 'visible') throw new Error('unreachable');
    expect(model.winners).toEqual([]);
    expect(model.awards).toEqual([]);
    expect(model.reveals).toEqual([]);
    expect(model.sharedWin).toBe(false);
  });
});

describe('round result copy', () => {
  it('names exhaustion only for revealed rounds and stays honest otherwise', () => {
    expect(roundResultReasonSentence('exhaustion')).toMatch(/draw pile ran out/i);
    expect(roundResultReasonSentence('last-survivor')).toMatch(/last survivor/i);
    // The client-safe protocol carries no winning hands for last-survivor
    // rounds: the copy must not promise any.
    expect(roundResultReasonSentence('last-survivor')).not.toMatch(/hand|reveal/i);
  });
});

describe('nextRoundResult', () => {
  const gameEvents = (events: GamePublicEvent[]): GamePublicEvent[] => events;

  it('re-arms a later ROUND_ENDED batch over any previous result', () => {
    const first = nextRoundResult(
      null,
      gameEvents([{ type: 'ROUND_ENDED', winnerIds: [SELF_ID] }]),
      aView,
    );
    const laterView = publicView({ round: roundView({ roundNumber: 2 }) });
    const second = nextRoundResult(
      first,
      gameEvents([{ type: 'ROUND_ENDED', winnerIds: [OTHER_ID] }]),
      laterView,
    );
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.roundNumber).toBe(2);
    expect(second?.winnerIds).toEqual([OTHER_ID]);
  });

  it('clears the visible result when a gameplay batch resumes the round', () => {
    const captured = nextRoundResult(
      null,
      gameEvents([{ type: 'ROUND_ENDED', winnerIds: [SELF_ID] }]),
      aView,
    );
    expect(
      nextRoundResult(captured, gameEvents([{ type: 'CARD_DRAWN', playerId: OTHER_ID }]), aView),
    ).toBeNull();
  });

  it('does not capture from a match-ending batch', () => {
    expect(
      nextRoundResult(
        null,
        gameEvents([
          { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
          { type: 'MATCH_ENDED', winnerIds: [SELF_ID] },
        ]),
        aView,
      ),
    ).toBeNull();
  });
});
