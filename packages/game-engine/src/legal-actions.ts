/**
 * Canonical legal-action generation (Milestone 5 work unit 1; engine spec §15).
 *
 * Pure projection of the current round state onto the exact `TurnCommand`
 * objects the turn engine accepts. This module owns enumeration and canonical
 * ordering only: legality itself stays single-sourced in the turn engine's
 * validators and the centralized target-protection seams in `round-rules.ts`
 * (`classifyHandTarget`, `hasLegalHandTarget`), which are never reimplemented
 * here. Every generated action must round-trip through `applyTurnCommand`; a
 * rejection is always the caller's curated illegal input, never a generated
 * one.
 *
 * The returned commands are fresh plain objects built from public state only —
 * they never alias or leak the input state's private card identities.
 */
import type { CardType, PlayerId, RoundState } from './models';
import { classifyHandTarget, hasLegalHandTarget, playerById } from './round-rules';
import type {
  ChooseDeckPositionCommand,
  ChooseHiddenSwapCommand,
  ChooseTargetCommand,
  DrawCardCommand,
  PlayCardCommand,
  SubmitGuessCommand,
  TurnCommand,
} from './turn-engine';

/** Card types whose play command carries an atomic target decision. */
const TARGET_BEARING_CARD_TYPES: ReadonlySet<CardType> = new Set([
  'CONEJITO_GUERRILLERO',
  'SERPIENTE_ENCANTADORA',
  'ERMITANO_BUSCA_CASA',
]);

/** Stable canonical rank for each command type in the generated ordering. */
const COMMAND_TYPE_RANK: Record<TurnCommand['type'], number> = {
  CHOOSE_DECK_POSITION: 0,
  CHOOSE_HIDDEN_SWAP: 1,
  CHOOSE_TARGET: 2,
  DRAW_CARD: 3,
  PLAY_CARD: 4,
  SUBMIT_GUESS: 5,
};

/**
 * Canonical legal actions for the given actor in the given round state
 * (defaults to the round's current player).
 *
 * Terminal and guard results are empty:
 * - ended rounds (`status !== 'ROUND_ACTIVE'`);
 * - wrong actor (not the current player while no pending interaction is open);
 * - eliminated or unknown actors;
 * - impossible draw states (DRAW_REQUIRED with an empty draw pile).
 *
 * Ordering is a stable sort by command type, then card instance, target id,
 * deck index, and guess value, so identical inputs always produce identical
 * sequences.
 */
export function getLegalActions(round: RoundState, actorId?: PlayerId): TurnCommand[] {
  const actor = actorId ?? round.currentPlayerId;

  if (round.status !== 'ROUND_ACTIVE') {
    return [];
  }
  const actorState = playerById(round, actor);
  if (!actorState || actorState.eliminated) {
    return [];
  }

  const pending = round.pendingInteraction;
  if (pending !== null) {
    if (pending.actorId !== actor) {
      return [];
    }
    switch (pending.type) {
      case 'PECERA_TARGET':
        return sorted(pendingPeceraTargets(round, actor));
      case 'PECERA_GUESS':
        return sorted(pendingPeceraGuesses(actor));
      case 'RATON_INSERT_POSITION':
        return sorted(pendingRatonPositions(actor, round));
      case 'SAQUEADOG_SWAP':
        return sorted(pendingSaqueadogChoices(actor));
    }
  }

  if (round.currentPlayerId !== actor) {
    return [];
  }

  if (round.phase === 'DRAW_REQUIRED') {
    if (round.drawPile.length === 0) {
      // Impossible draw state: the engine would reject DRAW_CARD outright.
      return [];
    }
    const command: DrawCardCommand = { type: 'DRAW_CARD', actorId: actor };
    return [command];
  }

  if (round.phase !== 'PLAY_REQUIRED') {
    return [];
  }

  const commands: TurnCommand[] = [];
  for (const card of actorState.hand) {
    if (TARGET_BEARING_CARD_TYPES.has(card.type)) {
      if (hasLegalHandTarget(round, actor)) {
        for (const candidate of round.players) {
          if (classifyHandTarget(round, actor, candidate.id) === 'LEGAL_TARGET') {
            const command: PlayCardCommand = {
              type: 'PLAY_CARD',
              actorId: actor,
              cardInstanceId: card.instanceId,
              targetId: candidate.id,
            };
            commands.push(command);
          }
        }
      } else {
        // No-legal-target rule (single-sourced in the engine): exactly one
        // targetless fizzle action — the engine waives the target requirement.
        const command: PlayCardCommand = {
          type: 'PLAY_CARD',
          actorId: actor,
          cardInstanceId: card.instanceId,
        };
        commands.push(command);
      }
    } else {
      // Cards without an atomic target never carry a stray targetId.
      const command: PlayCardCommand = {
        type: 'PLAY_CARD',
        actorId: actor,
        cardInstanceId: card.instanceId,
      };
      commands.push(command);
    }
  }
  return sorted(commands);
}

