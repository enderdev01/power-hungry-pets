/**
 * Turn command engine (spec §§5,7,8,10,21).
 *
 * Pure transactional processing: every command validates first, then applies
 * a complete transition to a cloned state, then emits public-safe events.
 * The input `RoundState` is never mutated. Failures return the input state
 * unchanged alongside a typed error code.
 */
import { resolveFaceUpCardEffect } from './card-effects';
import type {
  CardInstance,
  CardInstanceId,
  PlayerId,
  PlayerState,
  PublicDiscardEntry,
  RoundState,
} from './models';
import {
  advanceTurn,
  checkRoundEnd,
  classifyHandTarget,
  cloneRoundState,
  eliminatePlayer,
  hasLegalHandTarget,
  playerById,
} from './round-rules';
import type { Rng } from './rng';
import type {
  CardForcedFaceUpEvent,
  HandRedealtEvent,
  HandSwappedEvent,
  PlayerEliminatedEvent,
  PlayerProtectedEvent,
  RoundEndedEvent,
  HandsRevealedEvent,
} from './round-rules';

export type DrawCardCommand = {
  type: 'DRAW_CARD';
  actorId: PlayerId;
};

export type PlayCardCommand = {
  type: 'PLAY_CARD';
  actorId: PlayerId;
  cardInstanceId: CardInstanceId;
  /**
   * Atomic target decision for target-bearing cards (e.g. Card 8 Ermitaño,
   * Card 3 Conejito Guerrillero). Optional; cards without a target ignore it,
   * so a stray value is harmless.
   */
  targetId?: PlayerId;
};

/**
 * Engine-owned dependencies for a turn command (spec §9): the command itself
 * is plain serializable client data and can never control randomness. Any
 * random source the engine needs lives here, supplied by the caller that hosts
 * the engine, never inside command state, events, or pending interactions.
 */
export type TurnEngineDependencies = {
  /**
   * Explicit random source for cards whose printed action requires one (e.g.
   * Card 7 Malabarista). Cards without a random component ignore it, so
   * omitting it stays legal for them; a random card played without it is
   * rejected before any mutation with `MISSING_RNG` (spec §9).
   */
  rng?: Rng;
};

export type TurnCommand =
  | DrawCardCommand
  | PlayCardCommand
  | ChooseTargetCommand
  | SubmitGuessCommand
  | ChooseHiddenSwapCommand
  | ChooseDeckPositionCommand;

/** Card 1 Pecera step two: pick the hand-guess target (spec §6 `PECERA_TARGET`). */
export type ChooseTargetCommand = {
  type: 'CHOOSE_TARGET';
  actorId: PlayerId;
  targetId: PlayerId;
};

/** Card 1 Pecera step three: secret guess 0..10 excluding 1 (catalog §1). */
export type SubmitGuessCommand = {
  type: 'SUBMIT_GUESS';
  actorId: PlayerId;
  value: number;
};

/**
 * Card 6 Saqueadog decision (catalog §6): keep the hidden card or exchange it
 * with the actor's one remaining hand card. The choice itself is private; the
 * public stream only learns that the decision resolved.
 */
export type ChooseHiddenSwapCommand = {
  type: 'CHOOSE_HIDDEN_SWAP';
  actorId: PlayerId;
  swap: boolean;
};

/**
 * Card 2 Ratón decision (catalog §2): the secret insertion position 0..
 * `drawPile.length` (inclusive) for the detached pending card. The choice is
 * private; the public stream only learns that the decision resolved.
 */
export type ChooseDeckPositionCommand = {
  type: 'CHOOSE_DECK_POSITION';
  actorId: PlayerId;
  index: number;
};

/** Typed domain error codes (spec §21). */
export type TurnErrorCode =
  | 'NOT_YOUR_TURN'
  | 'PLAYER_ELIMINATED'
  | 'CARD_NOT_IN_HAND'
  | 'ILLEGAL_TARGET'
  | 'TARGET_PROTECTED'
  | 'PENDING_DECISION_REQUIRED'
  | 'UNEXPECTED_COMMAND'
  | 'ROUND_ALREADY_ENDED'
  | 'DRAW_PILE_EMPTY'
  | 'INVALID_GUESS'
  | 'INVALID_SWAP_CHOICE'
  | 'INVALID_POSITION'
  | 'MISSING_RNG';

