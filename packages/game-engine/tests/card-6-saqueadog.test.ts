/**
 * Card 6 — Saqueadog de Tumbas (catalog §6; rules §13 privacy; engine spec §§5,
 * 6, 8, 10, 16, 18, 21; multiplayer spec §12; test plan §20).
 *
 * Normative design under test:
 * - Voluntary `PLAYED` origin opens a `SAQUEADOG_SWAP` pending interaction for
 *   the actor and pauses the turn (spec §6); the hidden card stays in canonical
 *   state for the actor's private access with no public identity event.
 * - `CHOOSE_HIDDEN_SWAP { actorId, swap }` resolves the decision: `true`
 *   atomically exchanges the actor's one remaining hand card with the hidden
 *   card (each becomes the other's slot); `false` leaves both identities
 *   unchanged. Either way the pending clears and the turn finalizes exactly
 *   once (deferred round-end check, then the single advance).
 * - The public `SAQUEADOG_RESOLVED` event carries only the actor id — never the
 *   hidden identity, the hand identity, or the swap choice (multiplayer spec
 *   §12: "do not reveal whether the player swapped").
 * - Forced face-up placement and elimination reveals suppress the printed
 *   action (spec §18): no pending opens and no resolution event exists.
 * - A Rey Gato moved by the hidden swap is never face up, so its intrinsic
 *   trigger does not fire (catalog §10; same reasoning as Card 9).
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

const SAQUEADOG_CARD: CardInstance = {
  instanceId: 'saqueadog-instance',
  value: 6,
  type: 'SAQUEADOG_DE_TUMBAS',
};
const REY_GATO_CARD: CardInstance = {
  instanceId: 'rey-gato-instance',
  value: 10,
  type: 'REY_GATO',
};

/** Generic stand-in hand card with a controlled secret identity. */
function cardOfValue(value: number, instanceId?: string): CardInstance {
  return { instanceId: instanceId ?? `value-${value}-instance`, value, type: 'RATON_TRAMPERO' };
}

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

interface StagedSaqueadog {
  played: SuccessfulTurn;
  hiddenCard: CardInstance;
  handCard: CardInstance;
}

/**
 * Stages a full voluntary Saqueadog play with controlled private identities:
 * the actor holds Saqueadog plus one remaining stand-in card, and the hidden
 * slot holds a controlled card. Returns the paused pending state.
 */
function stageSaqueadogPending(
  round: RoundState,
  actorId: PlayerId,
  options: { hiddenCard?: CardInstance; handCard?: CardInstance } = {},
): StagedSaqueadog {
  const hiddenCard = options.hiddenCard ?? cardOfValue(5, 'hidden-5-instance');
  const handCard = options.handCard ?? cardOfValue(3, 'value-3-instance');
  playerOf(round, actorId).hand = [SAQUEADOG_CARD];
  round.hiddenCard = hiddenCard;
  const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId }));
  playerOf(drawn.state, actorId).hand = [SAQUEADOG_CARD, handCard];
  const played = expectTurnSuccess(
    applyTurnCommand(drawn.state, {
      type: 'PLAY_CARD',
      actorId,
      cardInstanceId: SAQUEADOG_CARD.instanceId,
    }),
  );
  return { played, hiddenCard, handCard };
}

/** Collects every card instanceId across all locations; used for conservation checks. */
function allCardInstanceIds(round: RoundState): string[] {
  const ids: string[] = [
    round.hiddenCard.instanceId,
    ...round.drawPile.map((card) => card.instanceId),
  ];
  for (const player of round.players) {
    ids.push(...player.hand.map((card) => card.instanceId));
    ids.push(...player.discards.map((entry) => entry.card.instanceId));
  }
  return ids.sort();
}

