/**
 * Turn-controls selector contract (WU6): executable play controls are derived
 * only from the viewer's exact authoritative legalActions — never inferred from
 * the public phase, hand contents, or turn order. Target-bearing PLAY_CARD
 * actions belong to WU7 and surface as deferred, never executable, here.
 */
import type { PrivateGameView, TurnCommand } from '@power-hungry-pets/protocol';
import { evaluateTurnControls } from '@/lib/game/turn-controls';
import { privateView, publicView, SELF_ID, OTHER_ID } from './helpers/game-views';

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
    });
  });

  it('never treats a target-bearing PLAY_CARD action as executable and defers it', () => {
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
