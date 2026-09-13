/**
 * Turn-controls selector (WU6): derives exactly which gameplay controls the
 * table may render from the viewer's own authoritative legalActions — the only
 * source of legality the server publishes to this seat. It never consults the
 * public phase, turn order, or hand contents, and it fails closed on any
 * missing or viewer-mismatched projection.
 *
 * Target-bearing PLAY_CARD actions belong to the WU7 target-selection work:
 * they are surfaced as deferred, never executable, entries here.
 */
import type { PrivateGameView } from '@power-hungry-pets/protocol';

/** The exact executable game controls this viewer's legal actions support. */
export interface TurnControlsDecision {
  /** A legal `DRAW_CARD` action exists for this viewer. */
  drawAllowed: boolean;
  /** Hand-card instance ids playable through an exact targetless `PLAY_CARD`. */
  playableCardIds: string[];
  /**
   * Hand-card instance ids whose only `PLAY_CARD` actions require a target;
   * WU7 target selection will make these executable.
   */
  waitingOnTargetCardIds: string[];
}

const NOTHING_ALLOWED: TurnControlsDecision = {
  drawAllowed: false,
  playableCardIds: [],
  waitingOnTargetCardIds: [],
};

/**
 * Evaluates the executable turn controls for one viewer's private projection.
 * Every entry in `legalActions` counts only when its `actorId` is exactly the
 * viewer's id; empty projections and foreign actors yield no controls.
 */
export function evaluateTurnControls(
  privateView: PrivateGameView | null,
  viewerId: string | null,
): TurnControlsDecision {
  if (privateView === null || viewerId === null || privateView.viewerId !== viewerId) {
    return NOTHING_ALLOWED;
  }
  const legalActions = privateView.legalActions;
  if (!Array.isArray(legalActions)) {
    // A malformed projection is never repaired client-side: fail closed.
    return NOTHING_ALLOWED;
  }

  let drawAllowed = false;
  const playableCardIds: string[] = [];
  const waitingOnTargetCardIds: string[] = [];
  for (const action of legalActions) {
    if (action.actorId !== viewerId) {
      continue;
    }
    if (action.type === 'DRAW_CARD') {
      drawAllowed = true;
      continue;
    }
    if (action.type !== 'PLAY_CARD' || typeof action.cardInstanceId !== 'string') {
      continue;
    }
    const targetList = action.targetId === undefined ? playableCardIds : waitingOnTargetCardIds;
    if (!targetList.includes(action.cardInstanceId)) {
      targetList.push(action.cardInstanceId);
    }
  }

  return {
    drawAllowed,
    playableCardIds,
    waitingOnTargetCardIds: waitingOnTargetCardIds.filter(
      (instanceId) => !playableCardIds.includes(instanceId),
    ),
  };
}