describe('Card 6 Saqueadog — voluntary play opens the hidden swap decision', () => {
  it('opens SAQUEADOG_SWAP, discards the card publicly, and pauses the turn', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard, handCard } = stageSaqueadogPending(round, 'p1');

    expect(played.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    expect(playerOf(played.state, 'p1').discards).toEqual([
      { card: SAQUEADOG_CARD, origin: 'PLAYED' },
    ]);
    expect(playerOf(played.state, 'p1').hand).toEqual([handCard]);
    // The turn is paused: same actor, still PLAY_REQUIRED.
    expect(played.state.currentPlayerId).toBe('p1');
    expect(played.state.phase).toBe('PLAY_REQUIRED');
    expect(played.state.status).toBe('ROUND_ACTIVE');
    // The hidden card keeps its identity in canonical state for the actor's
    // private access; the play itself does not touch or reveal it.
    expect(played.state.hiddenCard).toEqual(hiddenCard);
    expect(played.events).toEqual([{ type: 'CARD_PLAYED', playerId: 'p1', card: SAQUEADOG_CARD }]);
  });

  it('emits no public identity event for the hidden card when the pending opens', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard } = stageSaqueadogPending(round, 'p1');

    const serializedEvents = JSON.stringify(played.events);
    expect(serializedEvents).not.toContain(hiddenCard.instanceId);
    expect(played.events.every((event) => event.type !== 'SAQUEADOG_RESOLVED')).toBe(true);
  });

  it('ignores a stray targetId on the play command — the swap is a pending decision', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p1').hand = [SAQUEADOG_CARD];
    const drawn = expectTurnSuccess(applyTurnCommand(round, { type: 'DRAW_CARD', actorId: 'p1' }));
    playerOf(drawn.state, 'p1').hand = [SAQUEADOG_CARD, cardOfValue(3, 'value-3-instance')];

    const result = expectTurnSuccess(
      applyTurnCommand(drawn.state, {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: SAQUEADOG_CARD.instanceId,
        targetId: 'p2',
      }),
    );

    expect(result.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    expect(result.state.currentPlayerId).toBe('p1');
  });
});

describe('Card 6 Saqueadog — CHOOSE_HIDDEN_SWAP with swap=true exchanges identities', () => {
  it('atomically swaps the remaining hand card with the hidden card and finalizes the turn once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard, handCard } = stageSaqueadogPending(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p1',
        swap: true,
      }),
    );

    // Atomic exchange: each identity moved to the other's slot.
    expect(playerOf(result.state, 'p1').hand).toEqual([hiddenCard]);
    expect(result.state.hiddenCard).toEqual(handCard);
    expect(result.state.pendingInteraction).toBeNull();
    // The turn finalized exactly once.
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([{ type: 'SAQUEADOG_RESOLVED', playerId: 'p1' }]);
  });

  it('keeps the played Saqueadog in the public discard area through the swap', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageSaqueadogPending(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    expect(playerOf(result.state, 'p1').discards).toEqual([
      { card: SAQUEADOG_CARD, origin: 'PLAYED' },
    ]);
  });

  it('does not fire the Rey Gato intrinsic when the hidden Rey Gato enters a hand', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, handCard } = stageSaqueadogPending(round, 'p1', {
      hiddenCard: REY_GATO_CARD,
    });

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    // The Rey Gato moved hand-slot to hand-slot without ever being face up, so
    // it neither triggers nor eliminates anyone (catalog §10).
    expect(playerOf(result.state, 'p1').hand).toEqual([REY_GATO_CARD]);
    expect(result.state.hiddenCard).toEqual(handCard);
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events.some((event) => event.type === 'PLAYER_ELIMINATED')).toBe(false);
    expect(result.events).toEqual([{ type: 'SAQUEADOG_RESOLVED', playerId: 'p1' }]);
  });

  it('does not mutate the input state and preserves the pending deep clone', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageSaqueadogPending(round, 'p1');
    const inputPending = played.state.pendingInteraction;
    if (!inputPending) {
      throw new Error('Test fixture expected an open pending interaction');
    }
    const before = snapshotOf(played.state);

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    // The input state is untouched, including its open pending interaction.
    expect(played.state).toEqual(before);
    expect(played.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    expect(played.state.pendingInteraction).toBe(inputPending);
    expect(result.state).not.toBe(played.state);
    expect(result.state.pendingInteraction).toBeNull();
  });

  it('conserves every card instance exactly once across the swap', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageSaqueadogPending(round, 'p1');
    const beforeIds = allCardInstanceIds(played.state);

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
  });
});

