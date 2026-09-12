/**
 * Card 2 — Ratón Trampero (catalog §2; rules §13 privacy; engine spec §§5,6,8,
 * 10,16,18,21; multiplayer spec §12).
 *
 * Normative design under test:
 * - Voluntary `PLAYED` origin with a nonempty draw pile secretly detaches the
 *   top card of the draw pile into a private `RATON_INSERT_POSITION` pending
 *   interaction that carries the full detached CardInstance (conservation stays
 *   explicit), pauses the turn, and exposes no public identity or index.
 * - `CHOOSE_DECK_POSITION { actorId, index }` validates the matching
 *   actor/stage and an integer index in [0, current drawPile.length]; anything
 *   else is rejected with `INVALID_POSITION` (or the centralized routing codes)
 *   while the pending stays open and nothing mutates.
 * - On success the detached card is reinserted at the chosen index, the pending
 *   clears, a secret-free `RATON_RESOLVED { playerId }` is emitted, and the
 *   turn finalizes exactly once (deferred round-end check, then one advance).
 * - With an empty draw pile when the effect resolves, the hidden card is not
 *   used and remains unchanged: no pending opens, the card fizzles, and the
 *   normal exhaustion round resolution follows (project decision).
 * - Forced face-up placement and elimination reveals suppress the printed
 *   action (spec §18): no pending, no resolution event.
 * - The detached pending card is deep-cloned: result states never alias the
 *   input state's cards (spec §8 purity).
 */
import {
  createMatchState,
  eliminatePlayer,
  resolveFaceUpCardEffect,
  SeededRng,
  setupRound,
  type CardInstance,
  type PlayerId,
  type PlayerState,
  type RoundState,
} from '../src';
import { applyTurnCommand } from '../src/turn-engine';

type TurnResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurn = Extract<TurnResult, { ok: true }>;
type EffectResult = ReturnType<typeof resolveFaceUpCardEffect>;

const RATON_CARD: CardInstance = {
  instanceId: 'raton-instance',
  value: 2,
  type: 'RATON_TRAMPERO',
};
/** Controlled card that sits on top of the draw pile and gets secretly inspected. */
const INSPECTED_CARD: CardInstance = {
  instanceId: 'inspected-9-instance',
  value: 9,
  type: 'PECERA_DE_CRISTAL',
};
const DEEP_CARD_FOUR: CardInstance = {
  instanceId: 'value-4-instance',
  value: 4,
  type: 'NO_SOY_UNA_MASCOTA',
};
const DEEP_CARD_FIVE: CardInstance = {
  instanceId: 'value-5-instance',
  value: 5,
  type: 'ERMITANO_BUSCA_CASA',
};
/** Generic stand-in hand card with a controlled secret identity. */
function cardOfValue(value: number, instanceId?: string): CardInstance {
  return { instanceId: instanceId ?? `value-${value}-instance`, value, type: 'RATON_TRAMPERO' };
}
const HAND_STANDIN = cardOfValue(3, 'value-3-instance');

function createRound(playerIds: PlayerId[]): RoundState {
  const match = createMatchState({
    matchId: `match-${playerIds.join('-')}`,
    players: playerIds.map((id) => ({ id, name: id })),
  });
  return setupRound(match, new SeededRng(4242), ({ playerIds: ids }) => ids[0]);
}

function playerOf(round: RoundState, id: PlayerId): PlayerState {
  const player = round.players.find((candidate) => candidate.id === id);
  if (!player) {
    throw new Error(`Test fixture is missing player ${id}`);
  }
  return player;
}

function snapshotOf(round: RoundState): RoundState {
  return JSON.parse(JSON.stringify(round)) as RoundState;
}

function expectTurnSuccess(result: TurnResult): SuccessfulTurn {
  if (!result.ok) {
    throw new Error(`Expected a successful turn command, got error ${String(result.error)}`);
  }
  return result;
}

function expectTurnFailure(result: TurnResult): Extract<TurnResult, { ok: false }> {
  if (result.ok) {
    throw new Error(`Expected a rejected turn command, but it succeeded`);
  }
  return result;
}

interface StagedRaton {
  played: SuccessfulTurn;
  inspectedCard: CardInstance;
}

/**
 * Stages a full voluntary Ratón play with controlled identities: the actor
 * holds Ratón plus one remaining stand-in card, and the draw pile starts with
 * the inspected card. Returns the paused pending state.
 */
