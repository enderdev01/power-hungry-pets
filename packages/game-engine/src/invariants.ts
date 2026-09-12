/**
 * Canonical state invariant checking (Milestone 5 work unit 2; engine spec §20).
 *
 * Pure, read-only predicates over canonical `RoundState`/`MatchState`:
 * `findRoundInvariantViolations` and `findMatchInvariantViolations` return
 * stable-coded violations without mutating their input, while
 * `assertRoundInvariants` and `assertMatchInvariants` throw a single typed
 * `InvariantViolationError` aggregating every detected violation.
 *
 * Round checks understand every valid transitional state the engine produces:
 * - conservation: exactly the canonical 21 unique card instances of the deck,
 *   each matching its catalog definition, spread across hands, public discards,
 *   the draw pile, the hidden card, and the detached Ratón pending card;
 * - exactly one Rey Gato instance exists;
 * - eliminated players are empty-handed and unprotected;
 * - the current actor of an active round is a roster member in the turn order
 *   and not eliminated;
 * - DRAW_REQUIRED without a pending interaction: every active player holds
 *   exactly one card and the draw pile is nonempty;
 * - PLAY_REQUIRED without a pending interaction: the current actor holds two
 *   cards and every other active player one;
 * - an open pending interaction: phase PLAY_REQUIRED, the pending actor is the
 *   current player holding one card (as is every other active player), and the
 *   stage-specific structure is valid (e.g. the PECERA_GUESS target is an
 *   active roster member);
 * - ROUND_END: winners are nonempty, distinct, roster members that are still
 *   active, and no pending interaction remains open.
 *
 * Match checks: 2–6 unique players, nonnegative integer victory tokens, and
 * status/winners compatibility — winners are declared only at MATCH_END, where
 * they must be distinct roster members holding at least the victory threshold.
 */
import { createDeck } from './cards';
import { victoryThresholdFor } from './match-rules';
import type { CardInstance, MatchState, PlayerState, RoundState } from './models';

/** Stable violation codes for round-state invariant checks (engine spec §20). */
export type RoundInvariantCode =
  | 'CARD_CONSERVATION'
  | 'REY_GATO_UNIQUENESS'
  | 'ELIMINATED_PLAYER_STATE'
  | 'CURRENT_ACTOR_STATE'
  | 'PHASE_STRUCTURE'
  | 'PENDING_STRUCTURE'
  | 'ROUND_END_STRUCTURE'
  | 'STATE_SHAPE';

/** Stable violation codes for match-state invariant checks (rules §3, §11). */
export type MatchInvariantCode = 'MATCH_ROSTER' | 'MATCH_TOKENS' | 'MATCH_STATUS' | 'MATCH_WINNERS';

export type InvariantCode = RoundInvariantCode | MatchInvariantCode;

/** One detected invariant violation: a stable code plus a human-readable detail. */
export interface InvariantViolation {
  readonly code: InvariantCode;
  readonly detail: string;
}

/**
 * Typed error raised by the `assert*Invariants` helpers, aggregating every
 * violation of the inspected state in one place.
 */
export class InvariantViolationError extends Error {
  readonly violations: readonly InvariantViolation[];

  constructor(violations: readonly InvariantViolation[], message?: string) {
    super(
      message ??
        `State invariant violations (${violations.length}): ${violations
          .map((violation) => `${violation.code}: ${violation.detail}`)
          .join('; ')}`,
    );
    this.name = 'InvariantViolationError';
    this.violations = violations;
    // Keep `instanceof` reliable when TypeScript downlevels the class.
    Object.setPrototypeOf(this, InvariantViolationError.prototype);
  }
}

type ViolationSink = (code: InvariantCode, detail: string) => void;

const ROUND_STATUSES: readonly string[] = ['ROUND_ACTIVE', 'ROUND_END'];
const MATCH_STATUSES: readonly string[] = ['LOBBY', 'ROUND_END', 'MATCH_END'];
const PENDING_TYPES: readonly string[] = [
  'PECERA_TARGET',
  'PECERA_GUESS',
  'RATON_INSERT_POSITION',
  'SAQUEADOG_SWAP',
];

