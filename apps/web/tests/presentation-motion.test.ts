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
  discardMotionForPlayer,
  discardOriginLabel,
  evaluateBatchMotion,
  handMotionForPlayer,
  initialMotionConsumerState,
  tableShuffleMotion,
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
 * handCounts.
 */
function batchOf(
  events: GamePublicEvent[],
  preCounts: Record<string, number> | null = null,
): PendingMotionBatch {
  const cueState = cueStateFrom(events);
  return { sequence: cueState.sequence, cues: cueState.lastBatch?.cues ?? [], preCounts };
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
      plan: { kind: 'card-landing', sequence: 1, playerId: SELF_ID },
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
      plan: { kind: 'card-flip', sequence: 1, playerId: SELF_ID },
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
      plan: { kind: 'card-flip', sequence: 1, playerId: OTHER_ID },
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
      plan: { kind: 'card-landing', sequence: 1, playerId: OTHER_ID },
    });
  });

  it('never animates protection or token cues', () => {
    const roster = view([seat(SELF_ID, 'Ana')]);
    expect(
      evaluateBatchMotion(batchOf([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }]), roster),
    ).toEqual({ verdict: 'none' });
    expect(
      evaluateBatchMotion(
        batchOf([
          { type: 'PLAYER_PROTECTED', playerId: SELF_ID },
          { type: 'PROTECTION_EXPIRED', playerId: SELF_ID },
        ]),
        roster,
      ),
    ).toEqual({ verdict: 'none' });
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
    });
    expect(confirmed.state.pending).toBeNull();
  });

  it('clears all cue attributes on an unsupported-only batch', () => {
    const cueState = cueStateFrom([{ type: 'TOKEN_AWARDED', playerId: SELF_ID }]);
    const { state, plan } = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(plan).toBeNull();
    expect(state.pending).toBeNull();
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

  it('collapses to a motionless state on a sequence reset (reconnect or cleared game)', () => {
    const cueState = cueStateFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]);
    const active = advanceMotionConsumer(
      initialMotionConsumerState(),
      cueState,
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(active.plan).not.toBeNull();

    const reset = advanceMotionConsumer(
      active.state,
      createInitialMotionCueState(),
      view([seat(SELF_ID, 'Ana')]),
    );
    expect(reset.plan).toBeNull();
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
    expect(discardOriginLabel('FORCED_PLAY')).toBe('Forced face up');
    expect(discardOriginLabel('ELIMINATION_REVEAL')).toBe('Revealed by elimination');
    expect(discardOriginLabel('PLAYED')).toBeNull();
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

  it('keeps every motion duration inside the 180–320ms band and never loops', () => {
    const animations = [...css.matchAll(/animation:\s*(motion-[a-z-]+)\s+(\d+)ms/g)];
    const names = animations.map((match) => match[1]);
    for (const name of KEYFRAMES) {
      expect(names).toContain(name);
    }
    for (const match of animations) {
      const duration = Number(match[2]);
      expect(duration).toBeGreaterThanOrEqual(180);
      expect(duration).toBeLessThanOrEqual(320);
    }
    expect(css).not.toContain('infinite');
  });

  it('collapses all motion hooks under prefers-reduced-motion while preserving final states', () => {
    const reduced = extractBlock(css, '@media (prefers-reduced-motion: reduce)');
    expect(reduced).toContain('[data-motion]');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('transform: none');
  });
});
