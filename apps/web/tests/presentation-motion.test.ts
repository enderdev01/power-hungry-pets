/**
 * Presentation-motion contract (M8 card-action work unit): pure, fail-closed
 * mapping from reducer-owned motion cues plus the authoritative projection to
 * per-zone one-shot motion plans. Motion never carries card instance identity,
 * never invents seat attribution, and never fires for unsupported events or
 * projection-only reconnects.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  advanceMotionConsumer,
  centerStageMotion,
  discardMotionForPlayer,
  discardOriginLabel,
  evaluateBatchMotion,
  evaluateBatchStatusMotion,
  handMotionForPlayer,
  initialMotionConsumerState,
  protectionMotionForPlayer,
  tableShuffleMotion,
  tokenMotionForPlayer,
  zoneMotionForPlayer,
  type PendingMotionBatch,
} from '@/lib/game/presentation-motion';
import {
  createInitialMotionCueState,
  deriveMotionCues,
  MOTION_CUE_LOG_LIMIT,
  type MotionCueState,
} from '@/lib/game/motion-cues';
import type {
  CardType,
  GamePublicEvent,
  PublicCard,
  PublicGameView,
  PublicPlayerView,
} from '@power-hungry-pets/protocol';
import { OTHER_ID, SELF_ID, THIRD_ID } from './helpers/game-views';

function seat(
  id: string,
  name: string,
  overrides: Partial<PublicPlayerView> = {},
): PublicPlayerView {
  return {
    id,
    name,
    connected: true,
    eliminated: false,
    protected: false,
    victoryTokens: 0,
    handCount: 1,
    discards: [],
    ...overrides,
  };
}

function view(players: PublicPlayerView[]): PublicGameView {
  return {
    match: { matchId: 'match-1', status: 'LOBBY', roundNumber: 1, winners: [] },
    players,
    round: null,
  };
}

function discard(
  value: number,
  type: CardType,
  origin: 'PLAYED' | 'FORCED_PLAY' | 'ELIMINATION_REVEAL',
): { card: PublicCard; origin: 'PLAYED' | 'FORCED_PLAY' | 'ELIMINATION_REVEAL' } {
  return { card: { value, type }, origin };
}

function card(value: number, type: CardType): PublicCard {
  return { value, type };
}

/** Builds the reducer-shaped cue state for one event batch. */
function cueStateFrom(events: GamePublicEvent[]): MotionCueState {
  return deriveMotionCues(createInitialMotionCueState(), events);
}

/**
 * The pending batch shape the consumer derives from a cue state: the newest
 * batch's own snapshot, optionally carrying the captured pre-cue public
 * handCounts and victoryTokens.
 */
function batchOf(
  events: GamePublicEvent[],
  preCounts: Record<string, number> | null = null,
  preTokens: Record<string, number> | null = null,
): PendingMotionBatch {
  const cueState = cueStateFrom(events);
  return {
    sequence: cueState.sequence,
    cues: cueState.lastBatch?.cues ?? [],
    preCounts,
    preTokens,
  };
}