/**
 * Every invariant violation of the given round state, one entry per detected
 * problem. The input state is never mutated, and a corrupted (out-of-contract)
 * state yields violations instead of an exception wherever detectable.
 */
export function findRoundInvariantViolations(round: RoundState): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const add: ViolationSink = (code, detail) => violations.push({ code, detail });

  if (!isUsableRoundShape(round)) {
    add('STATE_SHAPE', 'round state is not a usable canonical shape');
    return violations;
  }
  if (!ROUND_STATUSES.includes(round.status)) {
    add('STATE_SHAPE', `unknown round status ${JSON.stringify(round.status)}`);
    return violations;
  }

  checkCardConservation(round, add);
  checkEliminatedPlayers(round, add);
  if (round.status === 'ROUND_ACTIVE') {
    checkActiveRoundStructure(round, add);
  } else {
    checkRoundEndStructure(round, add);
  }
  return violations;
}

/** Throws `InvariantViolationError` aggregating every round invariant violation. */
export function assertRoundInvariants(round: RoundState): void {
  const violations = findRoundInvariantViolations(round);
  if (violations.length > 0) {
    throw new InvariantViolationError(violations);
  }
}

/**
 * Every invariant violation of the given match state, one entry per detected
 * problem. The input state is never mutated.
 */
export function findMatchInvariantViolations(match: MatchState): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const add: ViolationSink = (code, detail) => violations.push({ code, detail });

  if (!isUsableMatchShape(match)) {
    add('MATCH_ROSTER', 'match state is not a usable canonical shape');
    return violations;
  }
  if (match.players.length < 2 || match.players.length > 6) {
    add('MATCH_ROSTER', `a match requires 2 to 6 players, found ${match.players.length}`);
  }
  const seenPlayerIds = new Set<unknown>();
  for (const player of match.players) {
    if (seenPlayerIds.has(player?.id)) {
      add('MATCH_ROSTER', `player id ${String(player?.id)} is duplicated`);
    }
    seenPlayerIds.add(player?.id);
    const tokens = player?.victoryTokens;
    if (!Number.isInteger(tokens) || (tokens as number) < 0) {
      add(
        'MATCH_TOKENS',
        `player ${String(player?.id)} carries invalid victory tokens ${String(tokens)}`,
      );
    }
  }
  if (!MATCH_STATUSES.includes(match.status)) {
    add('MATCH_STATUS', `unknown match status ${JSON.stringify(match.status)}`);
    return violations;
  }

  if (match.status === 'MATCH_END') {
    checkMatchEndWinners(match, add);
  } else if (match.winners.length > 0) {
    add('MATCH_WINNERS', `match winners must stay empty while the match is ${match.status}`);
  }
  return violations;
}

/** Throws `InvariantViolationError` aggregating every match invariant violation. */
export function assertMatchInvariants(match: MatchState): void {
  const violations = findMatchInvariantViolations(match);
  if (violations.length > 0) {
    throw new InvariantViolationError(violations);
  }
}

/**
 * Card conservation (spec §20): every canonical deck instance exists exactly
 * once across hands, public discards, the draw pile, the hidden card, and the
 * detached Ratón pending card, and each instance still matches its catalog
 * definition. The Ratón pending card is counted so conservation stays explicit
 * while the inspection is paused.
 */