function pendingPeceraTargets(round: RoundState, actorId: PlayerId): ChooseTargetCommand[] {
  const commands: ChooseTargetCommand[] = [];
  for (const candidate of round.players) {
    if (classifyHandTarget(round, actorId, candidate.id) === 'LEGAL_TARGET') {
      const command: ChooseTargetCommand = {
        type: 'CHOOSE_TARGET',
        actorId,
        targetId: candidate.id,
      };
      commands.push(command);
    }
  }
  return commands;
}

function pendingPeceraGuesses(actorId: PlayerId): SubmitGuessCommand[] {
  const commands: SubmitGuessCommand[] = [];
  for (let value = 0; value <= 10; value += 1) {
    // The prohibited guess value 1 (catalog §1) is a curated illegal input the
    // engine rejects; it is never generated.
    if (value === 1) {
      continue;
    }
    const command: SubmitGuessCommand = { type: 'SUBMIT_GUESS', actorId, value };
    commands.push(command);
  }
  return commands;
}

function pendingRatonPositions(actorId: PlayerId, round: RoundState): ChooseDeckPositionCommand[] {
  const commands: ChooseDeckPositionCommand[] = [];
  for (let index = 0; index <= round.drawPile.length; index += 1) {
    const command: ChooseDeckPositionCommand = { type: 'CHOOSE_DECK_POSITION', actorId, index };
    commands.push(command);
  }
  return commands;
}

function pendingSaqueadogChoices(actorId: PlayerId): ChooseHiddenSwapCommand[] {
  const commands: ChooseHiddenSwapCommand[] = [];
  for (const swap of [false, true]) {
    const command: ChooseHiddenSwapCommand = { type: 'CHOOSE_HIDDEN_SWAP', actorId, swap };
    commands.push(command);
  }
  return commands;
}

/**
 * Deterministic canonical ordering: stable sort by command type rank, then
 * card instance id, target id, deck index, and guess value. Fields absent on a
 * command sort before present ones (they are only ever compared against each
 * other within a command type, where they are uniformly present).
 */
function sorted(commands: TurnCommand[]): TurnCommand[] {
  return [...commands].sort((first, second) => {
    const rankDelta = COMMAND_TYPE_RANK[first.type] - COMMAND_TYPE_RANK[second.type];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const firstFields = sortFieldsOf(first);
    const secondFields = sortFieldsOf(second);
    for (let index = 0; index < firstFields.length; index += 1) {
      const delta = compareSortField(firstFields[index], secondFields[index]);
      if (delta !== 0) {
        return delta;
      }
    }
    return 0;
  });
}

type SortFields = [card?: string, target?: string, index?: number, value?: number];

function sortFieldsOf(command: TurnCommand): SortFields {
  switch (command.type) {
    case 'PLAY_CARD':
      return [command.cardInstanceId, command.targetId, undefined, undefined];
    case 'CHOOSE_TARGET':
      return [undefined, command.targetId, undefined, undefined];
    case 'CHOOSE_DECK_POSITION':
      return [undefined, undefined, command.index, undefined];
    case 'SUBMIT_GUESS':
      return [undefined, undefined, undefined, command.value];
    default:
      return [undefined, undefined, undefined, undefined];
  }
}

function compareSortField(
  first: string | number | undefined,
  second: string | number | undefined,
): number {
  if (first === undefined && second === undefined) {
    return 0;
  }
  if (first === undefined) {
    return -1;
  }
  if (second === undefined) {
    return 1;
  }
  if (typeof first === 'string' && typeof second === 'string') {
    return first < second ? -1 : first > second ? 1 : 0;
  }
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  return 0;
}