describe('authoritative batch mapping (evaluateBatchMotion)', () => {
  it('maps CARD_DRAWN to the addressed player only once the projection confirms the hand change', () => {
    const preView = view([seat(SELF_ID, 'Ana', { handCount: 1 }), seat(OTHER_ID, 'Bruno')]);
    const postView = view([seat(SELF_ID, 'Ana', { handCount: 2 }), seat(OTHER_ID, 'Bruno')]);
    const batch = batchOf([{ type: 'CARD_DRAWN', playerId: SELF_ID }], { [SELF_ID]: 1 });

    // The captured pre-cue handCount still matches the projection: wait.
    expect(evaluateBatchMotion(batch, preView)).toEqual({ verdict: 'await-projection' });

    const outcome = evaluateBatchMotion(batch, postView);
    expect(outcome).toEqual({
      verdict: 'animate',
      plan: { kind: 'draw-settle', sequence: 1, playerId: SELF_ID },
    });
  });

  it('never animates a draw without a captured pre-cue handCount (fail closed)', () => {
    const batch = batchOf([{ type: 'CARD_DRAWN', playerId: SELF_ID }], null);
    const roster = view([seat(SELF_ID, 'Ana', { handCount: 2 })]);
    expect(evaluateBatchMotion(batch, roster)).toEqual({ verdict: 'await-projection' });

    // A pre-cue snapshot without the addressed seat is equally unconfirmable.
    const unaddressed = batchOf([{ type: 'CARD_DRAWN', playerId: SELF_ID }], { [OTHER_ID]: 3 });
    expect(evaluateBatchMotion(unaddressed, roster)).toEqual({ verdict: 'await-projection' });
  });

  it('never attributes draw motion to an unknown seat', () => {
    const outcome = evaluateBatchMotion(
      batchOf([{ type: 'CARD_DRAWN', playerId: 'p-ghost' }]),
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(outcome).toEqual({ verdict: 'none' });
  });

  it('maps CARD_PLAYED to a card-landing on the matching player when the projection confirms the newest discard', () => {
    const players = [
      seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] }),
      seat(OTHER_ID, 'Bruno'),
    ];
    const outcome = evaluateBatchMotion(
      batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
      view(players),
    );
    expect(outcome).toEqual({
      verdict: 'animate',
      plan: {
        kind: 'card-landing',
        sequence: 1,
        playerId: SELF_ID,
        card: { value: 10, type: 'REY_GATO' },
      },
    });
  });

  it('waits for the projection when the played card is not yet the newest public discard', () => {
    const withoutDiscards = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]);
    expect(
      evaluateBatchMotion(
        batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
        withoutDiscards,
      ),
    ).toEqual({ verdict: 'await-projection' });

    const staleNewest = view([
      seat(SELF_ID, 'Ana', {
        discards: [discard(4, 'CAPARAZON_ARMAZON', 'PLAYED')],
      }),
    ]);
    expect(
      evaluateBatchMotion(
        batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
        staleNewest,
      ),
    ).toEqual({ verdict: 'await-projection' });
  });

  it('maps CARD_FORCED_FACE_UP to a flip only when the newest public discard is the forced shell', () => {
    const confirming = view([
      seat(SELF_ID, 'Ana', {
        discards: [discard(5, 'SERPIENTE_ENCANTADORA', 'FORCED_PLAY')],
      }),
    ]);
    expect(
      evaluateBatchMotion(
        batchOf([
          {
            type: 'CARD_FORCED_FACE_UP',
            playerId: SELF_ID,
            card: card(5, 'SERPIENTE_ENCANTADORA'),
          },
        ]),
        confirming,
      ),
    ).toEqual({
      verdict: 'animate',
      plan: {
        kind: 'card-flip',
        sequence: 1,
        playerId: SELF_ID,
        card: { value: 5, type: 'SERPIENTE_ENCANTADORA' },
      },
    });

    // A PLAYED-origin newest discard is not the forced shell: wait, never guess.
    const wrongOrigin = view([
      seat(SELF_ID, 'Ana', { discards: [discard(5, 'SERPIENTE_ENCANTADORA', 'PLAYED')] }),
    ]);
    expect(
      evaluateBatchMotion(
        batchOf([
          {
            type: 'CARD_FORCED_FACE_UP',
            playerId: SELF_ID,
            card: card(5, 'SERPIENTE_ENCANTADORA'),
          },
        ]),
        wrongOrigin,
      ),
    ).toEqual({ verdict: 'await-projection' });
  });

  it('maps PLAYER_ELIMINATED to a flip only on an elimination-reveal discard shell', () => {
    const confirming = view([
      seat(OTHER_ID, 'Bruno', {
        eliminated: true,
        discards: [discard(3, 'CONEJITO_GUERRILLERO', 'ELIMINATION_REVEAL')],
      }),
    ]);
    expect(
      evaluateBatchMotion(batchOf([{ type: 'PLAYER_ELIMINATED', playerId: OTHER_ID }]), confirming),
    ).toEqual({
      verdict: 'animate',
      plan: {
        kind: 'card-flip',
        sequence: 1,
        playerId: OTHER_ID,
        // The projection's confirmed elimination-reveal shell is the public
        // card the flip carries to the center stage.
        card: { value: 3, type: 'CONEJITO_GUERRILLERO' },
      },
    });

    const withoutReveal = view([seat(OTHER_ID, 'Bruno', { eliminated: true })]);
    expect(
      evaluateBatchMotion(
        batchOf([{ type: 'PLAYER_ELIMINATED', playerId: OTHER_ID }]),
        withoutReveal,
      ),
    ).toEqual({ verdict: 'await-projection' });
  });

  it('maps HANDS_REDEALT to an honest table-level shuffle with no seat attribution', () => {
    const outcome = evaluateBatchMotion(
      batchOf([{ type: 'HANDS_REDEALT', playerIds: [SELF_ID, OTHER_ID] }]),
      view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]),
    );
    expect(outcome).toEqual({
      verdict: 'animate',
      plan: { kind: 'hand-shuffle', sequence: 1 },
    });
    expect(JSON.stringify(outcome)).not.toContain(SELF_ID);
    expect(JSON.stringify(outcome)).not.toContain(OTHER_ID);
  });

  it('maps HANDS_SWAPPED to an exchange on exactly the published pair', () => {
    const roster = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno'), seat(THIRD_ID, 'Caro')]);
    expect(
      evaluateBatchMotion(
        batchOf([{ type: 'HANDS_SWAPPED', playerIds: [SELF_ID, OTHER_ID] }]),
        roster,
      ),
    ).toEqual({
      verdict: 'animate',
      plan: { kind: 'hand-exchange', sequence: 1, playerIds: [SELF_ID, OTHER_ID] },
    });

    // One unresolvable seat: fail closed, no partial attribution.
    expect(
      evaluateBatchMotion(
        batchOf([{ type: 'HANDS_SWAPPED', playerIds: [SELF_ID, 'p-ghost'] }]),
        roster,
      ),
    ).toEqual({ verdict: 'none' });
  });

  it('maps SAQUEADOG/RATON resolution to an actor-only settle cue with no card identity', () => {
    const roster = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]);
    expect(
      evaluateBatchMotion(batchOf([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]), roster),
    ).toEqual({
      verdict: 'animate',
      plan: { kind: 'effect-settle', sequence: 1, playerId: SELF_ID },
    });
    expect(
      evaluateBatchMotion(batchOf([{ type: 'RATON_RESOLVED', playerId: OTHER_ID }]), roster),
    ).toEqual({
      verdict: 'animate',
      plan: { kind: 'effect-settle', sequence: 1, playerId: OTHER_ID },
    });
  });

  it('picks the newest motion-worthy cue of a batch as the one focal cue', () => {
    const roster = view([
      seat(SELF_ID, 'Ana'),
      seat(OTHER_ID, 'Bruno', { discards: [discard(10, 'REY_GATO', 'PLAYED')] }),
    ]);
    const outcome = evaluateBatchMotion(
      batchOf([
        { type: 'CARD_DRAWN', playerId: SELF_ID },
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'CARD_PLAYED', playerId: OTHER_ID, card: card(10, 'REY_GATO') },
      ]),
      roster,
    );
    expect(outcome).toEqual({
      verdict: 'animate',
      plan: {
        kind: 'card-landing',
        sequence: 1,
        playerId: OTHER_ID,
        card: { value: 10, type: 'REY_GATO' },
      },
    });
  });

  it('never lets protection or token cues steal the focal card moment', () => {
    const roster = view([seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] })]);
    expect(
      evaluateBatchMotion(
        batchOf([
          { type: 'PLAYER_PROTECTED', playerId: SELF_ID },
          { type: 'TOKEN_AWARDED', playerId: SELF_ID },
          { type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') },
        ]),
        roster,
      ),
    ).toEqual({
      verdict: 'animate',
      plan: {
        kind: 'card-landing',
        sequence: 1,
        playerId: SELF_ID,
        card: { value: 10, type: 'REY_GATO' },
      },
    });
  });

  it('fails closed on a cue-shaped value the seam never produced', () => {
    const bogus = {
      sequence: 1,
      cues: [{ kind: 'totally-unknown', playerId: SELF_ID }],
    } as unknown as PendingMotionBatch;
    expect(evaluateBatchMotion(bogus, view([seat(SELF_ID, 'Ana')]))).toEqual({ verdict: 'none' });
  });

  it('carries no instance identity in any plan', () => {
    const roster = view([
      seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] }),
      seat(OTHER_ID, 'Bruno'),
    ]);
    const outcome = evaluateBatchMotion(
      batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
      roster,
    );
    expect(JSON.stringify(outcome)).not.toContain('instance');
    expect(JSON.stringify(outcome)).not.toContain('inst-');
  });
});