function checkCardConservation(round: RoundState, add: ViolationSink): void {
  const canonical = new Map(createDeck().map((card) => [card.instanceId, card]));
  const seen = new Map<string, string>();
  let reyGatoCount = 0;

  for (const { location, card } of roundCardLocations(round)) {
    if (!isWellFormedCard(card)) {
      add('CARD_CONSERVATION', `${location} holds a malformed card entry`);
      continue;
    }
    const firstLocation = seen.get(card.instanceId);
    if (firstLocation !== undefined) {
      add(
        'CARD_CONSERVATION',
        `card instance ${card.instanceId} appears at both ${firstLocation} and ${location}`,
      );
    } else {
      seen.set(card.instanceId, location);
    }
    const canonicalCard = canonical.get(card.instanceId);
    if (canonicalCard === undefined) {
      add('CARD_CONSERVATION', `${location} holds unknown card instance ${card.instanceId}`);
    } else if (canonicalCard.value !== card.value || canonicalCard.type !== card.type) {
      add(
        'CARD_CONSERVATION',
        `card instance ${card.instanceId} at ${location} carries value ${card.value} of type ${card.type}, but the catalog defines value ${canonicalCard.value} of type ${canonicalCard.type}`,
      );
    }
    if (card.type === 'REY_GATO') {
      reyGatoCount += 1;
    }
  }

  for (const instanceId of canonical.keys()) {
    if (!seen.has(instanceId)) {
      add(
        'CARD_CONSERVATION',
        `canonical card instance ${instanceId} is missing from the round state`,
      );
    }
  }
  if (reyGatoCount !== 1) {
    add('REY_GATO_UNIQUENESS', `exactly one Rey Gato instance must exist, found ${reyGatoCount}`);
  }
}

/** Every card location of a round state, labeled for violation details. */
function roundCardLocations(round: RoundState): Array<{ location: string; card: unknown }> {
  const locations: Array<{ location: string; card: unknown }> = [];
  round.players.forEach((player, playerIndex) => {
    const label = typeof player?.id === 'string' ? player.id : `players[${playerIndex}]`;
    (player?.hand ?? []).forEach((card, index) =>
      locations.push({ location: `hand:${label}[${index}]`, card }),
    );
    (player?.discards ?? []).forEach((entry, index) =>
      locations.push({ location: `discards:${label}[${index}]`, card: entry?.card }),
    );
  });
  round.drawPile.forEach((card, index) => locations.push({ location: `drawPile[${index}]`, card }));
  locations.push({ location: 'hiddenCard', card: round.hiddenCard });
  if (
    typeof round.pendingInteraction === 'object' &&
    round.pendingInteraction !== null &&
    (round.pendingInteraction as { type?: unknown }).type === 'RATON_INSERT_POSITION'
  ) {
    locations.push({
      location: 'pendingInteraction.card',
      card: (round.pendingInteraction as { card: unknown }).card,
    });
  }
  return locations;
}

/** Eliminated players are empty-handed and unprotected (spec §20). */
function checkEliminatedPlayers(round: RoundState, add: ViolationSink): void {
  for (const player of round.players) {
    if (!player?.eliminated) {
      continue;
    }
    const handCount = handCountOf(player);
    if (handCount > 0) {
      add(
        'ELIMINATED_PLAYER_STATE',
        `eliminated player ${String(player.id)} still holds ${handCount} hand card(s)`,
      );
    }
    if (player.protected) {
      add('ELIMINATED_PLAYER_STATE', `eliminated player ${String(player.id)} is still protected`);
    }
  }
}

