/**
 * Pending-decision selector contract (WU8): the modal's only legality source.
 * The model is derived exclusively from the viewer-matching
 * `privateView.pendingDecision` plus the exact `legalActions` the server
 * published to this seat. It fails closed on malformed or stale projections,
 * never invents a decision, never invents a value (1 is never guessed), and
 * never surfaces a raw unknown id where a public roster name is required.
 */
import { evaluatePendingDecision } from '@/lib/game/pending-decision';
import type { GameCardInstance, PrivateGameView, TurnCommand } from '@power-hungry-pets/protocol';
import { OTHER_ID, privateView, publicView, roundView, SELF_ID } from './helpers/game-views';

const HIDDEN_CARD: GameCardInstance = {
  instanceId: 'hidden-instance-1',
  value: 6,
  type: 'SAQUEADOG_DE_TUMBAS',
};

const INSPECTED_CARD: GameCardInstance = {
  instanceId: 'inspected-instance-1',
  value: 2,
  type: 'RATON_TRAMPERO',
};

/** Canonical Pecera guess actions: values 0 and 2..10 (1 is never generated). */
function guessActions(actorId: string, values: number[]): TurnCommand[] {
  return values.map((value) => ({ type: 'SUBMIT_GUESS', actorId, value }));
}

function viewWith(
  viewerId: string,
  pendingDecision: PrivateGameView['pendingDecision'],
  legalActions: TurnCommand[],
): PrivateGameView {
  const base = privateView(viewerId, [], legalActions);
  return { ...base, pendingDecision };
}

describe('pending-decision selector: fail-closed foundations', () => {
  it('derives no decision while the private projection is missing', () => {
    expect(evaluatePendingDecision(null, SELF_ID).kind).toBe('none');
  });

  it('derives no decision from a private view addressed to another viewer', () => {
    const view = viewWith(OTHER_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
    ]);
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('none');
  });

  it('derives no decision while pendingDecision is null', () => {
    const view = privateView(
      SELF_ID,
      [],
      [{ type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' }],
    );
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('none');
  });

  it('derives no decision when the pending actor is not this viewer', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: OTHER_ID }, [
      { type: 'CHOOSE_TARGET', actorId: OTHER_ID, targetId: SELF_ID },
    ]);
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('none');
  });

  it('derives no decision when legalActions is malformed', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, []);
    (view as { legalActions: unknown }).legalActions = 'not-an-array';
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('derives no decision when legalActions is malformed and no decision is pending', () => {
    const view = privateView(SELF_ID, [], []);
    (view as { legalActions: unknown }).legalActions = 'not-an-array';
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('none');
  });
});

describe('pending-decision selector: Pecera target stage', () => {
  it('resolves legal CHOOSE_TARGET actions to public roster names', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
    ]);
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
  });

  it('keeps the published target order and dedupes exact duplicates', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
    ]);
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
  });

  it('renders unavailable when every published target lacks a public counterpart', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: 'p-ghost' },
    ]);
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when the stage carries no matching CHOOSE_TARGET actions', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, []);
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when the actions belong to another actor', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, [
      { type: 'CHOOSE_TARGET', actorId: OTHER_ID, targetId: SELF_ID },
    ]);
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when the actions carry a malformed target id', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, []);
    view.legalActions = [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: 7 as unknown as string },
    ];
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('skips a malformed target entry while valid published options remain', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, []);
    view.legalActions = [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: 7 as unknown as string },
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
    ];
    // A malformed entry is skipped, never repaired; the valid published option
    // still reaches the modal, and no raw id is surfaced for the bad one.
    expect(evaluatePendingDecision(view, SELF_ID)).toEqual({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
  });
});