describe('status-channel mapping (evaluateBatchStatusMotion)', () => {
  it('maps TOKEN_AWARDED to a token-settle only once the projected count differs from the pre-cue count', () => {
    const roster = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno'), seat(THIRD_ID, 'Caro')]);
    const batch = batchOf(
      [
        { type: 'TOKEN_AWARDED', playerId: SELF_ID },
        { type: 'TOKEN_AWARDED', playerId: OTHER_ID },
      ],
      { [SELF_ID]: 0, [OTHER_ID]: 0 },
      { [SELF_ID]: 0, [OTHER_ID]: 0 },
    );

    // Event-before-projection: the projection still shows the stale pre-cue
    // counts, so no cue is confirmed yet — a stale count has no cue.
    expect(evaluateBatchStatusMotion(batch, roster)).toEqual({
      verdict: 'await-projection',
      plan: null,
    });

    // The confirming projection: both awarded seats' committed counts changed.
    const confirmed = view([
      seat(SELF_ID, 'Ana', { victoryTokens: 3 }),
      seat(OTHER_ID, 'Bruno', { victoryTokens: 1 }),
      seat(THIRD_ID, 'Caro'),
    ]);
    expect(evaluateBatchStatusMotion(batch, confirmed)).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [
          { kind: 'token-settle', sequence: 1, playerId: SELF_ID },
          { kind: 'token-settle', sequence: 1, playerId: OTHER_ID },
        ],
      },
    });
  });

  it('never confirms a token award without a captured pre-cue count (fail closed)', () => {
    const batch = batchOf([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }]);
    const roster = view([seat(SELF_ID, 'Ana', { victoryTokens: 2 })]);
    expect(evaluateBatchStatusMotion(batch, roster)).toEqual({
      verdict: 'await-projection',
      plan: null,
    });

    // A pre-cue snapshot without the awarded seat is equally unconfirmable.
    const unaddressed = batchOf([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }], null, {
      [OTHER_ID]: 3,
    });
    expect(evaluateBatchStatusMotion(unaddressed, roster)).toEqual({
      verdict: 'await-projection',
      plan: null,
    });
  });

  it('preserves a protection activation and an expiry for different players in one batch', () => {
    // The reachable mixed batch: Ana gains protection while Bruno's expires.
    const confirming = view([
      seat(SELF_ID, 'Ana', { protected: true }),
      seat(OTHER_ID, 'Bruno', { protected: false }),
    ]);
    expect(
      evaluateBatchStatusMotion(
        batchOf([
          { type: 'PLAYER_PROTECTED', playerId: SELF_ID },
          { type: 'PROTECTION_EXPIRED', playerId: OTHER_ID },
        ]),
        confirming,
      ),
    ).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [
          { kind: 'protection-settle', sequence: 1, playerId: SELF_ID },
          { kind: 'protection-expire', sequence: 1, playerId: OTHER_ID },
        ],
      },
    });
  });

  it('keeps a token award and a protection cue as separate motions in one batch', () => {
    const confirming = view([
      seat(SELF_ID, 'Ana', { victoryTokens: 2, protected: true }),
      seat(OTHER_ID, 'Bruno'),
    ]);
    expect(
      evaluateBatchStatusMotion(
        batchOf(
          [
            { type: 'TOKEN_AWARDED', playerId: SELF_ID },
            { type: 'PLAYER_PROTECTED', playerId: SELF_ID },
          ],
          null,
          { [SELF_ID]: 1 },
        ),
        confirming,
      ),
    ).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [
          { kind: 'token-settle', sequence: 1, playerId: SELF_ID },
          { kind: 'protection-settle', sequence: 1, playerId: SELF_ID },
        ],
      },
    });
  });

  it('animates the already-confirmed cues of a batch while the rest keep waiting', () => {
    // Bruno's protection is confirmed; Ana's award still shows its stale count.
    const partial = view([
      seat(SELF_ID, 'Ana', { victoryTokens: 1 }),
      seat(OTHER_ID, 'Bruno', { protected: true }),
    ]);
    expect(
      evaluateBatchStatusMotion(
        batchOf(
          [
            { type: 'TOKEN_AWARDED', playerId: SELF_ID },
            { type: 'PLAYER_PROTECTED', playerId: OTHER_ID },
          ],
          null,
          { [SELF_ID]: 1 },
        ),
        partial,
      ),
    ).toEqual({
      verdict: 'await-projection',
      plan: {
        sequence: 1,
        motions: [{ kind: 'protection-settle', sequence: 1, playerId: OTHER_ID }],
      },
    });
  });

  it('deduplicates repeated awards for one shared winner', () => {
    expect(
      evaluateBatchStatusMotion(
        batchOf(
          [
            { type: 'TOKEN_AWARDED', playerId: SELF_ID },
            { type: 'TOKEN_AWARDED', playerId: SELF_ID },
          ],
          null,
          { [SELF_ID]: 0 },
        ),
        view([seat(SELF_ID, 'Ana', { victoryTokens: 2 })]),
      ),
    ).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [{ kind: 'token-settle', sequence: 1, playerId: SELF_ID }],
      },
    });
  });

  it('drops unresolvable awarded seats fail-closed and never carries a raw id', () => {
    const partial = evaluateBatchStatusMotion(
      batchOf(
        [
          { type: 'TOKEN_AWARDED', playerId: SELF_ID },
          { type: 'TOKEN_AWARDED', playerId: 'p-ghost' },
        ],
        null,
        { [SELF_ID]: 0 },
      ),
      view([seat(SELF_ID, 'Ana', { victoryTokens: 1 })]),
    );
    expect(partial).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [{ kind: 'token-settle', sequence: 1, playerId: SELF_ID }],
      },
    });
    expect(JSON.stringify(partial)).not.toContain('p-ghost');

    expect(
      evaluateBatchStatusMotion(
        batchOf([{ type: 'TOKEN_AWARDED', playerId: 'p-ghost' }]),
        view([seat(SELF_ID, 'Ana')]),
      ),
    ).toEqual({ verdict: 'none' });
  });

  it('maps PLAYER_PROTECTED to an activation cue only once the projection shows the persistent state', () => {
    const batch = batchOf([{ type: 'PLAYER_PROTECTED', playerId: SELF_ID }]);
    const before = view([seat(SELF_ID, 'Ana', { protected: false })]);
    expect(evaluateBatchStatusMotion(batch, before)).toEqual({
      verdict: 'await-projection',
      plan: null,
    });

    const after = view([seat(SELF_ID, 'Ana', { protected: true })]);
    expect(evaluateBatchStatusMotion(batch, after)).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [{ kind: 'protection-settle', sequence: 1, playerId: SELF_ID }],
      },
    });
  });

  it('maps PROTECTION_EXPIRED to an expiry cue only once the projection drops the persistent state', () => {
    const batch = batchOf([{ type: 'PROTECTION_EXPIRED', playerId: SELF_ID }]);
    const still = view([seat(SELF_ID, 'Ana', { protected: true })]);
    expect(evaluateBatchStatusMotion(batch, still)).toEqual({
      verdict: 'await-projection',
      plan: null,
    });

    const cleared = view([seat(SELF_ID, 'Ana', { protected: false })]);
    expect(evaluateBatchStatusMotion(batch, cleared)).toEqual({
      verdict: 'animate',
      plan: {
        sequence: 1,
        motions: [{ kind: 'protection-expire', sequence: 1, playerId: SELF_ID }],
      },
    });
  });

  it('never attributes status motion to an unknown seat', () => {
    expect(
      evaluateBatchStatusMotion(
        batchOf([{ type: 'PLAYER_PROTECTED', playerId: 'p-ghost' }]),
        view([seat(SELF_ID, 'Ana')]),
      ),
    ).toEqual({ verdict: 'none' });
  });

  it('stays motionless for a batch without any status cue', () => {
    expect(
      evaluateBatchStatusMotion(
        batchOf([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]),
        view([seat(SELF_ID, 'Ana')]),
      ),
    ).toEqual({ verdict: 'none' });
  });

  it('carries no instance identity in any status plan', () => {
    const outcome = evaluateBatchStatusMotion(
      batchOf([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }]),
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(JSON.stringify(outcome)).not.toContain('instance');
    expect(JSON.stringify(outcome)).not.toContain('inst-');
  });
});