describe('Card 6 Saqueadog — CHOOSE_HIDDEN_SWAP with swap=false keeps both identities', () => {
  it('leaves the hand card and the hidden card unchanged and finalizes the turn once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard, handCard } = stageSaqueadogPending(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: false }),
    );

    expect(playerOf(result.state, 'p1').hand).toEqual([handCard]);
    expect(result.state.hiddenCard).toEqual(hiddenCard);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    expect(result.state.status).toBe('ROUND_ACTIVE');
    expect(result.events).toEqual([{ type: 'SAQUEADOG_RESOLVED', playerId: 'p1' }]);
  });

  it('does not mutate the input state and conserves every card instance exactly once', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageSaqueadogPending(round, 'p1');
    const before = snapshotOf(played.state);
    const beforeIds = allCardInstanceIds(played.state);

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: false }),
    );

    expect(played.state).toEqual(before);
    expect(allCardInstanceIds(result.state)).toEqual(beforeIds);
    expect(result.state.pendingInteraction).toBeNull();
  });
});

describe('Card 6 Saqueadog — pending command routing', () => {
  it('rejects CHOOSE_HIDDEN_SWAP from a wrong actor with NOT_YOUR_TURN and keeps the pending open', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageSaqueadogPending(round, 'p1');
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p2',
        swap: true,
      }),
    );

    expect(result.error).toBe('NOT_YOUR_TURN');
    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
  });

  it.each([
    { label: 'DRAW_CARD', command: { type: 'DRAW_CARD', actorId: 'p1' } },
    {
      label: 'PLAY_CARD',
      command: {
        type: 'PLAY_CARD',
        actorId: 'p1',
        cardInstanceId: 'value-3-instance',
      },
    },
    { label: 'CHOOSE_TARGET', command: { type: 'CHOOSE_TARGET', actorId: 'p1', targetId: 'p2' } },
    { label: 'SUBMIT_GUESS', command: { type: 'SUBMIT_GUESS', actorId: 'p1', value: 7 } },
    {
      label: 'CHOOSE_DECK_POSITION',
      command: { type: 'CHOOSE_DECK_POSITION', actorId: 'p1', index: 0 },
    },
  ] as const)(
    'rejects $label while the SAQUEADOG_SWAP decision is owed with PENDING_DECISION_REQUIRED',
    ({ command }) => {
      const round = createRound(['p1', 'p2', 'p3']);
      const { played } = stageSaqueadogPending(round, 'p1');
      const before = snapshotOf(played.state);

      const result = expectTurnFailure(
        applyTurnCommand(played.state, command as Parameters<typeof applyTurnCommand>[1]),
      );

      expect(result.error).toBe('PENDING_DECISION_REQUIRED');
      expect(result.state).toEqual(before);
      expect(result.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    },
  );

  it.each([0, 1, 'true', 'false', null, undefined])(
    'rejects a malformed swap value %p with INVALID_SWAP_CHOICE and keeps the pending open',
    (malformedSwap) => {
      const round = createRound(['p1', 'p2', 'p3']);
      const { played } = stageSaqueadogPending(round, 'p1');
      const before = snapshotOf(played.state);

      const result = expectTurnFailure(
        applyTurnCommand(played.state, {
          type: 'CHOOSE_HIDDEN_SWAP',
          actorId: 'p1',
          swap: malformedSwap as unknown as boolean,
        }),
      );

      expect(result.error).toBe('INVALID_SWAP_CHOICE');
      expect(result.state).toEqual(before);
      expect(result.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    },
  );

  it.each([
    { label: 'an empty hand', hand: [] as CardInstance[] },
    { label: 'a two-card hand', hand: [cardOfValue(3, 'value-3-instance'), cardOfValue(7)] },
  ])(
    'defensively rejects swap=true against $label with INVALID_SWAP_CHOICE and no mutation',
    ({ hand }) => {
      const round = createRound(['p1', 'p2', 'p3']);
      const { played, hiddenCard } = stageSaqueadogPending(round, 'p1');
      playerOf(played.state, 'p1').hand = hand;
      const before = snapshotOf(played.state);

      const result = expectTurnFailure(
        applyTurnCommand(played.state, {
          type: 'CHOOSE_HIDDEN_SWAP',
          actorId: 'p1',
          swap: true,
        }),
      );

      expect(result.error).toBe('INVALID_SWAP_CHOICE');
      expect(result.state).toEqual(before);
      expect(result.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
      expect(result.state.hiddenCard).toEqual(hiddenCard);
    },
  );

  it('defensively rejects swap=true when the hidden slot is malformed with no mutation', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, handCard } = stageSaqueadogPending(round, 'p1');
    const corrupted = played.state as { hiddenCard: CardInstance | null };
    corrupted.hiddenCard = null;
    const before = snapshotOf(played.state);

    const result = expectTurnFailure(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    expect(result.error).toBe('INVALID_SWAP_CHOICE');
    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toEqual({ type: 'SAQUEADOG_SWAP', actorId: 'p1' });
    expect(playerOf(result.state, 'p1').hand).toEqual([handCard]);
  });

  it('resolves swap=false even against a defensively malformed hand shape', () => {
    // The no-op choice never touches the hand or the hidden slot, so a malformed
    // hand shape cannot block the decision from resolving (spec §8: validate
    // only what the chosen branch needs).
    const round = createRound(['p1', 'p2', 'p3']);
    const { played } = stageSaqueadogPending(round, 'p1');
    playerOf(played.state, 'p1').hand = [];

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: false }),
    );

    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.currentPlayerId).toBe('p2');
    expect(result.events).toEqual([{ type: 'SAQUEADOG_RESOLVED', playerId: 'p1' }]);
  });
});

