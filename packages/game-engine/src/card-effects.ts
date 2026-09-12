/**
 * Card effect dispatch (spec §§13,16,18): routes a card placed face up in front
 * of its holder to that card's handler, keeping printed actions and intrinsic
 * triggers distinct (catalog "Important timing distinction").
 *
 * Callers invoke this only for public face-up placements (`PLAYED`,
 * `FORCED_PLAY`). Elimination reveals never pass through this dispatch:
 * `eliminatePlayer` reveals hands without resolving printed actions, so a
 * Rey Gato exposed by an elimination reveal cannot recursively trigger card
 * effects (rules §6.3, §15; test plan §16).
 *
 * Two registries implement the mandatory distinction:
 * - intrinsic face-up triggers fire for every public origin (`PLAYED` and
 *   `FORCED_PLAY`) — Rey Gato eliminates its holder regardless of why the card
 *   became face up (catalog §10);
 * - printed actions resolve only for voluntary origin `PLAYED`. A forced
 *   face-up placement suppresses the printed action (catalog §5; spec §18
 *   `resolvePrintedAction = false`), so forced placements skip that registry.
 *
 * Milestone 3 adds one handler per work unit; card types without a shipped
 * handler are deliberate no-ops. Handlers receive the caller's private state
 * and may return a replacement state produced by a centralized helper.
 */
import type {
  CardInstance,
  CardType,
  PlayerId,
  PlayerState,
  PublicDiscardOrigin,
  RoundState,
} from './models';
import { shuffleDeck } from './deck';
import type { Rng } from './rng';
import {
  canTargetHand,
  classifyHandTarget,
  cloneRoundState,
  eliminatePlayer,
  hasLegalHandTarget,
  playerById,
} from './round-rules';
import type { PlayerProtectedEvent, RoundRulesEvent } from './round-rules';

export interface FaceUpCardEffectContext {
  /** Holder in front of whom the card was placed face up. */
  playerId: PlayerId;
  card: CardInstance;
  origin: PublicDiscardOrigin;
  /**
   * Atomic target decision for target-bearing cards (e.g. Card 8 Ermitaño).
   * Carried on the voluntary play command itself; cards without a target
   * ignore it, so a stray value is harmless.
   */
  targetId?: PlayerId;
  /**
   * Explicit random source for cards whose printed action shuffles or picks
   * randomly (e.g. Card 7 Malabarista). Cards without a random component
   * ignore it, so a missing value is harmless for them.
   */
  rng?: Rng;
}

export interface CardEffectResolution {
  /** State after the effect; may be a fresh clone produced by a centralized helper. */
  state: RoundState;
  events: RoundRulesEvent[];
  /** Holder eliminated by this effect, if any. */
  eliminatedPlayerId: PlayerId | null;
  /**
   * Typed failure when the effect could not resolve at all (e.g. Card 7 played
   * without the required RNG). Present only on rejection; the returned state is
   * then the untouched input state.
   */
  errorCode?: CardEffectErrorCode;
}

/** Typed error codes surfaced by card-effect handlers on total rejection. */
export type CardEffectErrorCode = 'MISSING_RNG';

type FaceUpCardEffectHandler = (
  state: RoundState,
  context: FaceUpCardEffectContext,
) => CardEffectResolution;

/** Intrinsic triggers fire for any public origin; the printed action does not. */
const INTRINSIC_FACE_UP_TRIGGERS: Partial<Record<CardType, FaceUpCardEffectHandler>> = {
  REY_GATO: resolveReyGatoFaceUp,
};

