/**
 * Turn-controls selector contract (WU6/WU7): executable play controls are
 * derived only from the viewer's exact authoritative legalActions — never
 * inferred from the public phase, hand contents, or turn order. WU7 adds the
 * server-derived target options for target-bearing PLAY_CARD actions.
 */
import type {
  PrivateGameView,
  PublicGameView,
  PublicPlayerView,
  TurnCommand,
} from '@power-hungry-pets/protocol';
import { evaluateTurnControls } from '@/lib/game/turn-controls';
import { privateView, publicView, SELF_ID, OTHER_ID, THIRD_ID } from './helpers/game-views';

function legalActions(actions: TurnCommand[]): PrivateGameView {
  return privateView(
    SELF_ID,
    [
      { instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' },
      { instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' },
    ],
    actions,
  );
}

describe('turn-controls selector', () => {
  it('allows draw only for the viewer’s own DRAW_CARD action', () => {
    const decision = evaluateTurnControls(
      legalActions([{ type: 'DRAW_CARD', actorId: SELF_ID }]),
      SELF_ID,
    );
    expect(decision).toEqual({
      drawAllowed: true,
      playableCardIds: [],
      waitingOnTargetCardIds: [],
      targetOptionsByCardId: {},
    });
  });

  it('renders nothing when every legal action belongs to a different actor', () => {
    const decision = evaluateTurnControls(
      legalActions([
        { type: 'DRAW_CARD', actorId: OTHER_ID },
        { type: 'PLAY_CARD', actorId: OTHER_ID, cardInstanceId: 'own-instance-1' },
      ]),
      SELF_ID,
    );
    expect(decision).toEqual({
      drawAllowed: false,
      playableCardIds: [],
      waitingOnTargetCardIds: [],
      targetOptionsByCardId: {},
    });
  });

  it('marks a hand card playable only for its exact targetless PLAY_CARD action', () => {
    const decision = evaluateTurnControls(
      legalActions([{ type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' }]),
      SELF_ID,
    );
    expect(decision).toEqual({
      drawAllowed: false,
      playableCardIds: ['own-instance-1'],
      waitingOnTargetCardIds: [],
      targetOptionsByCardId: {},
    });
  });

  it('never treats a target-bearing PLAY_CARD action as executable on its own (WU7)', () => {
    const decision = evaluateTurnControls(
      legalActions([
        {
          type: 'PLAY_CARD',
          actorId: SELF_ID,
          cardInstanceId: 'own-instance-2',
          targetId: OTHER_ID,
        },
      ]),
      SELF_ID,
    );
    expect(decision).toEqual({
      drawAllowed: false,
      playableCardIds: [],
      waitingOnTargetCardIds: ['own-instance-2'],
      targetOptionsByCardId: {
        'own-instance-2': [{ targetId: OTHER_ID, name: 'Bruno' }],
      },
    });
  });

  it('keeps a card executable when a targetless action exists alongside other entries', () => {
    const decision = evaluateTurnControls(
      legalActions([
        { type: 'DRAW_CARD', actorId: SELF_ID },
        {
          type: 'PLAY_CARD',
          actorId: SELF_ID,
          cardInstanceId: 'own-instance-1',
          targetId: OTHER_ID,
        },
        { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' },
      ]),
      SELF_ID,
    );
    expect(decision.drawAllowed).toBe(true);
    expect(decision.playableCardIds).toEqual(['own-instance-1']);
    expect(decision.waitingOnTargetCardIds).toEqual([]);
  });

  it('renders nothing from an empty legalActions projection', () => {
    const decision = evaluateTurnControls(legalActions([]), SELF_ID);
    expect(decision).toEqual({
      drawAllowed: false,
      playableCardIds: [],
      waitingOnTargetCardIds: [],
      targetOptionsByCardId: {},
    });
  });

  it('fails closed for a private view addressed to another viewer', () => {
    const decision = evaluateTurnControls(
      legalActions([{ type: 'DRAW_CARD', actorId: SELF_ID }]),
      OTHER_ID,
    );
    expect(decision.drawAllowed).toBe(false);
    expect(decision.playableCardIds).toEqual([]);
  });

  it('fails closed with no private view or no viewer', () => {
    expect(evaluateTurnControls(null, SELF_ID).drawAllowed).toBe(false);
    expect(evaluateTurnControls(legalActions([]), null).playableCardIds).toEqual([]);
  });

  it('fails closed on a malformed legalActions projection', () => {
    const malformed = {
      ...privateView(SELF_ID),
      legalActions: 'DRAW_CARD' as unknown as TurnCommand[],
    };
    const decision = evaluateTurnControls(malformed, SELF_ID);
    expect(decision).toEqual({
      drawAllowed: false,
      playableCardIds: [],
      waitingOnTargetCardIds: [],
      targetOptionsByCardId: {},
    });
  });

  it('skips a malformed PLAY_CARD action with no card instance id', () => {
    const decision = evaluateTurnControls(
      legalActions([
        {
          type: 'PLAY_CARD',
          actorId: SELF_ID,
          cardInstanceId: undefined,
        } as unknown as TurnCommand,
      ]),
      SELF_ID,
    );
    expect(decision.playableCardIds).toEqual([]);
    expect(decision.waitingOnTargetCardIds).toEqual([]);
  });

  it('never consults the public round phase or turn order', () => {
    // Sanity on the fixture seam: the private view embeds a public projection
    // whose phase is PLAY_REQUIRED; legality must still come from legalActions.
    expect(publicView().round?.phase).toBe('PLAY_REQUIRED');
    const decision = evaluateTurnControls(
      legalActions([{ type: 'DRAW_CARD', actorId: SELF_ID }]),
      SELF_ID,
    );
    expect(decision.drawAllowed).toBe(true);
  });
});

describe('turn-controls target options (WU7)', () => {
  const hand = [
    { instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' as const },
    { instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' as const },
  ];

  function withThirdPlayer(): PublicPlayerView[] {
    return [
      {
        id: SELF_ID,
        name: 'Ana',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 1,
        handCount: 1,
        discards: [],
      },
      {
        id: OTHER_ID,
        name: 'Bruno',
        connected: true,
        eliminated: false,
        protected: true,
        victoryTokens: 0,
        handCount: 2,
        discards: [],
      },
      {
        id: THIRD_ID,
        name: 'Caro',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 2,
        discards: [],
      },
    ];
  }

  function viewWithPlayers(players: PublicPlayerView[]): PublicGameView {
    return publicView({ players });
  }

  it('derives target options only from the viewer’s own target-bearing PLAY_CARD actions', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: OTHER_ID,
          },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.playableCardIds).toEqual([]);
    expect(decision.targetOptionsByCardId).toEqual({
      'own-instance-2': [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
  });

  it('ignores target-bearing actions belonging to a foreign actor', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: OTHER_ID,
            cardInstanceId: 'own-instance-2',
            targetId: SELF_ID,
          },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.targetOptionsByCardId).toEqual({});
    expect(decision.waitingOnTargetCardIds).toEqual([]);
  });

  it('skips a target id with no public player counterpart (fail closed)', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: 'p-ghost',
          },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.targetOptionsByCardId).toEqual({ 'own-instance-2': [] });
  });

  it('skips a malformed non-string target id without breaking the group', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: 42,
          } as unknown as TurnCommand,
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.targetOptionsByCardId).toEqual({ 'own-instance-2': [] });
  });

  it('dedupes exact duplicate target ids while preserving published order', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: THIRD_ID,
          },
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: OTHER_ID,
          },
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: THIRD_ID,
          },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.targetOptionsByCardId).toEqual({
      'own-instance-2': [
        { targetId: THIRD_ID, name: 'Caro' },
        { targetId: OTHER_ID, name: 'Bruno' },
      ],
    });
  });

  it('groups options per card instance id without cross-card leakage', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' },
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: OTHER_ID,
          },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.playableCardIds).toEqual(['own-instance-1']);
    expect(decision.targetOptionsByCardId).toEqual({
      'own-instance-2': [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
  });

  it('keeps targetless precedence: a playable card never carries target options', () => {
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: OTHER_ID,
          },
          { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-2' },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.playableCardIds).toEqual(['own-instance-2']);
    expect(decision.waitingOnTargetCardIds).toEqual([]);
    expect(decision.targetOptionsByCardId).toEqual({});
  });

  it('never infers targets from protection, elimination, turn order, or hand contents', () => {
    // Bruno is protected and Caro is not; the published order is Bruno then
    // Caro and the selector must publish exactly that order, filtered only by
    // what the actions themselves name — never reordered or filtered by the
    // public status flags.
    const decision = evaluateTurnControls(
      privateView(
        SELF_ID,
        hand,
        [
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: OTHER_ID,
          },
          {
            type: 'PLAY_CARD',
            actorId: SELF_ID,
            cardInstanceId: 'own-instance-2',
            targetId: THIRD_ID,
          },
        ],
        viewWithPlayers(withThirdPlayer()),
      ),
      SELF_ID,
    );
    expect(decision.targetOptionsByCardId).toEqual({
      'own-instance-2': [
        { targetId: OTHER_ID, name: 'Bruno' },
        { targetId: THIRD_ID, name: 'Caro' },
      ],
    });
  });

  it('yields empty target options from an empty legalActions projection', () => {
    const decision = evaluateTurnControls(privateView(SELF_ID, hand, []), SELF_ID);
    expect(decision.targetOptionsByCardId).toEqual({});
  });
});

describe('turn-controls target-option hardening (WU7)', () => {
  const hand = [{ instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' as const }];
  const targeted = [
    {
      type: 'PLAY_CARD' as const,
      actorId: SELF_ID,
      cardInstanceId: 'own-instance-2',
      targetId: OTHER_ID,
    },
  ];

  it('yields no target options for a projection addressed to another viewer', () => {
    const decision = evaluateTurnControls(privateView(OTHER_ID, hand, targeted), SELF_ID);
    expect(decision.targetOptionsByCardId).toEqual({});
    expect(decision.waitingOnTargetCardIds).toEqual([]);
  });

  it('fails target options closed when the embedded public roster is malformed', () => {
    const malformed = {
      ...privateView(SELF_ID, hand, targeted),
      publicView: { players: 'not-a-list' } as unknown as ReturnType<typeof publicView>,
    };
    const decision = evaluateTurnControls(malformed, SELF_ID);
    // The group survives empty so the fail-closed data stays observable — never
    // a raw id, never a crash. Rendering must treat an empty group as no
    // armable control (no dead-end arm).
    expect(decision.targetOptionsByCardId).toEqual({ 'own-instance-2': [] });
  });
});