describe('status zone helpers', () => {
  it('tokenMotionForPlayer addresses the rack of awarded seats only', () => {
    const plan = evaluateBatchStatusMotion(
      batchOf(
        [
          { type: 'TOKEN_AWARDED', playerId: SELF_ID },
          { type: 'TOKEN_AWARDED', playerId: OTHER_ID },
        ],
        null,
        { [SELF_ID]: 0, [OTHER_ID]: 0 },
      ),
      view([
        seat(SELF_ID, 'Ana', { victoryTokens: 1 }),
        seat(OTHER_ID, 'Bruno', { victoryTokens: 2 }),
        seat(THIRD_ID, 'Caro'),
      ]),
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(tokenMotionForPlayer(active, SELF_ID)).toEqual({ kind: 'token-settle', sequence: 1 });
    expect(tokenMotionForPlayer(active, OTHER_ID)).toEqual({ kind: 'token-settle', sequence: 1 });
    expect(tokenMotionForPlayer(active, THIRD_ID)).toBeNull();
    expect(protectionMotionForPlayer(active, SELF_ID)).toBeNull();
    expect(tokenMotionForPlayer(null, SELF_ID)).toBeNull();
  });

  it('protectionMotionForPlayer addresses the cued seat only, beside any token motion', () => {
    const settle = evaluateBatchStatusMotion(
      batchOf([{ type: 'PLAYER_PROTECTED', playerId: SELF_ID }]),
      view([seat(SELF_ID, 'Ana', { protected: true }), seat(OTHER_ID, 'Bruno')]),
    );
    const settlePlan = settle.verdict === 'animate' ? settle.plan : null;
    expect(protectionMotionForPlayer(settlePlan, SELF_ID)).toEqual({
      kind: 'protection-settle',
      sequence: 1,
    });
    expect(protectionMotionForPlayer(settlePlan, OTHER_ID)).toBeNull();
    expect(tokenMotionForPlayer(settlePlan, SELF_ID)).toBeNull();
    expect(protectionMotionForPlayer(null, SELF_ID)).toBeNull();

    const expire = evaluateBatchStatusMotion(
      batchOf([{ type: 'PROTECTION_EXPIRED', playerId: OTHER_ID }]),
      view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno', { protected: false })]),
    );
    const expirePlan = expire.verdict === 'animate' ? expire.plan : null;
    expect(protectionMotionForPlayer(expirePlan, OTHER_ID)).toEqual({
      kind: 'protection-expire',
      sequence: 1,
    });

    // One mixed batch resolves both helpers for the same seat independently.
    const mixed = evaluateBatchStatusMotion(
      batchOf(
        [
          { type: 'TOKEN_AWARDED', playerId: SELF_ID },
          { type: 'PLAYER_PROTECTED', playerId: SELF_ID },
        ],
        null,
        { [SELF_ID]: 0 },
      ),
      view([seat(SELF_ID, 'Ana', { victoryTokens: 2, protected: true })]),
    );
    const mixedPlan = mixed.verdict === 'animate' ? mixed.plan : null;
    expect(tokenMotionForPlayer(mixedPlan, SELF_ID)).toEqual({
      kind: 'token-settle',
      sequence: 1,
    });
    expect(protectionMotionForPlayer(mixedPlan, SELF_ID)).toEqual({
      kind: 'protection-settle',
      sequence: 1,
    });
  });
});

describe('motion consumer (advanceMotionConsumer)', () => {
  it('holds motion until the projection confirms the destination, then animates once', () => {
    const cueState = cueStateFrom([
      { type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') },
    ]);
    const waitingView = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]);

    const waiting = advanceMotionConsumer(initialMotionConsumerState(), cueState, waitingView);
    expect(waiting.plan).toBeNull();
    expect(waiting.state.pending).not.toBeNull();

    const confirmedView = view([
      seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] }),
      seat(OTHER_ID, 'Bruno'),
    ]);
    const confirmed = advanceMotionConsumer(waiting.state, cueState, confirmedView);
    expect(confirmed.plan).toEqual({
      kind: 'card-landing',
      sequence: 1,
      playerId: SELF_ID,
      card: { value: 10, type: 'REY_GATO' },
    });
    expect(confirmed.state.pending).toBeNull();
  });

  it('clears all cue attributes on an unsupported-only batch', () => {
    const cueState = cueStateFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]);
    const { state, plan, statusPlan } = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(plan).toEqual({ kind: 'effect-settle', sequence: 1, playerId: SELF_ID });
    expect(statusPlan).toBeNull();
    expect(state.pending).toBeNull();
  });

  it('waits for the projection when a token batch arrives before the projection, then animates once', () => {
    const cueState = cueStateFrom([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }]);
    const preView = view([seat(SELF_ID, 'Ana', { victoryTokens: 1 })]);

    // Event-before-projection: the batch is captured against the pre-award
    // projection, which cannot confirm the committed count change yet.
    const first = advanceMotionConsumer(initialMotionConsumerState(), cueState, preView);
    expect(first.plan).toBeNull();
    expect(first.statusPlan).toBeNull();
    expect(first.state.pending).not.toBeNull();
    expect(first.state.pending?.preTokens).toEqual({ [SELF_ID]: 1 });

    // A projection-only update that still shows the stale count never confirms.
    const stale = advanceMotionConsumer(
      first.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { victoryTokens: 1, handCount: 3 })]),
    );
    expect(stale.statusPlan).toBeNull();
    expect(stale.state.pending).not.toBeNull();

    // The confirming authoritative projection: the committed count changed.
    const confirmed = advanceMotionConsumer(
      stale.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { victoryTokens: 3 })]),
    );
    expect(confirmed.statusPlan).toEqual({
      sequence: 1,
      motions: [{ kind: 'token-settle', sequence: 1, playerId: SELF_ID }],
    });
    expect(confirmed.state.pending).toBeNull();

    // Replaying the same batch identity never animates again.
    const settled = advanceMotionConsumer(
      confirmed.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { victoryTokens: 3 })]),
    );
    expect(settled.statusPlan).toBe(confirmed.statusPlan);
    expect(settled.state.cursor).toEqual(confirmed.state.cursor);
  });

  it('never cues a token award across a projection-only reconnect-style reset', () => {
    const cueState = cueStateFrom([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }]);
    const active = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana', { victoryTokens: 1 })]),
    );
    expect(active.statusPlan).toBeNull();

    // The game cleared and re-projected: motion cues reset, motionless.
    const reset = advanceMotionConsumer(
      active.state,
      createInitialMotionCueState(),
      view([seat(SELF_ID, 'Ana', { victoryTokens: 3 })]),
    );
    expect(reset.statusPlan).toBeNull();
    expect(reset.state.pending).toBeNull();
    expect(reset.state.cursor).toEqual({ sequence: 0 });
  });

  it('replaces a still-waiting batch when the next batch arrives', () => {
    const first = cueStateFrom([
      { type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') },
    ]);
    const waiting = advanceMotionConsumer(
      initialMotionConsumerState(),
      first,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(waiting.state.pending).not.toBeNull();

    const second = deriveMotionCues(first, [{ type: 'RATON_RESOLVED', playerId: OTHER_ID }]);
    const replaced = advanceMotionConsumer(
      waiting.state,
      second,
      view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]),
    );
    expect(replaced.plan).toEqual({ kind: 'effect-settle', sequence: 2, playerId: OTHER_ID });
    expect(replaced.state.pending).toBeNull();
    expect(replaced.state.cursor).toEqual({ sequence: 2 });
  });

  it('waits for the projection when a draw batch arrives before the projection', () => {
    const cueState = cueStateFrom([{ type: 'CARD_DRAWN', playerId: SELF_ID }]);
    const preView = view([seat(SELF_ID, 'Ana', { handCount: 1 })]);

    // Event-before-projection ordering: the batch arrives with the pre-draw
    // projection, which cannot confirm the addressed player's hand change yet.
    const first = advanceMotionConsumer(initialMotionConsumerState(), cueState, preView);
    expect(first.plan).toBeNull();
    expect(first.state.pending).not.toBeNull();
    expect(first.state.pending?.preCounts).toEqual({ [SELF_ID]: 1 });

    // The later authoritative projection confirms the hand change: animate.
    const confirmed = advanceMotionConsumer(
      first.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { handCount: 2 })]),
    );
    expect(confirmed.plan).toEqual({ kind: 'draw-settle', sequence: 1, playerId: SELF_ID });
    expect(confirmed.state.pending).toBeNull();
  });

  it('stays fail-closed when the projection never confirms a draw', () => {
    const cueState = cueStateFrom([{ type: 'CARD_DRAWN', playerId: SELF_ID }]);
    const preView = view([seat(SELF_ID, 'Ana', { handCount: 1 })]);
    const waiting = advanceMotionConsumer(initialMotionConsumerState(), cueState, preView);
    expect(waiting.plan).toBeNull();

    // Projection-only updates that never change the addressed player's
    // handCount never confirm the draw.
    const stillWaiting = advanceMotionConsumer(
      waiting.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { handCount: 1, victoryTokens: 2 })]),
    );
    expect(stillWaiting.plan).toBeNull();
    expect(stillWaiting.state.pending).not.toBeNull();
  });

  it('never moves the cursor or the plan on projection-only updates', () => {
    const cueState = cueStateFrom([{ type: 'HANDS_REDEALT', playerIds: [SELF_ID, OTHER_ID] }]);
    const first = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(first.plan).not.toBeNull();

    const again = advanceMotionConsumer(
      first.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { handCount: 2 })]),
    );
    expect(again.plan).toBe(first.plan);
    expect(again.state.cursor).toEqual(first.state.cursor);
  });

  it('drives the status channel through the same pending batch and confirmation discipline', () => {
    const cueState = cueStateFrom([{ type: 'PLAYER_PROTECTED', playerId: SELF_ID }]);
    const before = view([seat(SELF_ID, 'Ana', { protected: false })]);
    const waiting = advanceMotionConsumer(initialMotionConsumerState(), cueState, before);
    expect(waiting.plan).toBeNull();
    expect(waiting.statusPlan).toBeNull();
    expect(waiting.state.pending).not.toBeNull();

    const confirmed = advanceMotionConsumer(
      waiting.state,
      cueState,
      view([seat(SELF_ID, 'Ana', { protected: true })]),
    );
    expect(confirmed.statusPlan).toEqual({
      sequence: 1,
      motions: [{ kind: 'protection-settle', sequence: 1, playerId: SELF_ID }],
    });
    expect(confirmed.state.pending).toBeNull();
  });

  it('clears a stale status plan when the next batch resolves to no status motion', () => {
    const protectedBatch = cueStateFrom([{ type: 'PLAYER_PROTECTED', playerId: SELF_ID }]);
    const settled = advanceMotionConsumer(
      initialMotionConsumerState(),
      protectedBatch,
      view([seat(SELF_ID, 'Ana', { protected: true })]),
    );
    expect(settled.statusPlan).not.toBeNull();

    const next = deriveMotionCues(protectedBatch, [{ type: 'CARD_DRAWN', playerId: OTHER_ID }]);
    const cleared = advanceMotionConsumer(
      settled.state,
      next,
      view([seat(SELF_ID, 'Ana', { protected: true }), seat(OTHER_ID, 'Bruno')]),
    );
    expect(cleared.statusPlan).toBeNull();
    // The card channel still awaits its own draw confirmation, so the batch
    // legitimately stays pending until the projection confirms it.
    expect(cleared.state.pending).not.toBeNull();
  });

  it('collapses to a motionless state on a sequence reset (reconnect or cleared game)', () => {
    const cueState = cueStateFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]);
    const active = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(active.plan).not.toBeNull();

    const protectedState = deriveMotionCues(cueState, [
      { type: 'PLAYER_PROTECTED', playerId: OTHER_ID },
    ]);
    const statusActive = advanceMotionConsumer(
      active.state,
      protectedState,
      view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno', { protected: true })]),
    );
    expect(statusActive.statusPlan).not.toBeNull();

    const reset = advanceMotionConsumer(
      statusActive.state,
      createInitialMotionCueState(),
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(reset.plan).toBeNull();
    expect(reset.statusPlan).toBeNull();
    expect(reset.state.pending).toBeNull();
    expect(reset.state.cursor).toEqual({ sequence: 0 });

    // A fresh batch after the reset animates normally again.
    const revived = advanceMotionConsumer(
      reset.state,
      cueStateFrom([{ type: 'RATON_RESOLVED', playerId: OTHER_ID }]),
      view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]),
    );
    expect(revived.plan).toEqual({ kind: 'effect-settle', sequence: 1, playerId: OTHER_ID });
  });

  it('keeps judging resets by sequence alone when the bounded log drops entries', () => {
    const cueState = cueStateFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]);
    const active = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(active.plan).not.toBeNull();

    // The bounded log shrinking without a sequence move is not a reset:
    // batches are identified by sequence, never by the log's length.
    const shrunk: MotionCueState = {
      sequence: cueState.sequence,
      cues: [],
      lastBatch: cueState.lastBatch,
    };
    const after = advanceMotionConsumer(active.state, shrunk, view([seat(SELF_ID, 'Ana')]));
    expect(after.plan).toBe(active.plan);
    expect(after.state.cursor).toEqual(active.state.cursor);
  });

  it('still animates a supported batch exactly once after the cue log saturates', () => {
    let state = initialMotionConsumerState();
    let cueState = createInitialMotionCueState();
    const roster = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno')]);

    // Saturate the log with confirmed batches up to the bound.
    for (let i = 0; i < MOTION_CUE_LOG_LIMIT; i += 1) {
      cueState = deriveMotionCues(cueState, [
        { type: 'HANDS_REDEALT', playerIds: [SELF_ID, OTHER_ID] },
      ]);
      const step = advanceMotionConsumer(state, cueState, roster);
      state = step.state;
      expect(step.plan).toEqual({ kind: 'hand-shuffle', sequence: cueState.sequence });
    }

    // Batch 21 crosses the bound: the log drops old entries, but the newest
    // batch is resolved by sequence and still waits for its destination.
    const crossed = deriveMotionCues(cueState, [
      { type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') },
    ]);
    const waiting = advanceMotionConsumer(state, crossed, roster);
    expect(waiting.state.cursor).toEqual({ sequence: MOTION_CUE_LOG_LIMIT + 1 });
    expect(waiting.state.pending?.cues).toEqual([
      { kind: 'card-played', playerId: SELF_ID, card: { value: 10, type: 'REY_GATO' } },
    ]);
    expect(waiting.plan).toEqual({ kind: 'hand-shuffle', sequence: MOTION_CUE_LOG_LIMIT });

    // The confirming projection resolves the crossed batch to one animation…
    const confirmingView = view([
      seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] }),
      seat(OTHER_ID, 'Bruno'),
    ]);
    const confirmed = advanceMotionConsumer(waiting.state, crossed, confirmingView);
    expect(confirmed.plan).toEqual({
      kind: 'card-landing',
      sequence: MOTION_CUE_LOG_LIMIT + 1,
      playerId: SELF_ID,
      card: { value: 10, type: 'REY_GATO' },
    });
    expect(confirmed.state.pending).toBeNull();

    // …and replaying the same batch never animates again.
    const settled = advanceMotionConsumer(confirmed.state, crossed, confirmingView);
    expect(settled.plan).toBe(confirmed.plan);
    expect(settled.state.cursor).toEqual(confirmed.state.cursor);
  });
});

