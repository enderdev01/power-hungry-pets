/**
 * Pending-decision selector (WU8): derives the mandatory private-decision modal
 * model exclusively from the viewer-matching `privateView.pendingDecision`
 * plus the exact `legalActions` the server published to this seat — the same
 * single legality source the turn-controls selector consults.
 *
 * It never invents a decision, a value, or a target: every choice the modal
 * renders comes from a server-published command. A malformed or stale
 * projection fails closed into a truthful waiting state with no controls, and
 * a target id with no public roster counterpart is never surfaced as a raw id.
 */
import type { GameCardInstance, PrivateGameView, TurnCommand } from '@power-hungry-pets/protocol';
import type { TargetOption } from './turn-controls';

/** The exact executable decision model this viewer's projection supports. */
export type PendingDecisionModel =
  | { kind: 'none' }
  /** The projection names a decision for this viewer but cannot support it: truthful waiting, no controls. */
  | { kind: 'unavailable' }
  /** `PECERA_TARGET`: every resolved legal target, in published order. */
  | { kind: 'choose-target'; targets: TargetOption[] }
  /** `PECERA_GUESS`: the published guess values exactly as the server sent them. */
  | {
      kind: 'submit-guess';
      targetId: string;
      /** Public roster name for the guessed target, or `null` when unknown (never a raw id). */
      targetName: string | null;
      values: number[];
    }
  /** `SAQUEADOG_SWAP`: the private hidden card and which answers the server allows. */
  | {
      kind: 'choose-hidden-swap';
      hiddenCard: GameCardInstance;
      keepAllowed: boolean;
      swapAllowed: boolean;
    }
  /** `RATON_INSERT_POSITION`: the private inspected card and the published insertion indexes. */
  | { kind: 'choose-deck-position'; card: GameCardInstance; positions: number[] };

const NONE: PendingDecisionModel = { kind: 'none' };
const UNAVAILABLE: PendingDecisionModel = { kind: 'unavailable' };

function isGameCardInstance(value: unknown): value is GameCardInstance {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const card = value as Partial<GameCardInstance>;
  return typeof card.instanceId === 'string' && typeof card.value === 'number';
}

function publicNameById(privateView: PrivateGameView): Map<string, string> {
  const names = new Map<string, string>();
  const players = privateView.publicView?.players;
  if (Array.isArray(players)) {
    for (const player of players) {
      if (typeof player.id === 'string' && typeof player.name === 'string') {
        names.set(player.id, player.name);
      }
    }
  }
  return names;
}

function resolveTargetOptions(
  actions: TurnCommand[],
  viewerId: string,
  names: Map<string, string>,
): TargetOption[] {
  const options: TargetOption[] = [];
  for (const action of actions) {
    if (action.type !== 'CHOOSE_TARGET' || action.actorId !== viewerId) {
      continue;
    }
    if (typeof action.targetId !== 'string') {
      // A malformed published target is skipped, never repaired; valid
      // published options remain.
      continue;
    }
    const name = names.get(action.targetId);
    if (name === undefined || options.some((option) => option.targetId === action.targetId)) {
      continue;
    }
    options.push({ targetId: action.targetId, name });
  }
  return options;
}

function collectGuessValues(actions: TurnCommand[], viewerId: string): number[] | null {
  const values: number[] = [];
  for (const action of actions) {
    if (action.type !== 'SUBMIT_GUESS' || action.actorId !== viewerId) {
      continue;
    }
    const raw = action.value;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return null;
    }
    if (!values.includes(raw)) {
      values.push(raw);
    }
  }
  return values;
}

function collectDeckPositions(actions: TurnCommand[], viewerId: string): number[] | null {
  const values: number[] = [];
  for (const action of actions) {
    if (action.type !== 'CHOOSE_DECK_POSITION' || action.actorId !== viewerId) {
      continue;
    }
    const raw = action.index;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return null;
    }
    if (!values.includes(raw)) {
      values.push(raw);
    }
  }
  return values;
}

function collectSwapAnswers(
  actions: TurnCommand[],
  viewerId: string,
): { keepAllowed: boolean; swapAllowed: boolean } | null {
  let keepAllowed = false;
  let swapAllowed = false;
  for (const action of actions) {
    if (action.type !== 'CHOOSE_HIDDEN_SWAP' || action.actorId !== viewerId) {
      continue;
    }
    if (typeof action.swap !== 'boolean') {
      return null;
    }
    if (action.swap) {
      swapAllowed = true;
    } else {
      keepAllowed = true;
    }
  }
  return { keepAllowed, swapAllowed };
}

/**
 * Evaluates the mandatory private decision for one viewer's private projection.
 * A decision exists only when the private pending data names this viewer and
 * the exact matching legal actions support it; anything else is `none` (no
 * modal) or `unavailable` (truthful waiting modal, no controls).
 */
export function evaluatePendingDecision(
  privateView: PrivateGameView | null,
  viewerId: string | null,
): PendingDecisionModel {
  if (privateView === null || viewerId === null || privateView.viewerId !== viewerId) {
    return NONE;
  }
  const pending = privateView.pendingDecision;
  if (pending === null || pending === undefined || pending.actorId !== viewerId) {
    return NONE;
  }
  const legalActions = privateView.legalActions;
  if (!Array.isArray(legalActions)) {
    // A malformed projection is never repaired client-side: fail closed.
    return UNAVAILABLE;
  }

  const names = publicNameById(privateView);
  switch (pending.type) {
    case 'PECERA_TARGET': {
      const targets = resolveTargetOptions(legalActions, viewerId, names);
      if (targets.length === 0) {
        // No resolvable option survives: the stage is unavailable, never
        // invented.
        return UNAVAILABLE;
      }
      return { kind: 'choose-target', targets };
    }
    case 'PECERA_GUESS': {
      if (typeof pending.targetId !== 'string') {
        return UNAVAILABLE;
      }
      const values = collectGuessValues(legalActions, viewerId);
      if (values === null || values.length === 0) {
        return UNAVAILABLE;
      }
      return {
        kind: 'submit-guess',
        targetId: pending.targetId,
        targetName: names.get(pending.targetId) ?? null,
        values,
      };
    }
    case 'SAQUEADOG_SWAP': {
      if (!isGameCardInstance(pending.hiddenCard)) {
        return UNAVAILABLE;
      }
      const answers = collectSwapAnswers(legalActions, viewerId);
      if (answers === null || (!answers.keepAllowed && !answers.swapAllowed)) {
        return UNAVAILABLE;
      }
      return { kind: 'choose-hidden-swap', hiddenCard: pending.hiddenCard, ...answers };
    }
    case 'RATON_INSERT_POSITION': {
      if (!isGameCardInstance(pending.card)) {
        return UNAVAILABLE;
      }
      const positions = collectDeckPositions(legalActions, viewerId);
      if (positions === null || positions.length === 0) {
        return UNAVAILABLE;
      }
      return { kind: 'choose-deck-position', card: pending.card, positions };
    }
    default: {
      // An unknown pending variant is a contract drift: fail closed.
      return UNAVAILABLE;
    }
  }
}