/** Printed actions resolve only for voluntary origin `PLAYED` (spec §18). */
const PRINTED_ACTION_HANDLERS: Partial<Record<CardType, FaceUpCardEffectHandler>> = {
  CAPARAZON_ARMAZON: resolveCaparazonPrintedAction,
  CONEJITO_GUERRILLERO: resolveConejitoPrintedAction,
  ERMITANO_BUSCA_CASA: resolveErmitanoPrintedAction,
  MALABARISTA_DE_OCHO_PATAS: resolveMalabaristaPrintedAction,
  NO_SOY_UNA_MASCOTA: resolveNoSoyUnaMascotaPrintedAction,
  PECERA_DE_CRISTAL: resolvePeceraPrintedAction,
  RATON_TRAMPERO: resolveRatonPrintedAction,
  SAQUEADOG_DE_TUMBAS: resolveSaqueadogPrintedAction,
  SERPIENTE_ENCANTADORA: resolveSerpientePrintedAction,
};

export function resolveFaceUpCardEffect(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const intrinsic = INTRINSIC_FACE_UP_TRIGGERS[context.card.type];
  if (intrinsic) {
    return intrinsic(state, context);
  }
  // Forced face-up placement (catalog §5) suppresses the printed action while
  // intrinsic triggers above still apply.
  if (context.origin !== 'PLAYED') {
    return { state, events: [], eliminatedPlayerId: null };
  }
  const printed = PRINTED_ACTION_HANDLERS[context.card.type];
  if (!printed) {
    return { state, events: [], eliminatedPlayerId: null };
  }
  return printed(state, context);
}

/**
 * Card 10 — Rey Gato (catalog §10): placed face up in front of its holder for
 * any reason, it eliminates that holder immediately and has no separate
 * printed action to resolve. Voluntary and forced public plays share this
 * canonical path; elimination reveals never reach it (see module docblock).
 */
function resolveReyGatoFaceUp(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const elimination = eliminatePlayer(state, context.playerId);
  if (!elimination.ok) {
    // Defensive: the dispatch only runs for active rounds and real holders,
    // so a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  return {
    state: elimination.state,
    events: elimination.events,
    eliminatedPlayerId: context.playerId,
  };
}

/**
 * Card 1 — Pecera de Cristal (catalog §1): the first step of the two-step
 * private interaction. The played card is already in the public discard area;
 * this handler only decides whether the target decision opens at all. When at
 * least one legal opponent target exists, it opens a `PECERA_TARGET` pending
 * interaction for the actor and pauses the turn (spec §6); when zero legal
 * opponents exist, the card fizzles: discarded normally, no pending, no effect,
 * and the caller advances the turn through the normal lifecycle (no-legal-target
 * rule). The target choice itself arrives later via `CHOOSE_TARGET` and is
 * validated there through the centralized classifier — a stray `targetId` on
 * the play command is deliberately ignored so targeting is never an atomic play
 * decision for this card.
 */
function resolvePeceraPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (!hasLegalHandTarget(state, context.playerId)) {
    // No-legal-target fizzle: discard only, no pending interaction, normal turn.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const nextState = cloneRoundState(state);
  nextState.pendingInteraction = { type: 'PECERA_TARGET', actorId: context.playerId };
  return { state: nextState, events: [], eliminatedPlayerId: null };
}

/**
 * Card 2 — Ratón Trampero (catalog §2; rules §13; resolved project decision on
 * an empty draw pile): the first step of the private reinsertion interaction.
 * The played card is already in the public discard area; this handler only
 * decides whether the inspection opens at all.
 *
 * With a nonempty draw pile, the top card is secretly detached from the pile
 * into a `RATON_INSERT_POSITION` pending interaction that carries the full
 * detached CardInstance as a private deep clone — conservation stays explicit
 * in canonical state while no public event exposes the identity or the later
 * insertion index. The turn pauses until the actor answers through
 * `CHOOSE_DECK_POSITION` (spec §6).
 *
 * With an empty draw pile the effect fizzles: no pending interaction opens,
 * the hidden card is not used as a replacement and remains unchanged, and the
 * caller finalizes the turn through the normal lifecycle, whose deferred
 * round-end check resolves the draw-pile exhaustion (project decision).
 */
function resolveRatonPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (state.drawPile.length === 0) {
    // Resolved project decision: empty pile fizzle, hidden card untouched.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const nextState = cloneRoundState(state);
  const [inspectedCard, ...remainingPile] = nextState.drawPile;
  nextState.drawPile = remainingPile;
  nextState.pendingInteraction = {
    type: 'RATON_INSERT_POSITION',
    actorId: context.playerId,
    // Deep clone: the pending card must never alias the cloned (or any other)
    // state object, so callers can never mutate canonical state through it.
    card: { ...inspectedCard },
  };
  return { state: nextState, events: [], eliminatedPlayerId: null };
}

/**
 * Card 8 — Ermitaño Busca Casa (catalog §8): exchange the card remaining in the
 * acting player's hand with the card in one legal, active, unprotected other
 * player's hand. Neither card is revealed publicly; no peek or private reveal
 * event is emitted — players learn the resulting hands only through their own
 * projections. The target is a single atomic decision carried on the play
 * command, so the handler re-validates through the centralized classifier and
 * leaves the state untouched on any illegal target (rules §14).
 */
function resolveErmitanoPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  if (!context.targetId) {
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (classifyHandTarget(state, context.playerId, context.targetId) !== 'LEGAL_TARGET') {
    return { state, events: [], eliminatedPlayerId: null };
  }
  const swapped = exchangeHands(state, context.playerId, context.targetId);
  if (!swapped) {
    // Defensive: the turn engine guarantees exactly one hand card per side, so
    // an unexpected hand shape must leave the state unchanged instead of
    // half-applying a swap.
    return { state, events: [], eliminatedPlayerId: null };
  }
  return {
    state: swapped,
    events: [{ type: 'HANDS_SWAPPED', playerIds: [context.playerId, context.targetId] }],
    eliminatedPlayerId: null,
  };
}

/**
 * Pure swap helper (catalog §8): clone the state and exchange the two players'
 * hand cards without touching anything else. Returns `null` when either player
 * is missing or does not hold exactly one card, so a swap is never applied to a
 * malformed hand. Card mutation stays centralized here; callers emit events.
 */
function exchangeHands(
  round: RoundState,
  firstId: PlayerId,
  secondId: PlayerId,
): RoundState | null {
  const state = cloneRoundState(round);
  const first = playerById(state, firstId);
  const second = playerById(state, secondId);
  if (!first || !second || first.hand.length !== 1 || second.hand.length !== 1) {
    return null;
  }
  const firstHand = first.hand;
  first.hand = second.hand;
  second.hand = firstHand;
  return state;
}

/**
 * Card 9 — ¡No soy una mascota! (catalog §9; open questions "Protected Rey Gato
 * holder vs card 9"): search the other active, unprotected players for the
 * unique Rey Gato held in hand and exchange the acting player's one remaining
 * hand card with that holder's hand through the centralized pure exchange seam.
 *
 * - The search is a server-side decision (catalog §9 "Information"): no
 *   targetId participates, a stray value is ignored, and no pending interaction
 *   opens — this is never a player decision.
 * - A protected Rey holder's hand cannot be manipulated, so the holder must be
 *   both active and unprotected to be found (project resolution based on
 *   Caparazón wording).
 * - When the acting player already holds the Rey Gato after playing 9 (any
 *   hand position), there is no other holder to find and the card fizzles:
 *   discarded normally, no exchange (catalog §9).
 * - No eligible holder (none holds Rey, holder protected/eliminated): no
 *   effect; the caller finalizes the turn through the normal lifecycle.
 * - The exchanged Rey Gato moves hand to hand without ever being face up, so
 *   no intrinsic trigger fires and neither player is eliminated (catalog §10).
 */
function resolveNoSoyUnaMascotaPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (actor.hand.some((card) => card.type === 'REY_GATO')) {
    // The acting player already holds the unique Rey Gato: there is no other
    // holder to exchange with (catalog §9), so the card fizzles with no effect.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const holder = state.players.find(
    (candidate) =>
      canTargetHand(state, context.playerId, candidate.id) &&
      candidate.hand[0]?.type === 'REY_GATO',
  );
  if (!holder) {
    // No eligible holder (no Rey in any active unprotected other hand): no effect.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const swapped = exchangeHands(state, context.playerId, holder.id);
  if (!swapped) {
    // Defensive: the turn engine guarantees exactly one hand card per side, so
    // an unexpected hand shape must leave the state unchanged instead of
    // half-applying a swap.
    return { state, events: [], eliminatedPlayerId: null };
  }
  return {
    state: swapped,
    events: [{ type: 'HANDS_SWAPPED', playerIds: [context.playerId, holder.id] }],
    eliminatedPlayerId: null,
  };
}

/**
 * Card 5 — Serpiente Encantadora (catalog §5; engine spec §18; resolved open
 * question "Serpiente replacement with an empty draw pile"): choose one legal,
 * active, unprotected other player and force the card currently in their hand
 * to be placed face up in front of them. The printed action of the forced card
 * is not resolved (the `FORCED_PLAY` origin suppresses it), but its intrinsic
 * face-up trigger still applies — a forced Rey Gato eliminates its holder
 * immediately through the shared card-effect dispatch.
 *
 * Sequence (spec §10; catalog §5):
 * 1. Validate the atomic target through the centralized classifier; any illegal
 *    or protected target leaves the state untouched (rules §14).
 * 2. Move the target's hand card face up into their public discard area with
 *    origin `FORCED_PLAY` and emit the public `CARD_FORCED_FACE_UP` event
 *    carrying that now-public card.
 * 3. Dispatch the face-up effect with origin `FORCED_PLAY` so intrinsic
 *    triggers (Rey Gato) fire while printed actions stay suppressed.
 * 4. If the target survived: draw a replacement from the draw pile into their
 *    hand and emit a secret-free `CARD_DRAWN` event with the target's id only.
 *    If the draw pile is empty, the target is eliminated immediately through
 *    the centralized lifecycle (resolved open question); the hidden card is
 *    never used as a replacement.
 *
 * With zero legal opponents (no-legal-target rule), a mandatory voluntary play
 * discards Serpiente normally and fizzles; the caller advances the turn through
 * the normal lifecycle.
 */
function resolveSerpientePrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (!context.targetId) {
    // The no-legal-target fizzle and the targetId requirement are validated by
    // the turn engine before this handler runs; a missing target here fizzles
    // with no effect.
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (classifyHandTarget(state, context.playerId, context.targetId) !== 'LEGAL_TARGET') {
    return { state, events: [], eliminatedPlayerId: null };
  }
  const forced = moveHandFaceUp(state, context.targetId);
  if (!forced) {
    // Defensive: the turn engine guarantees exactly one hand card for the
    // target, so an unexpected hand shape must leave the state unchanged
    // instead of half-applying a forced play.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const events: RoundRulesEvent[] = [
    { type: 'CARD_FORCED_FACE_UP', playerId: context.targetId, card: forced.card },
  ];
  // The forced placement resolves intrinsic face-up triggers only (spec §18):
  // printed actions are suppressed by the FORCED_PLAY origin.
  const effect = resolveFaceUpCardEffect(forced.state, {
    playerId: context.targetId,
    card: forced.card,
    origin: 'FORCED_PLAY',
  });
  events.push(...effect.events);
  if (effect.eliminatedPlayerId !== null) {
    // A forced Rey Gato eliminated the target: no replacement draw (catalog §5).
    return { state: effect.state, events, eliminatedPlayerId: effect.eliminatedPlayerId };
  }
  const target = playerById(effect.state, context.targetId);
  if (!target) {
    return { state: effect.state, events, eliminatedPlayerId: null };
  }
  if (effect.state.drawPile.length === 0) {
    // Resolved open question: no replacement card exists, so the target is
    // eliminated immediately through the centralized lifecycle. The hidden
    // card is never used as a replacement.
    const elimination = eliminatePlayer(effect.state, context.targetId);
    if (!elimination.ok) {
      return { state: effect.state, events, eliminatedPlayerId: null };
    }
    return {
      state: elimination.state,
      events: [...events, ...elimination.events],
      eliminatedPlayerId: context.targetId,
    };
  }
  const [replacement, ...remainingPile] = effect.state.drawPile;
  target.hand.push(replacement);
  effect.state.drawPile = remainingPile;
  events.push({ type: 'CARD_DRAWN', playerId: context.targetId });
  return { state: effect.state, events, eliminatedPlayerId: null };
}