describe('zone targeting helpers', () => {
  const roster = view([seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno'), seat(THIRD_ID, 'Caro')]);

  it('addresses hand-exchange to exactly the published pair', () => {
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'HANDS_SWAPPED', playerIds: [SELF_ID, OTHER_ID] }]),
      roster,
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(zoneMotionForPlayer(active, SELF_ID)).toEqual({ kind: 'hand-exchange', sequence: 1 });
    expect(zoneMotionForPlayer(active, OTHER_ID)).toEqual({ kind: 'hand-exchange', sequence: 1 });
    expect(zoneMotionForPlayer(active, THIRD_ID)).toBeNull();
  });

  it('addresses the effect settle to the actor only', () => {
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]),
      roster,
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(zoneMotionForPlayer(active, SELF_ID)).toEqual({ kind: 'effect-settle', sequence: 1 });
    expect(zoneMotionForPlayer(active, OTHER_ID)).toBeNull();
    expect(handMotionForPlayer(active, SELF_ID)).toBeNull();
    expect(discardMotionForPlayer(active, SELF_ID)).toBeNull();
  });

  it('addresses the draw settle to the destination hand zone of the addressed player only', () => {
    // The projection confirms the addressed player's pre-captured handCount.
    const confirmingView = view([
      seat(SELF_ID, 'Ana'),
      seat(OTHER_ID, 'Bruno', { handCount: 2 }),
      seat(THIRD_ID, 'Caro'),
    ]);
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'CARD_DRAWN', playerId: OTHER_ID }], { [OTHER_ID]: 1 }),
      confirmingView,
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(handMotionForPlayer(active, OTHER_ID)).toEqual({ kind: 'draw-settle', sequence: 1 });
    expect(handMotionForPlayer(active, SELF_ID)).toBeNull();
    expect(zoneMotionForPlayer(active, OTHER_ID)).toBeNull();
  });

  it('addresses landing and flip cues to the discard surface of the matching player only', () => {
    const landing = evaluateBatchMotion(
      batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
      view([seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] })]),
    );
    const landingPlan = landing.verdict === 'animate' ? landing.plan : null;
    expect(discardMotionForPlayer(landingPlan, SELF_ID)).toEqual({
      kind: 'card-landing',
      sequence: 1,
    });
    expect(discardMotionForPlayer(landingPlan, OTHER_ID)).toBeNull();

    const flip = evaluateBatchMotion(
      batchOf([{ type: 'PLAYER_ELIMINATED', playerId: OTHER_ID }]),
      view([
        seat(OTHER_ID, 'Bruno', {
          eliminated: true,
          discards: [discard(3, 'CONEJITO_GUERRILLERO', 'ELIMINATION_REVEAL')],
        }),
      ]),
    );
    const flipPlan = flip.verdict === 'animate' ? flip.plan : null;
    expect(discardMotionForPlayer(flipPlan, OTHER_ID)).toEqual({ kind: 'card-flip', sequence: 1 });
    expect(zoneMotionForPlayer(flipPlan, OTHER_ID)).toBeNull();
  });

  it('exposes the table-level shuffle cue and nothing else for HANDS_REDEALT', () => {
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'HANDS_REDEALT', playerIds: [SELF_ID, OTHER_ID] }]),
      roster,
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(tableShuffleMotion(active)).toEqual({ kind: 'hand-shuffle', sequence: 1 });
    expect(zoneMotionForPlayer(active, SELF_ID)).toBeNull();
    expect(handMotionForPlayer(active, SELF_ID)).toBeNull();
    expect(discardMotionForPlayer(active, SELF_ID)).toBeNull();
    expect(tableShuffleMotion(null)).toBeNull();
  });

  it('returns null helpers for a null plan', () => {
    expect(zoneMotionForPlayer(null, SELF_ID)).toBeNull();
    expect(handMotionForPlayer(null, SELF_ID)).toBeNull();
    expect(discardMotionForPlayer(null, SELF_ID)).toBeNull();
  });
});