/**
 * Public, secret-free Card 1 resolution event (rules §13; open questions
 * "Privacy scope for Milestone 3"): carries only the actor, the chosen target,
 * and whether the guess was correct. The guessed and the actual value never
 * appear in public events; the target hand stays private unless the guess was
 * correct and the centralized elimination reveals it.
 */
export type PeceraGuessResolvedEvent = {
  type: 'PECERA_GUESS_RESOLVED';
  actorId: PlayerId;
  targetId: PlayerId;
  correct: boolean;
};

/**
 * Public, secret-free Card 6 resolution event (multiplayer spec §12; test plan
 * §20): carries only the acting player. It never reveals the hidden-card
 * identity, the exchanged hand identity, or whether the swap happened — the
 * stream for `swap: true` and `swap: false` is identical.
 */
export type SaqueadogResolvedEvent = {
  type: 'SAQUEADOG_RESOLVED';
  playerId: PlayerId;
};

/**
 * Public, secret-free Card 2 resolution event (multiplayer spec §12): carries
 * only the acting player. It never reveals the inspected card identity or the
 * chosen insertion index.
 */
export type RatonResolvedEvent = {
  type: 'RATON_RESOLVED';
  playerId: PlayerId;
};

/** Public-safe turn events; CARD_DRAWN never leaks card identity or value. */
export type TurnEvent =
  | { type: 'CARD_DRAWN'; playerId: PlayerId }
  | { type: 'CARD_PLAYED'; playerId: PlayerId; card: CardInstance }
  | PeceraGuessResolvedEvent
  | SaqueadogResolvedEvent
  | RatonResolvedEvent
  | { type: 'PROTECTION_EXPIRED'; playerId: PlayerId }
  | HandSwappedEvent
  | HandRedealtEvent
  | CardForcedFaceUpEvent
  | PlayerProtectedEvent
  | PlayerEliminatedEvent
  | HandsRevealedEvent
  | RoundEndedEvent;

export type TurnCommandSuccess = {
  ok: true;
  state: RoundState;
  events: TurnEvent[];
};

export type TurnCommandFailure = {
  ok: false;
  error: TurnErrorCode;
  state: RoundState;
};

export type TurnCommandResult = TurnCommandSuccess | TurnCommandFailure;

export function applyTurnCommand(
  round: RoundState,
  command: TurnCommand,
  dependencies?: TurnEngineDependencies,
): TurnCommandResult {
  // Pending interactions pause the normal turn (spec §6): only the pending
  // decision commands for the pending actor are accepted, everything else is
  // rejected without mutation.
  if (round.pendingInteraction !== null) {
    return applyCommandWithPending(round, command);
  }

  const commonError = validateCommonTurnPreconditions(round, command.actorId);
  if (commonError) {
    return { ok: false, error: commonError, state: round };
  }
  if (
    command.type === 'CHOOSE_TARGET' ||
    command.type === 'SUBMIT_GUESS' ||
    command.type === 'CHOOSE_HIDDEN_SWAP' ||
    command.type === 'CHOOSE_DECK_POSITION'
  ) {
    // A decision command without an open pending interaction has nothing to
    // answer (spec §21: the action would violate the current interaction state).
    return { ok: false, error: 'PENDING_DECISION_REQUIRED', state: round };
  }

  const commandError =
    command.type === 'DRAW_CARD'
      ? validateDrawCard(round)
      : validatePlayCard(round, command, dependencies);
  if (commandError) {
    return { ok: false, error: commandError, state: round };
  }

  const state = cloneRoundState(round);
  return command.type === 'DRAW_CARD'
    ? applyDrawCard(state, command.actorId)
    : applyPlayCard(round, state, command, dependencies);
}