/** Structure of a ROUND_ACTIVE round: current actor, phase, and pending state. */
function checkActiveRoundStructure(round: RoundState, add: ViolationSink): void {
  const actor = round.players.find((player) => player?.id === round.currentPlayerId);
  if (actor === undefined) {
    add(
      'CURRENT_ACTOR_STATE',
      `current player ${String(round.currentPlayerId)} is not in the roster`,
    );
  } else if (actor.eliminated) {
    add('CURRENT_ACTOR_STATE', `current player ${String(round.currentPlayerId)} is eliminated`);
  }
  if (!round.turnOrder.includes(round.currentPlayerId)) {
    add(
      'CURRENT_ACTOR_STATE',
      `current player ${String(round.currentPlayerId)} is not in the turn order`,
    );
  }

  const pending = round.pendingInteraction;
  if (
    pending !== null &&
    (typeof pending !== 'object' || !PENDING_TYPES.includes((pending as { type: string }).type))
  ) {
    add('STATE_SHAPE', `unknown pending interaction ${JSON.stringify(round.pendingInteraction)}`);
    return;
  }

  const activePlayers = round.players.filter((player) => !player?.eliminated);

  if (pending !== null) {
    checkPendingStructure(round, pending, activePlayers, add);
    return;
  }

  if (round.phase === 'DRAW_REQUIRED') {
    for (const player of activePlayers) {
      const count = handCountOf(player);
      if (count !== 1) {
        add(
          'PHASE_STRUCTURE',
          `active player ${String(player.id)} must hold exactly 1 hand card in DRAW_REQUIRED, holds ${count}`,
        );
      }
    }
    if (round.drawPile.length === 0) {
      add('PHASE_STRUCTURE', 'DRAW_REQUIRED requires a nonempty draw pile');
    }
    return;
  }
  if (round.phase === 'PLAY_REQUIRED') {
    if (actor !== undefined) {
      const count = handCountOf(actor);
      if (count !== 2) {
        add(
          'PHASE_STRUCTURE',
          `the current player ${String(actor.id)} must hold exactly 2 hand cards in PLAY_REQUIRED, holds ${count}`,
        );
      }
    }
    for (const player of activePlayers) {
      if (player.id === round.currentPlayerId) {
        continue;
      }
      const count = handCountOf(player);
      if (count !== 1) {
        add(
          'PHASE_STRUCTURE',
          `active player ${String(player.id)} must hold exactly 1 hand card in PLAY_REQUIRED, holds ${count}`,
        );
      }
    }
    return;
  }
  add('STATE_SHAPE', `unknown turn phase ${JSON.stringify(round.phase)}`);
}

/**
 * Pending-interaction transitional structure (spec §6, §20): the turn stays
 * paused on the pending actor, who is the current player in PLAY_REQUIRED
 * holding exactly one card like every other active player, and the stage
 * carries a valid structure.
 */
function checkPendingStructure(
  round: RoundState,
  pending: RoundState['pendingInteraction'] & object,
  activePlayers: PlayerState[],
  add: ViolationSink,
): void {
  const pendingType = (pending as { type: string }).type;
  if (round.phase !== 'PLAY_REQUIRED') {
    add(
      'PENDING_STRUCTURE',
      `an open ${pendingType} interaction requires phase PLAY_REQUIRED, got ${round.phase}`,
    );
  }
  if ((pending as { actorId?: unknown }).actorId !== round.currentPlayerId) {
    add(
      'PENDING_STRUCTURE',
      `the ${pendingType} interaction belongs to ${String((pending as { actorId?: unknown }).actorId)} but the current player is ${String(round.currentPlayerId)}`,
    );
  }
  const pendingActorId = (pending as { actorId?: unknown }).actorId;
  const pendingActor = round.players.find((player) => player?.id === pendingActorId);
  if (pendingActor === undefined) {
    add('PENDING_STRUCTURE', `pending actor ${String(pendingActorId)} is not in the roster`);
  } else if (pendingActor.eliminated) {
    add('PENDING_STRUCTURE', `pending actor ${String(pendingActorId)} is eliminated`);
  }
  for (const player of activePlayers) {
    const count = handCountOf(player);
    if (count !== 1) {
      add(
        'PENDING_STRUCTURE',
        `active player ${String(player.id)} must hold exactly 1 hand card while a ${pendingType} interaction is open, holds ${count}`,
      );
    }
  }
  if (pendingType === 'PECERA_GUESS') {
    const targetId = (pending as { targetId?: unknown }).targetId;
    const target = round.players.find((player) => player?.id === targetId);
    if (target === undefined) {
      add('PENDING_STRUCTURE', `PECERA_GUESS target ${String(targetId)} is not in the roster`);
    } else if (target.eliminated) {
      add('PENDING_STRUCTURE', `PECERA_GUESS target ${String(targetId)} is eliminated`);
    }
  }
}

