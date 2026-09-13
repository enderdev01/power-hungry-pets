/**
 * Turn-controls selector (WU6/WU7): derives exactly which gameplay controls the
 * table may render from the viewer's own authoritative legalActions — the only
 * source of legality the server publishes to this seat. It never consults the
 * public phase, turn order, or hand contents, and it fails closed on any
 * missing or viewer-mismatched projection.
 *
 * WU7 adds server-derived target options: target-bearing PLAY_CARD actions
 * are grouped per card instance id, keeping the server's published order and
 * deduping exact duplicate target ids. A published targetId with no public
 * player counterpart is skipped fail-closed — a raw id is never surfaced.
 */
import type { PrivateGameView } from '@power-hungry-pets/protocol';

/** One legal target, resolved to its display-only public name. */
export interface TargetOption {
  targetId: string;
  name: string;
}

/** The exact executable game controls this viewer's legal actions support. */
export interface TurnControlsDecision {
  /** A legal `DRAW_CARD` action exists for this viewer. */
  drawAllowed: boolean;
  /** Hand-card instance ids playable through an exact targetless `PLAY_CARD`. */
  playableCardIds: string[];
  /**
   * Hand-card instance ids whose only `PLAY_CARD` actions require a target.
   * These cards arm target selection; their choices live in
   * `targetOptionsByCardId`.
   */
  waitingOnTargetCardIds: string[];
  /**
   * Target choices per target-bearing hand-card instance id, in published
   * order with exact duplicates removed. A card whose published targetIds all
   * lack a public counterpart maps to an empty list (fail closed).
   */
  targetOptionsByCardId: Record<string, TargetOption[]>;
}

const NOTHING_ALLOWED: TurnControlsDecision = {
  drawAllowed: false,
  playableCardIds: [],
  waitingOnTargetCardIds: [],
  targetOptionsByCardId: {},
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
  const targetOptionsByCardId: Record<string, TargetOption[]> = {};
  // Display-only public names for the published targetIds, resolved once. A
  // malformed public roster yields no names, so every target fails closed.
  const publicNameById = new Map<string, string>();
  const publicPlayers = privateView.publicView?.players;
  if (Array.isArray(publicPlayers)) {
    for (const player of publicPlayers) {
      if (typeof player.id === 'string' && typeof player.name === 'string') {
        publicNameById.set(player.id, player.name);
      }
    }
  }
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
    if (action.targetId === undefined) {
      if (!playableCardIds.includes(action.cardInstanceId)) {
        playableCardIds.push(action.cardInstanceId);
      }
      continue;
    }
    // A target-bearing action makes its card armable even when every
    // published targetId later fails resolution: the group exists, empty.
    const options = (targetOptionsByCardId[action.cardInstanceId] ??= []);
    if (typeof action.targetId !== 'string') {
      continue;
    }
    // A targetId with no public player counterpart is skipped fail-closed:
    // display-only data must never render a raw id.
    const name = publicNameById.get(action.targetId);
    if (name === undefined || options.some((option) => option.targetId === action.targetId)) {
      continue;
    }
    options.push({ targetId: action.targetId, name });
  }

  // Targetless precedence (WU7): a card playable without a target never
  // carries target options; the ordinary executable Play wins defensively.
  for (const instanceId of playableCardIds) {
    delete targetOptionsByCardId[instanceId];
  }

  return {
    drawAllowed,
    playableCardIds,
    waitingOnTargetCardIds: Object.keys(targetOptionsByCardId),
    targetOptionsByCardId,
  };
}