describe('Card 6 Saqueadog — deferred round-end check on draw-pile exhaustion', () => {
  it('ends the round exactly once after a swap=true decision on an exhausted draw pile', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard } = stageSaqueadogPending(round, 'p1');
    // The last drawable card was consumed by the play: the deferred round-end
    // check must fire only when the pending swap decision resolves.
    played.state.drawPile = [];

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 ends holding the hidden card (value 5) and ties p2's
    // value 5; p1's Saqueadog discard (6) wins the discard tie-break.
    expect(result.state.winners).toEqual(['p1']);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.state.phase).toBe('DRAW_REQUIRED');
    const p2Hand = playerOf(round, 'p2').hand[0];
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'SAQUEADOG_RESOLVED', playerId: 'p1' },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: hiddenCard },
          { playerId: 'p2', card: p2Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p1'] },
    ]);
  });

  it('ends the round exactly once after a swap=false decision on an exhausted draw pile', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard, handCard } = stageSaqueadogPending(round, 'p1');
    played.state.drawPile = [];

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: false }),
    );

    expect(result.state.status).toBe('ROUND_END');
    // Seeded hands: p1 keeps value 3, p2 holds value 5 — p2 wins outright.
    expect(result.state.winners).toEqual(['p2']);
    expect(result.state.pendingInteraction).toBeNull();
    // Both identities stay unchanged even when the round ends.
    expect(result.state.hiddenCard).toEqual(hiddenCard);
    expect(playerOf(result.state, 'p1').hand).toEqual([handCard]);
    const p2Hand = playerOf(round, 'p2').hand[0];
    const p3Hand = playerOf(round, 'p3').hand[0];
    if (!p2Hand || !p3Hand) {
      throw new Error('Test fixture expected one hand card per survivor');
    }
    expect(result.events).toEqual([
      { type: 'SAQUEADOG_RESOLVED', playerId: 'p1' },
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: 'p1', card: handCard },
          { playerId: 'p2', card: p2Hand },
          { playerId: 'p3', card: p3Hand },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    ]);
  });
});