/**
 * Pending-interaction routing (spec §6): validates that the command is the
 * decision the open pending stage waits for, issued by the pending actor.
 * Wrong actor → `NOT_YOUR_TURN`; any other command while a decision is owed →
 * `PENDING_DECISION_REQUIRED` (spec §21). All rejections leave the state and
 * the open pending untouched.
 */
function applyCommandWithPending(round: RoundState, command: TurnCommand): TurnCommandResult {
  const pending = round.pendingInteraction;
  if (pending === null) {
    // Unreachable: the caller guarantees a non-null pending interaction.
    return { ok: false, error: 'PENDING_DECISION_REQUIRED', state: round };
  }
  if (round.status !== 'ROUND_ACTIVE') {
    return { ok: false, error: 'ROUND_ALREADY_ENDED', state: round };
  }
  if (command.actorId !== pending.actorId) {
    return { ok: false, error: 'NOT_YOUR_TURN', state: round };
  }
  const isStageCommand =
    (pending.type === 'PECERA_TARGET' && command.type === 'CHOOSE_TARGET') ||
    (pending.type === 'PECERA_GUESS' && command.type === 'SUBMIT_GUESS') ||
    (pending.type === 'RATON_INSERT_POSITION' && command.type === 'CHOOSE_DECK_POSITION') ||
    (pending.type === 'SAQUEADOG_SWAP' && command.type === 'CHOOSE_HIDDEN_SWAP');
  if (!isStageCommand) {
    return { ok: false, error: 'PENDING_DECISION_REQUIRED', state: round };
  }
  if (command.type === 'CHOOSE_TARGET') {
    return applyChooseTarget(round, command);
  }
  if (command.type === 'CHOOSE_HIDDEN_SWAP') {
    return applyChooseHiddenSwap(round, command);
  }
  if (command.type === 'CHOOSE_DECK_POSITION') {
    return applyChooseDeckPosition(round, command);
  }
  return applySubmitGuess(round, command);
}

/**
 * Card 1 Pecera step two (catalog §1): validates the target through the
 * centralized classifier before any mutation (spec §8), then opens the
 * `PECERA_GUESS` stage for the same actor. The turn stays paused.
 */
function applyChooseTarget(round: RoundState, command: ChooseTargetCommand): TurnCommandResult {
  const pending = round.pendingInteraction as { type: 'PECERA_TARGET'; actorId: PlayerId };
  const decision = classifyHandTarget(round, pending.actorId, command.targetId);
  if (decision !== 'LEGAL_TARGET') {
    return {
      ok: false,
      error: decision === 'TARGET_PROTECTED' ? 'TARGET_PROTECTED' : 'ILLEGAL_TARGET',
      state: round,
    };
  }
  const state = cloneRoundState(round);
  state.pendingInteraction = {
    type: 'PECERA_GUESS',
    actorId: pending.actorId,
    targetId: command.targetId,
  };
  return { ok: true, state, events: [] };
}

/**
 * Card 1 Pecera step three (catalog §1; test plan §7): validates the secret
 * guess — an integer 0..10 excluding the prohibited value 1 — then resolves it
 * against the chosen target's single hand card. A correct guess eliminates the
 * target through the centralized `eliminatePlayer`; a wrong guess neither
 * reveals nor mutates the target hand. The public event carries only ids and
 * correctness, never the guessed or the actual value (rules §13; open questions
 * "Privacy scope for Milestone 3"). The turn finalizes exactly once after the
 * guess, unless the elimination already ended the round (spec §§10,11).
 */