describe('origin labels', () => {
  it('labels forced and elimination-reveal discards and stays silent about played cards', () => {
    expect(discardOriginLabel('FORCED_PLAY')).toBe('Forzada boca arriba');
    expect(discardOriginLabel('ELIMINATION_REVEAL')).toBe('Revelada por eliminación');
    expect(discardOriginLabel('PLAYED')).toBeNull();
  });
});

describe('center-action stage seam (centerStageMotion)', () => {
  it('exposes the confirmed public card for a card-landing plan', () => {
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
      view([seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] })]),
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(centerStageMotion(active)).toEqual({
      kind: 'card-landing',
      sequence: 1,
      card: { value: 10, type: 'REY_GATO' },
    });
  });

  it('exposes the confirmed public card for a forced-face-up flip plan', () => {
    const plan = evaluateBatchMotion(
      batchOf([
        {
          type: 'CARD_FORCED_FACE_UP',
          playerId: SELF_ID,
          card: card(5, 'SERPIENTE_ENCANTADORA'),
        },
      ]),
      view([
        seat(SELF_ID, 'Ana', {
          discards: [discard(5, 'SERPIENTE_ENCANTADORA', 'FORCED_PLAY')],
        }),
      ]),
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(centerStageMotion(active)).toEqual({
      kind: 'card-flip',
      sequence: 1,
      card: { value: 5, type: 'SERPIENTE_ENCANTADORA' },
    });
  });

  it('carries the projection-confirmed elimination reveal, never an invented identity', () => {
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'PLAYER_ELIMINATED', playerId: OTHER_ID }]),
      view([
        seat(OTHER_ID, 'Bruno', {
          eliminated: true,
          discards: [discard(3, 'CONEJITO_GUERRILLERO', 'ELIMINATION_REVEAL')],
        }),
      ]),
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    expect(centerStageMotion(active)).toEqual({
      kind: 'card-flip',
      sequence: 1,
      card: { value: 3, type: 'CONEJITO_GUERRILLERO' },
    });
  });

  it('is stageless for draws, effects, exchanges, shuffles, and a null plan', () => {
    const draw = evaluateBatchMotion(
      batchOf([{ type: 'CARD_DRAWN', playerId: SELF_ID }], { [SELF_ID]: 1 }),
      view([seat(SELF_ID, 'Ana', { handCount: 2 })]),
    );
    expect(centerStageMotion(draw.verdict === 'animate' ? draw.plan : null)).toBeNull();
    expect(centerStageMotion({ kind: 'effect-settle', sequence: 1, playerId: SELF_ID })).toBeNull();
    expect(
      centerStageMotion({ kind: 'hand-exchange', sequence: 1, playerIds: [SELF_ID, OTHER_ID] }),
    ).toBeNull();
    expect(centerStageMotion({ kind: 'hand-shuffle', sequence: 1 })).toBeNull();
    expect(centerStageMotion(null)).toBeNull();
  });

  it('never carries instance identity or private data in the stage payload', () => {
    const plan = evaluateBatchMotion(
      batchOf([{ type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') }]),
      view([seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] })]),
    );
    const active = plan.verdict === 'animate' ? plan.plan : null;
    const payload = JSON.stringify(centerStageMotion(active));
    expect(payload).not.toContain('instance');
    expect(payload).not.toContain('inst-');
    expect(payload).not.toContain(SELF_ID);
    expect(payload).not.toContain(OTHER_ID);
    // Public metadata only: exactly kind, sequence, and the {value,type} card.
    expect(payload).toBe(
      JSON.stringify({
        kind: 'card-landing',
        sequence: 1,
        card: { value: 10, type: 'REY_GATO' },
      }),
    );
  });

  it('collapses stagelessly across a projection-only reconnect-style reset', () => {
    const cueState = cueStateFrom([
      { type: 'CARD_PLAYED', playerId: SELF_ID, card: card(10, 'REY_GATO') },
    ]);
    const active = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana', { discards: [discard(10, 'REY_GATO', 'PLAYED')] })]),
    );
    expect(centerStageMotion(active.plan)).not.toBeNull();

    // The game cleared and re-projected: the plan is gone, so no stage can
    // replay across a reconnect.
    const reset = advanceMotionConsumer(
      active.state,
      createInitialMotionCueState(),
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(reset.plan).toBeNull();
    expect(centerStageMotion(reset.plan)).toBeNull();
  });
});