describe('Card 6 Saqueadog — turn lifecycle after the decision', () => {
  it('expires the next actor protection exactly when the turn advances after the decision', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').protected = true;
    const { played } = stageSaqueadogPending(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    expect(result.state.currentPlayerId).toBe('p2');
    expect(playerOf(result.state, 'p2').protected).toBe(false);
    expect(result.events).toEqual([
      { type: 'SAQUEADOG_RESOLVED', playerId: 'p1' },
      { type: 'PROTECTION_EXPIRED', playerId: 'p2' },
    ]);
  });
});

describe('Card 6 Saqueadog — privacy of the public event stream', () => {
  it('emits SAQUEADOG_RESOLVED with the actor id only — never the hidden identity or the choice', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const { played, hiddenCard, handCard } = stageSaqueadogPending(round, 'p1');

    const result = expectTurnSuccess(
      applyTurnCommand(played.state, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'p1', swap: true }),
    );

    const resolved = result.events.find((event) => event.type === 'SAQUEADOG_RESOLVED');
    expect(resolved).toEqual({ type: 'SAQUEADOG_RESOLVED', playerId: 'p1' });

    const serializedEvents = JSON.stringify(result.events);
    // Neither swap participant leaks identity or value through the public
    // stream, and no event distinguishes swap=true from swap=false.
    expect(serializedEvents).not.toContain(hiddenCard.instanceId);
    expect(serializedEvents).not.toContain(handCard.instanceId);
    expect(serializedEvents).not.toContain(`"value":${hiddenCard.value}`);
    expect(serializedEvents).not.toContain(`"value":${handCard.value}`);
    expect(result.events.some((event) => event.type === 'HANDS_SWAPPED')).toBe(false);
  });

  it('emits an identical public stream for swap=true and swap=false apart from nothing', () => {
    const trueRound = createRound(['p1', 'p2', 'p3']);
    const falseRound = createRound(['p1', 'p2', 'p3']);
    const trueStaged = stageSaqueadogPending(trueRound, 'p1');
    const falseStaged = stageSaqueadogPending(falseRound, 'p1');

    const trueResult = expectTurnSuccess(
      applyTurnCommand(trueStaged.played.state, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p1',
        swap: true,
      }),
    );
    const falseResult = expectTurnSuccess(
      applyTurnCommand(falseStaged.played.state, {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'p1',
        swap: false,
      }),
    );

    // The public streams are indistinguishable: the choice stays private.
    expect(falseResult.events).toEqual(trueResult.events);
  });
});

describe('Card 6 Saqueadog — suppression of the printed action', () => {
  it('does not open a pending interaction when the card enters the public area as FORCED_PLAY', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result: EffectResult = resolveFaceUpCardEffect(round, {
      playerId: 'p1',
      card: SAQUEADOG_CARD,
      origin: 'FORCED_PLAY',
    });

    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.eliminatedPlayerId).toBeNull();
    expect(round).toEqual(before);
  });

  it('does not open a pending interaction through the elimination-reveal origin', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    const before = snapshotOf(round);

    const result = resolveFaceUpCardEffect(round, {
      playerId: 'p1',
      card: SAQUEADOG_CARD,
      origin: 'ELIMINATION_REVEAL',
    });

    expect(result.state).toEqual(before);
    expect(result.state.pendingInteraction).toBeNull();
    expect(result.events).toEqual([]);
    expect(round).toEqual(before);
  });

  it('keeps the elimination-reveal path out of the pending flow entirely', () => {
    const round = createRound(['p1', 'p2', 'p3']);
    playerOf(round, 'p2').hand = [SAQUEADOG_CARD];
    const before = snapshotOf(round);

    const result = eliminatePlayer(round, 'p2');

    if (!result.ok) {
      throw new Error(`Expected a successful elimination, got error ${String(result.error)}`);
    }
    expect(result.state.pendingInteraction).toBeNull();
    expect(playerOf(result.state, 'p2').discards).toEqual([
      { card: SAQUEADOG_CARD, origin: 'ELIMINATION_REVEAL' },
    ]);
    expect(result.events.every((event) => event.type === 'PLAYER_ELIMINATED')).toBe(true);
    expect(round).toEqual(before);
  });
});