function applySubmitGuess(round: RoundState, command: SubmitGuessCommand): TurnCommandResult {
  const pending = round.pendingInteraction as {
    type: 'PECERA_GUESS';
    actorId: PlayerId;
    targetId: PlayerId;
  };
  const { value } = command;
  if (!Number.isInteger(value) || value < 0 || value > 10 || value === 1) {
    return { ok: false, error: 'INVALID_GUESS', state: round };
  }

  const state = cloneRoundState(round);
  state.pendingInteraction = null;
  const target = playerById(state, pending.targetId);
  const targetCard = target?.hand[0];
  const correct = Boolean(target && targetCard && targetCard.value === value);
  const events: TurnEvent[] = [
    {
      type: 'PECERA_GUESS_RESOLVED',
      actorId: pending.actorId,
      targetId: pending.targetId,
      correct,
    },
  ];

  if (!correct) {
    // Wrong guess: nothing else happens (catalog §1). Only the deferred
    // round-end check and the normal single turn advance remain.
    const endCheck = checkRoundEnd(state);
    if (endCheck.ended) {
      events.push(...endCheck.events);
      return { ok: true, state: endCheck.state, events };
    }
    events.push(...advanceTurn(state));
    return { ok: true, state, events };
  }

  const elimination = eliminatePlayer(state, pending.targetId);
  if (!elimination.ok) {
    // Defensive: the target was validated as an active legal player when the
    // pending opened and nothing else runs in between, so a failure here must
    // leave the state unchanged instead of half-applying (spec §8).
    return { ok: false, error: 'ILLEGAL_TARGET', state: round };
  }
  const next = elimination.state;
  events.push(...elimination.events);
  if (next.status !== 'ROUND_ACTIVE') {
    // The elimination centralized the round-end check: no further advance.
    return { ok: true, state: next, events };
  }
  events.push(...advanceTurn(next));
  return { ok: true, state: next, events };
}

/**
 * Card 6 Saqueadog decision (catalog §6; multiplayer spec §12): resolve the
 * private keep-or-swap choice against the hidden card. `swap: true` atomically
 * exchanges the actor's one remaining hand card with the hidden card — each
 * identity becomes the other's slot; `swap: false` leaves both identities
 * unchanged. Either way the pending clears and the turn finalizes exactly
 * once: the deferred round-end check runs first (the play may have consumed
 * the last drawable card), then the single turn advance. The public
 * `SAQUEADOG_RESOLVED` event carries only the actor id, so the stream cannot
 * distinguish the two choices (multiplayer spec §12).
 */
function applyChooseHiddenSwap(
  round: RoundState,
  command: ChooseHiddenSwapCommand,
): TurnCommandResult {
  const pending = round.pendingInteraction as { type: 'SAQUEADOG_SWAP'; actorId: PlayerId };
  if (typeof command.swap !== 'boolean') {
    // Defensive: the decision domain is exactly { true, false }; anything else
    // is rejected without mutation and the pending stays open.
    return { ok: false, error: 'INVALID_SWAP_CHOICE', state: round };
  }
  if (command.swap) {
    // Validate the exchange preconditions before any mutation (spec §8): the
    // actor must hold exactly one card and the hidden slot exactly one card.
    // The turn engine guarantees this shape after a voluntary play, so a
    // failure here is unreachable through the engine and must leave the state
    // unchanged instead of half-applying a swap.
    const actor = playerById(round, pending.actorId);
    if (!actor || actor.hand.length !== 1 || round.hiddenCard === null) {
      return { ok: false, error: 'INVALID_SWAP_CHOICE', state: round };
    }
  }

  const state = cloneRoundState(round);
  state.pendingInteraction = null;
  const events: TurnEvent[] = [{ type: 'SAQUEADOG_RESOLVED', playerId: pending.actorId }];

  if (command.swap) {
    const actor = playerById(state, pending.actorId) as PlayerState;
    const [currentHandCard] = actor.hand;
    actor.hand = [state.hiddenCard];
    state.hiddenCard = currentHandCard;
  }

  const endCheck = checkRoundEnd(state);
  if (endCheck.ended) {
    // The turn consumed the final drawable card: end the round instead of
    // advancing into a draw that cannot happen (spec §11; rules §9).
    events.push(...endCheck.events);
    return { ok: true, state: endCheck.state, events };
  }
  events.push(...advanceTurn(state));
  return { ok: true, state, events };
}