describe('pending-decision selector: Pecera guess stage', () => {
  it('carries exactly the published guess values, never an invented 1', () => {
    const values = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: OTHER_ID },
      guessActions(SELF_ID, values),
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'submit-guess',
      targetId: OTHER_ID,
      targetName: 'Bruno',
      values,
    });
  });

  it('never invents a guess value the server did not publish', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: OTHER_ID },
      guessActions(SELF_ID, [3, 5]),
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'submit-guess',
      targetId: OTHER_ID,
      targetName: 'Bruno',
      values: [3, 5],
    });
  });

  it('keeps the published value order and dedupes exact duplicates', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: OTHER_ID },
      guessActions(SELF_ID, [5, 3, 5]),
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision.kind === 'submit-guess' && decision.values).toEqual([5, 3]);
  });

  it('resolves the guessed target to a public name and never surfaces a raw id', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: 'p-ghost' },
      guessActions(SELF_ID, [4]),
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'submit-guess',
      targetId: 'p-ghost',
      targetName: null,
      values: [4],
    });
  });

  it('renders unavailable when the stage carries no matching SUBMIT_GUESS actions', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: OTHER_ID },
      [],
    );
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when the published values are malformed', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: OTHER_ID },
      [],
    );
    view.legalActions = [
      { type: 'SUBMIT_GUESS', actorId: SELF_ID, value: 'five' as unknown as number },
    ];
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });
});

describe('pending-decision selector: Saqueadog swap stage', () => {
  it('carries the private hidden card and both published swap options', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
      [
        { type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: false },
        { type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: true },
      ],
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'choose-hidden-swap',
      hiddenCard: HIDDEN_CARD,
      keepAllowed: true,
      swapAllowed: true,
    });
  });

  it('offers only the swap options the server actually published', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
      [{ type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: false }],
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'choose-hidden-swap',
      hiddenCard: HIDDEN_CARD,
      keepAllowed: true,
      swapAllowed: false,
    });
  });

  it('renders unavailable when the stage carries no matching CHOOSE_HIDDEN_SWAP actions', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
      [],
    );
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });
});

describe('pending-decision selector: Ratón reinsertion stage', () => {
  it('carries the inspected card and the published insertion indexes', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'RATON_INSERT_POSITION', actorId: SELF_ID, card: INSPECTED_CARD },
      [
        { type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 0 },
        { type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 1 },
        { type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 2 },
      ],
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'choose-deck-position',
      card: INSPECTED_CARD,
      positions: [0, 1, 2],
    });
  });

  it('keeps the published position order and dedupes exact duplicates', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'RATON_INSERT_POSITION', actorId: SELF_ID, card: INSPECTED_CARD },
      [
        { type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 2 },
        { type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 0 },
        { type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 2 },
      ],
    );
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision.kind === 'choose-deck-position' && decision.positions).toEqual([2, 0]);
  });

  it('renders unavailable when the stage carries no matching CHOOSE_DECK_POSITION actions', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'RATON_INSERT_POSITION', actorId: SELF_ID, card: INSPECTED_CARD },
      [],
    );
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when the published indexes are malformed', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'RATON_INSERT_POSITION', actorId: SELF_ID, card: INSPECTED_CARD },
      [],
    );
    view.legalActions = [{ type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: -1 }];
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });
});

describe('pending-decision selector: stage/action mismatch fails closed', () => {
  it('renders unavailable when a guess stage carries target actions instead', () => {
    const view = viewWith(SELF_ID, { type: 'PECERA_GUESS', actorId: SELF_ID, targetId: OTHER_ID }, [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
    ]);
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when a target stage carries guess actions instead', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'PECERA_TARGET', actorId: SELF_ID },
      guessActions(SELF_ID, [4]),
    );
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });

  it('renders unavailable when a swap stage carries deck-position actions instead', () => {
    const view = viewWith(
      SELF_ID,
      { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
      [{ type: 'CHOOSE_DECK_POSITION', actorId: SELF_ID, index: 0 }],
    );
    expect(evaluatePendingDecision(view, SELF_ID).kind).toBe('unavailable');
  });
});

describe('pending-decision selector: selector is pure over the public roster', () => {
  it('resolves names only from the private view’s own public projection', () => {
    const rosterView = publicView({
      round: roundView({ pendingInteraction: { type: 'PECERA_TARGET', actorId: SELF_ID } }),
    });
    const view = viewWith(SELF_ID, { type: 'PECERA_TARGET', actorId: SELF_ID }, [
      { type: 'CHOOSE_TARGET', actorId: SELF_ID, targetId: OTHER_ID },
    ]);
    view.publicView = rosterView;
    const decision = evaluatePendingDecision(view, SELF_ID);
    expect(decision).toEqual({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
  });
});