describe('motion stylesheet contract (static source)', () => {
  const css = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

  const KEYFRAMES = [
    'motion-draw-settle',
    'motion-card-landing',
    'motion-card-flip',
    'motion-hand-shuffle',
    'motion-hand-exchange',
    'motion-effect-settle',
    'motion-protection-settle',
    'motion-protection-expire',
    'motion-token-settle',
  ];

  /** Extracts the full brace-balanced block that follows `startMarker`. */
  function extractBlock(source: string, startMarker: string): string {
    const start = source.indexOf(startMarker);
    if (start === -1) {
      return '';
    }
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') {
        depth += 1;
      } else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(open + 1, i);
        }
      }
    }
    return '';
  }

  it('defines one-shot keyframes for every motion cue kind', () => {
    for (const name of KEYFRAMES) {
      expect(extractBlock(css, `@keyframes ${name}`)).not.toBe('');
    }
  });

  it('animates transform and opacity only — never layout properties', () => {
    for (const name of KEYFRAMES) {
      const body = extractBlock(css, `@keyframes ${name}`);
      const declarations = [...body.matchAll(/([a-zA-Z-]+)\s*:/g)].map((match) => match[1]);
      expect(declarations.length).toBeGreaterThan(0);
      for (const property of declarations) {
        expect(['opacity', 'transform']).toContain(property);
      }
    }
  });

  it('keeps one-shot cue durations inside the docs/14 bands and loops only ambient cues', () => {
    const animations = [...css.matchAll(/animation:\s*(motion-[a-z-]+)\s+(\d+)ms([^;]*);/g)];
    const names = animations.map((match) => match[1]);
    for (const name of KEYFRAMES) {
      expect(names).toContain(name);
    }
    const AMBIENT = ['motion-turn-halo', 'motion-deck-ready'];
    for (const [, name, duration, rest] of animations) {
      if (name === 'motion-announce') {
        // An announcement holds long enough to read, then fades on its own.
        expect(Number(duration)).toBeLessThanOrEqual(3000);
        continue;
      }
      if (AMBIENT.includes(name!)) {
        // Low-priority ambient cues are slow and soft (docs/14 "Current turn").
        expect(Number(duration)).toBeGreaterThanOrEqual(1500);
        continue;
      }
      // Micro feedback (120ms) up to round-win emphasis (1000ms); never looped.
      expect(Number(duration)).toBeGreaterThanOrEqual(120);
      expect(Number(duration)).toBeLessThanOrEqual(1000);
      expect(rest).not.toContain('infinite');
    }
  });

  it('collapses all motion hooks under prefers-reduced-motion while preserving final states', () => {
    const reduced = extractBlock(css, '@media (prefers-reduced-motion: reduce)');
    expect(reduced).toContain('[data-motion]');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('transform: none');
    // The keyed status and token pulse layers are hooked through data-motion,
    // so the generic [data-motion] collapse reaches them exactly like every
    // other cue surface.
    expect(css).toContain(".game-status-pulse[data-motion='protection-settle']");
    expect(css).toContain(".game-status-pulse[data-motion='protection-expire']");
    expect(css).toContain(".game-token-pulse[data-motion='token-settle']");
  });

  it('scopes the persistent-state styles to existing hooks without color-only meaning', () => {
    // The protection badge is a text-bearing pin marker, not a color switch.
    expect(css).toContain('.game-status-badge');
    expect(css).toContain('.game-status-icon');
    // The forced-play shell is strengthened structurally (border weight),
    // never by hue alone.
    expect(css).toContain(".game-discard-slot[data-forced='true']");
    // The keyed pulse layers are the status-cue destinations: the expiry pulse
    // must exist as a styled, reachable element, not a dead selector.
    expect(css).toContain('.game-status-pulse');
    expect(css).toContain('.game-token-pulse');
  });
});