/**
 * Card 2 Ratón decision (catalog §2; multiplayer spec §12): reinsert the
 * detached pending card at the secret chosen position. The index must be an
 * integer in [0, current drawPile.length] — 0 puts the card back on top,
 * `drawPile.length` inserts it at the bottom — any other value is rejected
 * with `INVALID_POSITION` while the pending stays open and nothing mutates
 * (spec §8). On success the pending clears and the turn finalizes exactly
 * once: the deferred round-end check runs first (the pile may have been
 * exhausted while the decision was owed), then the single turn advance. The
 * public `RATON_RESOLVED` event carries only the actor id, so the stream
 * cannot reveal the inspected card or the chosen index (rules §13).
 */
function applyChooseDeckPosition(
  round: RoundState,
  command: ChooseDeckPositionCommand,
): TurnCommandResult {
  const pending = round.pendingInteraction as {
    type: 'RATON_INSERT_POSITION';
    actorId: PlayerId;
    card: CardInstance;
  };
  const { index } = command;
  if (!Number.isInteger(index) || index < 0 || index > round.drawPile.length) {
    return { ok: false, error: 'INVALID_POSITION', state: round };
  }

  const state = cloneRoundState(round);
  // The pending card is already a private deep clone, and cloning the state
  // cloned it again: splicing that clone into the pile keeps the input
  // state's pending card object untouched (spec §8 purity).
  const reinsertedCard = (state.pendingInteraction as { card: CardInstance }).card;
  state.pendingInteraction = null;
  state.drawPile.splice(index, 0, reinsertedCard);

  const events: TurnEvent[] = [{ type: 'RATON_RESOLVED', playerId: pending.actorId }];

  const endCheck = checkRoundEnd(state);
  if (endCheck.ended) {
    // The turn consumed the final drawable card: end the round instead of
    // advancing into a draw that cannot happen (spec §11; rules §9).
    events.push(...endCheck.events);
    return { ok: true, state: endCheck.state, events };
  }
  events.push(...advanceTurn(state));
  return { ok: true, state, events };
}

function validateCommonTurnPreconditions(
  round: RoundState,
  actorId: PlayerId,
): TurnErrorCode | null {
  if (round.status !== 'ROUND_ACTIVE') {
    return 'ROUND_ALREADY_ENDED';
  }
  if (round.pendingInteraction !== null) {
    return 'PENDING_DECISION_REQUIRED';
  }
  const actor = playerById(round, actorId);
  if (!actor || round.currentPlayerId !== actorId) {
    return 'NOT_YOUR_TURN';
  }
  if (actor.eliminated) {
    return 'PLAYER_ELIMINATED';
  }
  return null;
}

function validateDrawCard(round: RoundState): TurnErrorCode | null {
  if (round.phase !== 'DRAW_REQUIRED') {
    return 'UNEXPECTED_COMMAND';
  }
  if (round.drawPile.length === 0) {
    return 'DRAW_PILE_EMPTY';
  }
  return null;
}

function validatePlayCard(
  round: RoundState,
  command: PlayCardCommand,
  dependencies: TurnEngineDependencies | undefined,
): TurnErrorCode | null {
  if (round.phase !== 'PLAY_REQUIRED') {
    return 'UNEXPECTED_COMMAND';
  }
  const actor = playerById(round, command.actorId);
  if (!actor || !actor.hand.some((card) => card.instanceId === command.cardInstanceId)) {
    return 'CARD_NOT_IN_HAND';
  }
  // Target-bearing cards validate the atomic target decision before any
  // mutation or discard (spec §8; rules §14). Cards without a target ignore a
  // stray targetId. No-legal-target rule: when a target-bearing card is
  // mandatorily played while zero legal opponent targets exist (every other
  // player eliminated or protected), the target requirement is waived — the
  // card is discarded normally and its printed effect does nothing (effect
  // handlers no-op on a missing target). Self-targeting stays illegal, and
  // while at least one legal target exists the targetId requirement and typed
  // errors are unchanged.
  const playedCard = actor.hand.find((card) => card.instanceId === command.cardInstanceId);
  if (
    playedCard?.type === 'ERMITANO_BUSCA_CASA' ||
    playedCard?.type === 'CONEJITO_GUERRILLERO' ||
    playedCard?.type === 'SERPIENTE_ENCANTADORA'
  ) {
    if (!command.targetId) {
      // Omission is acceptable only when no legal target exists at all.
      if (!hasLegalHandTarget(round, command.actorId)) {
        return null;
      }
      return 'ILLEGAL_TARGET';
    }
    const decision = classifyHandTarget(round, command.actorId, command.targetId);
    if (decision !== 'LEGAL_TARGET') {
      return decision === 'TARGET_PROTECTED' ? 'TARGET_PROTECTED' : 'ILLEGAL_TARGET';
    }
  }
  // Card 7 Malabarista is a random card (spec §9): it requires an explicit
  // engine-owned RNG dependency. Rejecting here keeps the rejection strictly
  // before any mutation; non-random cards remain callable without an RNG.
  if (playedCard?.type === 'MALABARISTA_DE_OCHO_PATAS' && !dependencies?.rng) {
    return 'MISSING_RNG';
  }
  return null;
}