function stageRatonPending(
  round: RoundState,
  actorId: PlayerId,
  options: { drawPile?: CardInstance[] } = {},
): StagedRaton {
  playerOf(round, actorId).hand = [RATON_CARD, HAND_STANDIN];
  round.phase = 'PLAY_REQUIRED';
  round.drawPile = options.drawPile ?? [INSPECTED_CARD, DEEP_CARD_FOUR, DEEP_CARD_FIVE];
  const played = expectTurnSuccess(
    applyTurnCommand(round, {
      type: 'PLAY_CARD',
      actorId,
      cardInstanceId: RATON_CARD.instanceId,
    }),
  );
  return { played, inspectedCard: INSPECTED_CARD };
}

/** Collects every card instanceId across all locations, including the pending card. */
function allCardInstanceIds(round: RoundState): string[] {
  const ids: string[] = [
    round.hiddenCard.instanceId,
    ...round.drawPile.map((card) => card.instanceId),
  ];
  for (const player of round.players) {
    ids.push(...player.hand.map((card) => card.instanceId));
    ids.push(...player.discards.map((entry) => entry.card.instanceId));
  }
  if (round.pendingInteraction?.type === 'RATON_INSERT_POSITION') {
    ids.push(round.pendingInteraction.card.instanceId);
  }
  return ids.sort();
}

function openPendingOf(round: RoundState): {
  type: 'RATON_INSERT_POSITION';
  actorId: PlayerId;
  card: CardInstance;
} {
  const pending = round.pendingInteraction;
  if (!pending || pending.type !== 'RATON_INSERT_POSITION') {
    throw new Error('Test fixture expected an open RATON_INSERT_POSITION pending interaction');
  }
  return pending;
}

describe('Card 2 Ratón Trampero — voluntary play opens the secret reinsertion decision', () => {
  it('detaches the draw-pile top card into the pending state and pauses the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1');

    expect(openPendingOf(played.state)).toEqual({
      type: 'RATON_INSERT_POSITION',
      actorId: 'p1',
      card: INSPECTED_CARD,
    });
    // The top card left the draw pile; the rest of the pile is untouched.
    expect(played.state.drawPile).toEqual([DEEP_CARD_FOUR, DEEP_CARD_FIVE]);
    // The played Ratón is in the public discard area with origin PLAYED.
    expect(playerOf(played.state, 'p1').discards).toEqual([{ card: RATON_CARD, origin: 'PLAYED' }]);
    expect(playerOf(played.state, 'p1').hand).toEqual([HAND_STANDIN]);
    // The turn is paused: same actor, still PLAY_REQUIRED.
    expect(played.state.currentPlayerId).toBe('p1');
    expect(played.state.phase).toBe('PLAY_REQUIRED');
    expect(played.state.status).toBe('ROUND_ACTIVE');
    // The hidden card is not involved in the inspection.
    expect(played.state.hiddenCard).toEqual(round.hiddenCard);
    expect(played.events).toEqual([{ type: 'CARD_PLAYED', playerId: 'p1', card: RATON_CARD }]);
  });

  it('exposes no public identity or index for the inspected card when the pending opens', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, inspectedCard } = stageRatonPending(round, 'p1');

    const serializedEvents = JSON.stringify(played.events);
    expect(serializedEvents).not.toContain(inspectedCard.instanceId);
    expect(serializedEvents).not.toContain('"index"');
    expect(played.events.every((event) => event.type !== 'RATON_RESOLVED')).toBe(true);
  });

  it('hands the actor a detached deep clone that never aliases the input draw pile', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1');
    // The command must not mutate the input: the staged head is still there.
    const inputTopCard = round.drawPile[0];
    const pendingCard = openPendingOf(played.state).card;

    expect(round.drawPile[0]).toBe(INSPECTED_CARD);
    expect(pendingCard).not.toBe(inputTopCard);
    // Mutating the detached pending card never leaks into the input state.
    pendingCard.instanceId = 'mutated-instance';
    expect(round.drawPile[0]).toEqual(INSPECTED_CARD);
  });
});