/**
 * Pure forced-play helper (catalog §5): clone the state and move the target's
 * single hand card face up into their public discard area with origin
 * `FORCED_PLAY`. Returns `null` when the player is missing or does not hold
 * exactly one card, so a forced play is never applied to a malformed hand. Card
 * mutation stays centralized here; callers emit events.
 */
function moveHandFaceUp(
  round: RoundState,
  playerId: PlayerId,
): { state: RoundState; card: CardInstance } | null {
  const state = cloneRoundState(round);
  const target = playerById(state, playerId);
  if (!target || target.hand.length !== 1) {
    return null;
  }
  const [card] = target.hand.splice(0, 1);
  target.discards.push({ card, origin: 'FORCED_PLAY' });
  return { state, card };
}

/**
 * Card 3 — Conejito Guerrillero (catalog §3): compare the card remaining in
 * the acting player's hand with the card in one legal, active, unprotected
 * other player's hand; the lower-valued holder is eliminated through the
 * centralized `eliminatePlayer`, and equal values eliminate nobody (project
 * resolution in open questions). The comparison itself reveals no values: no
 * value-bearing event is emitted, so the only public signals are the played
 * card and any elimination reveal owned by `eliminatePlayer`. The target is a
 * single atomic decision carried on the play command, so the handler
 * re-validates through the centralized classifier and leaves the state
 * untouched on any illegal target (rules §14).
 *
 * Rey Gato held in either hand is an ordinary value 10 here: it is not face
 * up, so it neither triggers nor eliminates its holder through this
 * comparison (catalog §10 fires only on face-up placements; elimination
 * reveals route through the no-op reveal-path intrinsic).
 */
function resolveConejitoPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  if (!context.targetId) {
    return { state, events: [], eliminatedPlayerId: null };
  }
  if (classifyHandTarget(state, context.playerId, context.targetId) !== 'LEGAL_TARGET') {
    return { state, events: [], eliminatedPlayerId: null };
  }
  const actor = playerById(state, context.playerId);
  const target = playerById(state, context.targetId);
  if (!actor || !target || actor.hand.length !== 1 || target.hand.length !== 1) {
    // Defensive: the turn engine guarantees exactly one remaining hand card
    // per side after the play, so an unexpected hand shape must leave the
    // state unchanged instead of half-applying a comparison.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const actorValue = actor.hand[0].value;
  const targetValue = target.hand[0].value;
  if (actorValue === targetValue) {
    // Equal values eliminate nobody (project resolution); nothing else
    // happens publicly, so the turn advances through the normal path.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const loserId = actorValue < targetValue ? context.playerId : context.targetId;
  const elimination = eliminatePlayer(state, loserId);
  if (!elimination.ok) {
    // Defensive: the dispatch only runs for active rounds and real holders,
    // so a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  return {
    state: elimination.state,
    events: elimination.events,
    eliminatedPlayerId: loserId,
  };
}

/**
 * Card 6 — Saqueadog de Tumbas (catalog §6): hidden-card inspection and
 * optional exchange. The printed action only opens the decision: it sets a
 * `SAQUEADOG_SWAP` pending interaction for the actor and pauses the turn
 * (spec §6). The hidden card keeps its identity in canonical state, where the
 * actor accesses it privately; no public identity event is emitted here or at
 * decision time (multiplayer spec §12). There is no fizzle case: the card has
 * no targets, and an active round always holds exactly one hidden card. The
 * exchange itself is applied by the turn engine when the actor answers through
 * `CHOOSE_HIDDEN_SWAP`.
 */
function resolveSaqueadogPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const nextState = cloneRoundState(state);
  nextState.pendingInteraction = { type: 'SAQUEADOG_SWAP', actorId: context.playerId };
  return { state: nextState, events: [], eliminatedPlayerId: null };
}