function applyDrawCard(state: RoundState, actorId: PlayerId): TurnCommandSuccess {
  const actor = playerById(state, actorId) as PlayerState;
  const [drawnCard, ...remainingPile] = state.drawPile;
  actor.hand.push(drawnCard);
  state.drawPile = remainingPile;
  state.phase = 'PLAY_REQUIRED';
  return {
    ok: true,
    state,
    events: [{ type: 'CARD_DRAWN', playerId: actorId }],
  };
}

function applyPlayCard(
  round: RoundState,
  state: RoundState,
  command: PlayCardCommand,
  dependencies: TurnEngineDependencies | undefined,
): TurnCommandResult {
  const actor = playerById(state, command.actorId) as PlayerState;
  const handIndex = actor.hand.findIndex((card) => card.instanceId === command.cardInstanceId);
  const [playedCard] = actor.hand.splice(handIndex, 1);
  const discardEntry: PublicDiscardEntry = { card: playedCard, origin: 'PLAYED' };
  actor.discards.push(discardEntry);

  const events: TurnEvent[] = [
    { type: 'CARD_PLAYED', playerId: command.actorId, card: playedCard },
  ];

  // Spec §10: the played card enters the public discard area, then its effect
  // resolves before elimination and round-end checks (spec §§10,13).
  const effect = resolveFaceUpCardEffect(state, {
    playerId: command.actorId,
    card: playedCard,
    origin: 'PLAYED',
    targetId: command.targetId,
    rng: dependencies?.rng,
  });
  if (effect.errorCode) {
    // Unreachable through the engine (validatePlayCard gates the RNG first),
    // but a handler rejection must surface as a typed failure with the
    // untouched input state instead of a half-applied transition (spec §8).
    return { ok: false, error: effect.errorCode, state: round };
  }
  events.push(...effect.events);
  const currentState = effect.state;

  // A pending interaction pauses the turn (spec §6): the deferred round-end
  // check and the single turn advance run only when the pending resolves.
  if (currentState.pendingInteraction !== null) {
    return { ok: true, state: currentState, events };
  }

  if (currentState.status !== 'ROUND_ACTIVE') {
    return { ok: true, state: currentState, events };
  }
  if (effect.eliminatedPlayerId === command.actorId) {
    // eliminatePlayer already centralized the round-end check and handed the
    // turn to the next active player after removing the current actor. A Card 5
    // Serpiente forced-play elimination of a non-actor target keeps the actor's
    // turn, so it advances through the normal path below (spec §§10,17).
    return { ok: true, state: currentState, events };
  }

  const endCheck = checkRoundEnd(currentState);
  if (endCheck.ended) {
    // The turn consumed the final drawable card: end the round instead of
    // advancing into a draw that cannot happen (spec §11; rules §9).
    events.push(...endCheck.events);
    return { ok: true, state: endCheck.state, events };
  }

  events.push(...advanceTurn(currentState));

  return { ok: true, state: currentState, events };
}