describe('Card 2 Ratón Trampero — CHOOSE_DECK_POSITION reinsertion positions', () => {
  it.each([
    {
      label: 'the top (index 0)',
      index: 0,
      expected: [INSPECTED_CARD, DEEP_CARD_FOUR, DEEP_CARD_FIVE],
    },
    {
      label: 'the middle (index 1)',
      index: 1,
      expected: [DEEP_CARD_FOUR, INSPECTED_CARD, DEEP_CARD_FIVE],
    },
    {
      label: 'the end (index === length)',
      index: 2,
      expected: [DEEP_CARD_FOUR, DEEP_CARD_FIVE, INSPECTED_CARD],
    },
  ])(
    'reinserts the detached card at $label and finalizes the turn exactly once',
    ({ index, expected }) => {
      const round = createRound(['p1', 'p2', 'p3']);
      const { played } = stageRatonPending(round, 'p1');

      const result = expectTurnSuccess(
        applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index }),
      );

      expect(result.state.drawPile).toEqual(expected);
      expect(result.state.pendingInteraction).toBeNull();
      // The turn finalized exactly once.
      expect(result.state.currentPlayerId).toBe('p2');
      expect(result.state.phase).toBe('DRAW_REQUIRED');
      expect(result.state.status).toBe('ROUND_ACTIVE');
      expect(result.events).toEqual([{ type: 'RATON_RESOLVED', playerId: 'p1' }]);
      // The play and the reinsertion keep the hand and discard area untouched.
      expect(playerOf(result.state, 'p1').discards).toEqual([
        { card: RATON_CARD, origin: 'PLAYED' },
      ]);
      expect(playerOf(result.state, 'p1').hand).toEqual([HAND_STANDIN]);
    },
  );

  it('conserves every card instance exactly once across the whole flow', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1');
    const beforeIds = allCardInstanceIds(played.state);

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 1 }),
    );

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });

  it('reinserts a fresh clone of the detached card instead of the input pending card', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1');
    const inputPending = played.state.pendingInteraction;

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 0 }),
    );

    // The input state and its pending card stay untouched (spec §8 purity).
    expect(inputPending).toEqual({
      type: 'RATON_INSERT_POSITION',
      actorId: 'p1',
      card: INSPECTED_CARD,
    });
    expect(result.state.drawPile[0]).not.toBe(
      inputPending && inputPending.type === 'RATON_INSERT_POSITION' ? inputPending.card : undefined,
    );
    expect(result.state.drawPile[0]).toEqual(INSPECTED_CARD);
  });
});

describe('Card 2 Ratón Trampero — invalid insertion positions', () => {
  it.each([-1, 3, 4, 0.5, Number.NaN, '0', null, undefined])(
    'rejects index %p with INVALID_POSITION, keeps the pending open, and mutates nothing',
    (invalidIndex) => {
      const round = createRound(['p1', 'p2', 'p3']);
      const { played } = stageRatonPending(round, 'p1');
      const before = snapshotOf(played.state);

      const result = expectTurnFailure(
        applyTurnCommand(played.state, {
          type: 'CHOOSE_DECK_POSITION',
          actorId: 'p1',
          index: invalidIndex as unknown as number,
        }),
      );

      expect(result.error).toBe('INVALID_POSITION');
      expect(result.state).toEqual(before);
      expect(openPendingOf(result.state)).toEqual({
        type: 'RATON_INSERT_POSITION',
        actorId: 'p1',
        card: INSPECTED_CARD,
      });
      expect(result.state.drawPile).toEqual([DEEP_CARD_FOUR, DEEP_CARD_FIVE]);
    },
  );
});

describe('Card 2 Ratón Trampero — pending command routing', () => {
  it('rejects CHOOSE_DECK_POSITION from a wrong actor with NOT_YOUR_TURN and keeps the pending open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p2', index: 0 }),
    );

    expect(result.error).toBe('NOT_YOUR_TURN');
    expect(result.state).toEqual(before);
    expect(openPendingOf(result.state)).toEqual({
      type: 'RATON_INSERT_POSITION',
      actorId: 'p1',
      card: INSPECTED_CARD,
    });
  });

  it.each([
    { label: 'DRAW_CARD', command: { type: 'DRAW_CARD', actorId: 'p1' } },
    {
      label: 'PLAY_CARD',
      command: { type: 'PLAY_CARD', actorId: 'p1', cardInstanceId: 'value-3-instance' },
    },
    { label: 'CHOOSE_TARGET', command: { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' } },
    { label: 'SUBMIT_GUESS', command: { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 } },
    {
      label: 'CHOOSE_HIDDEN_SWAP',
      command: { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true },
    },
  ] as const)(
    'rejects $label while the RATON_INSERT_POSITION decision is owed with PENDING_DECISION_REQUIRED',
    ({ command }) => {
      const round = createRound(['p1', 'p2', 'p3']);
      const { played } = stageRatonPending(round, 'p1');
      const before = snapshotOf(played.state);

      const result = expectTurnFailure(
        applyTurnCommand(played.state, command as Parameters<typeof applyTurnCommand>[1]),
      );

      expect(result.error).toBe('PENDING_DECISION_REQUIRED');
      expect(result.state).toEqual(before);
      expect(openPendingOf(result.state)).toEqual({
        type: 'RATON_INSERT_POSITION',
        actorId: 'p1',
        card: INSPECTED_CARD,
      });
    },
  );

  it('rejects CHOOSE_DECK_POSITION when no pending interaction is open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [RATON_CARD, HAND_STANDIN];
    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    const before = snapshotOf(drawn.state);

    const result = expectTurnFailure(
      applyTurnCommand(drawn.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 0 }),
    );

    expect(result.error).toBe('PENDING_DECISION_REQUIRED');
    expect(result.state).toEqual(before);
  });
});