/**
 * Card 4 — Caparazón Armazón (catalog §4): self-protection printed action. The
 * acting player becomes protected until the beginning of their next turn; the
 * expiry itself is owned by the existing advance-turn lifecycle (rules §7;
 * spec §10). Emits a public, secret-free `PLAYER_PROTECTED` event.
 */
function resolveCaparazonPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  const nextState = cloneRoundState(state);
  const nextActor = playerById(nextState, context.playerId);
  if (!nextActor) {
    return { state, events: [], eliminatedPlayerId: null };
  }
  nextActor.protected = true;
  const event: PlayerProtectedEvent = { type: 'PLAYER_PROTECTED', playerId: context.playerId };
  return { state: nextState, events: [event], eliminatedPlayerId: null };
}

/**
 * Card 7 — Malabarista de Ocho Patas (catalog §7; engine spec §19): global
 * active-hand reset. Every active player returns their single hand card to the
 * draw pile; eliminated players contribute nothing. Prior public discards, the
 * hidden card, and the played Malabarista itself (already face up in the
 * actor's discard area with origin `PLAYED`) all stay outside the shuffle. The
 * reconstructed pile — returned hands plus the current draw pile — is shuffled
 * with the explicitly injected `Rng` and one card is dealt back to each active
 * player in stable turn order (`turnOrder` order, skipping eliminated
 * players); the remainder stays as the draw pile. Protection flags belong to
 * the global reset, not a targeted hand action, so they are never cleared by
 * the redeal (open questions "Malabarista and protection").
 *
 * The shuffle requires an `Rng`: playing Card 7 without one is rejected before
 * any mutation with the typed `MISSING_RNG` error (spec §9: the engine receives
 * RNG as a dependency; never `Math.random`). A secret-free
 * `HANDS_REDEALT { playerIds }` event carries the receiving players in deal
 * order — no card identities or values are ever emitted (rules §13).
 */
function resolveMalabaristaPrintedAction(
  state: RoundState,
  context: FaceUpCardEffectContext,
): CardEffectResolution {
  if (!context.rng) {
    // The turn engine validates this before any mutation; a direct dispatch
    // caller receives the typed error with the untouched input state.
    return { state, events: [], eliminatedPlayerId: null, errorCode: 'MISSING_RNG' };
  }
  const actor = playerById(state, context.playerId);
  if (!actor || actor.eliminated) {
    // Defensive: the dispatch only runs for active rounds and real holders, so
    // a failure here must leave the state unchanged instead of half-applying.
    return { state, events: [], eliminatedPlayerId: null };
  }
  // Stable deal order: canonical turn order restricted to active players.
  const dealOrder = state.turnOrder.filter((id) => {
    const player = playerById(state, id);
    return Boolean(player && !player.eliminated);
  });
  const nextState = cloneRoundState(state);
  const returnedCards: CardInstance[] = [];
  for (const id of dealOrder) {
    const player = playerById(nextState, id) as PlayerState;
    returnedCards.push(...player.hand);
    player.hand = [];
  }
  const reshuffled = shuffleDeck([...returnedCards, ...nextState.drawPile], context.rng);
  const dealt = reshuffled.slice(0, dealOrder.length);
  for (let index = 0; index < dealOrder.length; index += 1) {
    const player = playerById(nextState, dealOrder[index]) as PlayerState;
    player.hand = [dealt[index]];
  }
  nextState.drawPile = reshuffled.slice(dealOrder.length);
  return {
    state: nextState,
    events: [{ type: 'HANDS_REDEALT', playerIds: dealOrder }],
    eliminatedPlayerId: null,
  };
}