/** ROUND_END structure: winners and terminal pending state (spec §11, §20). */
function checkRoundEndStructure(round: RoundState, add: ViolationSink): void {
  const rosterIds = new Set(round.players.map((player) => player?.id));
  const seenWinners = new Set<string>();
  if (round.winners.length === 0) {
    add('ROUND_END_STRUCTURE', 'an ended round must declare at least one winner');
  }
  for (const winnerId of round.winners) {
    if (seenWinners.has(winnerId)) {
      add('ROUND_END_STRUCTURE', `round winner ${String(winnerId)} is duplicated`);
    }
    seenWinners.add(winnerId);
    if (!rosterIds.has(winnerId)) {
      add('ROUND_END_STRUCTURE', `round winner ${String(winnerId)} is not in the roster`);
      continue;
    }
    const winner = round.players.find((player) => player?.id === winnerId);
    if (winner?.eliminated) {
      add('ROUND_END_STRUCTURE', `round winner ${String(winnerId)} is eliminated`);
    }
  }
  if (round.pendingInteraction !== null) {
    add('ROUND_END_STRUCTURE', 'an ended round must not carry an open pending interaction');
  }
}

/**
 * MATCH_END winners: nonempty, distinct, roster members at the threshold, and
 * complete — every roster member holding at least the victory threshold must
 * be declared, so a shared victory can never omit a qualifying co-winner
 * (rules §3, §11).
 */
function checkMatchEndWinners(match: MatchState, add: ViolationSink): void {
  if (match.winners.length === 0) {
    add('MATCH_WINNERS', 'a match in MATCH_END must declare at least one winner');
  }
  const threshold = victoryThresholdFor(match.players.length);
  const seenWinners = new Set<string>();
  for (const winnerId of match.winners) {
    if (seenWinners.has(winnerId)) {
      add('MATCH_WINNERS', `match winner ${String(winnerId)} is duplicated`);
    }
    seenWinners.add(winnerId);
    const winner = match.players.find((player) => player?.id === winnerId);
    if (winner === undefined) {
      add('MATCH_WINNERS', `match winner ${String(winnerId)} is not in the roster`);
      continue;
    }
    if (winner.victoryTokens < threshold) {
      add(
        'MATCH_WINNERS',
        `match winner ${String(winnerId)} holds ${winner.victoryTokens} victory tokens, below the threshold of ${threshold}`,
      );
    }
  }
  for (const player of match.players) {
    if (player.victoryTokens >= threshold && !seenWinners.has(player.id)) {
      add(
        'MATCH_WINNERS',
        `player ${String(player.id)} holds ${player.victoryTokens} victory tokens, at or above the threshold of ${threshold}, but is omitted from match.winners`,
      );
    }
  }
}

function isUsableRoundShape(round: RoundState): boolean {
  return (
    typeof round === 'object' &&
    round !== null &&
    Array.isArray(round.players) &&
    Array.isArray(round.turnOrder) &&
    Array.isArray(round.drawPile) &&
    Array.isArray(round.winners)
  );
}

function isUsableMatchShape(match: MatchState): boolean {
  return (
    typeof match === 'object' &&
    match !== null &&
    Array.isArray(match.players) &&
    Array.isArray(match.winners)
  );
}

function isWellFormedCard(card: unknown): card is CardInstance {
  return (
    typeof card === 'object' &&
    card !== null &&
    typeof (card as CardInstance).instanceId === 'string' &&
    (card as CardInstance).instanceId.length > 0 &&
    typeof (card as CardInstance).value === 'number' &&
    typeof (card as CardInstance).type === 'string'
  );
}

function handCountOf(player: PlayerState): number {
  return Array.isArray(player?.hand) ? player.hand.length : 0;
}