describe('Card 2 Ratón Trampero — empty draw pile fizzles without touching the hidden card', () => {
  it('opens no pending, keeps the hidden card unchanged, and resolves the round through normal exhaustion', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const hiddenCard = cardOfValue(8, 'hidden-8-instance');
    round.hiddenCard = hiddenCard;
    playerOf(round, 'p1').hand = [RATON_CARD, HAND_STANDIN];
    round.phase = 'PLAY_REQUIRED';
    round.drawPile = [];
    const before = snapshotOf(round);

    const result = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: RATON_CARD.instanceId,
      }),
    );

    // The effect fizzles: no pending interaction opens.
    expect(result.state.pendingInteraction).toBeNull();
    // The hidden card is not used as a replacement and remains unchanged.
    expect(result.state.hiddenCard).toEqual(hiddenCard);
    // The card is still discarded publicly, then the round ends through the
    // normal exhaustion check with the M4 winner resolution (rules §9).
    expect(playerOf(result.state, 'p1').discards).toEqual([{ card: RATON_CARD, origin: 'PLAYED' }]);
    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 keeps value 3, p2 holds value 5, p3 value 1 — p2 wins.
    expect(result.state.winners).toEqual(['p2']);
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    const p2Hand = playerOf(round, 'p2').hand[0];
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'CARD_PLAYED', playerId: 'p1', card: RATON_CARD },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: HAND_STANDIN },
          { playerId: 'p2', card: p2Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
    expect(round).toEqual(before);
  });
});

describe('Card 2 Ratón Trampero — exhaustion timing defers the round-end check', () => {
  it('does not end the round while the decision is owed on an emptied draw pile, then continues after reinsertion', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1', { drawPile: [INSPECTED_CARD] });

    // The pending opened with the last drawable card: the pile is empty while
    // the decision is owed, but the round must not end yet.
    expect(played.state.drawPile).toEqual([]);
    expect(played.state.status).toBe('ROUND_ACTIVE');
    expect(played.state.pendingInteraction).not.toBeNull();

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 0 }),
    );

    // The detached card is restored and the round continues normally.
    expect(result.state.drawPile).toEqual([INSPECTED_CARD]);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.events).toEqual([{ type: 'RATON_RESOLVED', playerId: 'p1' }]);
  });
});

describe('Card 2 Ratón Trampero — suppression of the printed action', () => {
  it('does not open a pending interaction when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.drawPile = [INSPECTED_CARD, DEEP_CARD_FOUR, DEEP_CARD_FIVE];
    const before = snapshotOf(round);

    const result: EffectResult = resolveFaceUpCardEffect(round, {
      playerId: 'p1',
      card: RATON_CARD,
      origin: 'FORCED_PLAY',
    });

    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.drawPile).toEqual([INSPECTED_CARD, DEEP_CARD_FOUR, DEEP_CARD_FIVE]);
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(round).toEqual(before);
  });

  it('does not open a pending interaction through the elimination-reveal origin', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = resolveFaceUpCardEffect(round, {
      playerId: 'p1',
      card: RATON_CARD,
      origin: 'ELIMINATION_REVEAL',
    });

    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.events).toEqual([]);
    expect(round).toEqual(before);
  });

  it('keeps the elimination-reveal path out of the pending flow entirely', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    round.drawPile = [INSPECTED_CARD, DEEP_CARD_FOUR, DEEP_CARD_FIVE];
    playerOf(round, 'p2').hand = [RATON_CARD];
    const before = snapshotOf(round);

    const result = eliminatePlayer(round, 'p2');

    if (!result.ok) {
      throw new Error(`Expected a successful elimination, got error ${String(result.error)}`);
    }
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.drawPile).toEqual([INSPECTED_CARD, DEEP_CARD_FOUR, DEEP_CARD_FIVE]);
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: RATON_CARD, origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(result.events.every((event) => event.type === 'PLAYER_ELIMINATED')).toBe(true);
    expect(round).toEqual(before);
  });
});

describe('Card 2 Ratón Trampero — purity of command processing', () => {
  it('does not mutate the input state when the pending opens or when it resolves', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageRatonPending(round, 'p1');
    const fixture = snapshotOf(played.state);
    const pendingBefore = openPendingOf(played.state);

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 0 }),
    );

    expect(played.state).toEqual(fixture);
    expect(result.state).not.toBe(played.state);
    expect(pendingBefore.card).not.toBe(result.state.drawPile[0]);
    expect(result.state.pendingInteraction).toBeNull();
  });
});
