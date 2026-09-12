/**
 * Centralized round rules: elimination and round-end detection
 * (spec §§7,11,17; rules §§6,8,9).
 *
 * All public helpers are pure: transitions are applied to a cloned state and
 * the input `RoundState` is never mutated.
 */
import type { CardInstance, PlayerId, PlayerState, RoundState } from './models';

export type PlayerEliminatedEvent = { type: 'PLAYER_ELIMINATED'; playerId: PlayerId };
export type RoundEndedEvent = { type: 'ROUND_ENDED'; winnerIds: PlayerId[] };
/** One publicly revealed survivor hand (playerId + card); rules §9 makes it public. */
export type RevealedHand = { playerId: PlayerId; card: CardInstance };
/**
 * Milestone 4 exhaustion reveal (rules §9; resolved user decision): emitted
 * when the draw pile runs out with 2+ active players. Carries every survivor's
 * single hand card simultaneously; the reveal moves no cards and always
 * precedes ROUND_ENDED.
 */
export type HandsRevealedEvent = { type: 'HANDS_REVEALED'; hands: RevealedHand[] };
export type ProtectionExpiredEvent = { type: 'PROTECTION_EXPIRED'; playerId: PlayerId };
export type PlayerProtectedEvent = { type: 'PLAYER_PROTECTED'; playerId: PlayerId };
export type HandSwappedEvent = { type: 'HANDS_SWAPPED'; playerIds: [PlayerId, PlayerId] };
export type HandRedealtEvent = { type: 'HANDS_REDEALT'; playerIds: PlayerId[] };
export type CardForcedFaceUpEvent = {
  type: 'CARD_FORCED_FACE_UP';
  playerId: PlayerId;
  card: CardInstance;
};
export type CardDrawnEvent = { type: 'CARD_DRAWN'; playerId: PlayerId };
export type RoundRulesEvent =
  | PlayerEliminatedEvent
  | RoundEndedEvent
  | HandsRevealedEvent
  | ProtectionExpiredEvent
  | PlayerProtectedEvent
  | HandSwappedEvent
  | HandRedealtEvent
  | CardForcedFaceUpEvent
  | CardDrawnEvent;

export type EliminationErrorCode = 'PLAYER_NOT_FOUND' | 'ROUND_ALREADY_ENDED';

export type EliminatePlayerResult =
  | { ok: true; state: RoundState; events: RoundRulesEvent[] }
  | { ok: false; error: EliminationErrorCode; state: RoundState };

export type RoundEndCheck = {
  state: RoundState;
  ended: boolean;
  events: RoundRulesEvent[];
};

/**
 * Seam for the Rey Gato intrinsic (catalog §10: Rey Gato face up in front of
 * its holder eliminates that holder). Invoked only when an elimination reveal
 * exposes Rey Gato; Milestone 3 resolution: the holder is already eliminated
 * and the card is already face up in their public discard area, so the
 * canonical reveal-path intrinsic is a deliberate no-op — it must never
 * dispatch printed actions or re-enter elimination (rules §6.3; test plan §16).
 * Voluntary and forced public plays instead go through the card-effect
 * dispatch in `card-effects.ts`.
 */
export interface ReyGatoEliminationContext {
  state: RoundState;
  eliminatedPlayerId: PlayerId;
  revealedCards: CardInstance[];
  events: RoundRulesEvent[];
}

export type ReyGatoEliminationIntrinsic = (context: ReyGatoEliminationContext) => void;

const noOpReyGatoIntrinsic: ReyGatoEliminationIntrinsic = () => {};

export function eliminatePlayer(
  round: RoundState,
  playerId: PlayerId,
  reyGatoIntrinsic: ReyGatoEliminationIntrinsic = noOpReyGatoIntrinsic,
): EliminatePlayerResult {
  if (round.status !== 'ROUND_ACTIVE') {
    return { ok: false, error: 'ROUND_ALREADY_ENDED', state: round };
  }
  const target = playerById(round, playerId);
  if (!target) {
    return { ok: false, error: 'PLAYER_NOT_FOUND', state: round };
  }
  if (target.eliminated) {
    // Idempotent: an already eliminated player reveals nothing new.
    return { ok: true, state: cloneRoundState(round), events: [] };
  }

  const state = cloneRoundState(round);
  const eliminated = playerById(state, playerId) as PlayerState;
  eliminated.eliminated = true;
  // Invariant: protection belongs only to an active player. Elimination is
  // the last possible turn boundary for this player, so drop the flag here.
  eliminated.protected = false;
  const revealedCards = eliminated.hand.map((card) => ({ ...card }));
  for (const card of revealedCards) {
    eliminated.discards.push({ card, origin: 'ELIMINATION_REVEAL' });
  }
  eliminated.hand = [];

  const events: RoundRulesEvent[] = [{ type: 'PLAYER_ELIMINATED', playerId }];
  if (revealedCards.some((card) => card.type === 'REY_GATO')) {
    reyGatoIntrinsic({ state, eliminatedPlayerId: playerId, revealedCards, events });
  }

  const end = applyRoundEnd(state);
  if (!end.ended && playerId === round.currentPlayerId) {
    // The eliminated player owned the turn: hand it to the next active player
    // so the round never deadlocks on an eliminated current actor (spec §§10,17).
    events.push(...advanceTurn(state));
  }
  return { ok: true, state, events: [...events, ...end.events] };
}

/**
 * Canonical protection helper (spec §16): one rule for whether a hand may be
 * targeted by another player's card action. Only an active, unprotected player
 * other than the actor qualifies; self, eliminated, protected, and unknown
 * targets are all false. Card handlers must not reimplement these semantics.
 */
export function canTargetHand(state: RoundState, actorId: PlayerId, targetId: PlayerId): boolean {
  if (actorId === targetId) {
    return false;
  }
  // The actor must exist and be active; an eliminated or unknown actor can
  // never issue a hand-targeting action.
  const actor = playerById(state, actorId);
  if (!actor || actor.eliminated) {
    return false;
  }
  const target = playerById(state, targetId);
  return Boolean(target && !target.eliminated && !target.protected);
}

/**
 * Centralized target classifier (spec §16, §21): one rule for classifying a
 * proposed hand target. `TARGET_PROTECTED` is reported distinctly from
 * `ILLEGAL_TARGET` so callers can emit precise typed errors, while legality
 * itself stays owned by the canonical `canTargetHand` seam — the classifier
 * adds classification semantics, never a second copy of protection logic.
 * Self, eliminated, and unknown targets are illegal; only an active,
 * unprotected other player is a legal hand target.
 */
export type HandTargetDecision = 'LEGAL_TARGET' | 'TARGET_PROTECTED' | 'ILLEGAL_TARGET';

export function classifyHandTarget(
  state: RoundState,
  actorId: PlayerId,
  targetId: PlayerId,
): HandTargetDecision {
  if (actorId === targetId) {
    return 'ILLEGAL_TARGET';
  }
  const target = playerById(state, targetId);
  if (!target || target.eliminated) {
    return 'ILLEGAL_TARGET';
  }
  if (target.protected) {
    return 'TARGET_PROTECTED';
  }
  // Final gate through the canonical boolean seam so the two never diverge
  // (this also rejects an eliminated or unknown actor).
  return canTargetHand(state, actorId, targetId) ? 'LEGAL_TARGET' : 'ILLEGAL_TARGET';
}

/**
 * Canonical zero-legal-target check (no-legal-target rule): whether any legal
 * hand target for the actor exists at all. A target-bearing card mandatorily
 * played while this is false is discarded normally and its printed effect does
 * nothing; self-targeting remains illegal and an explicit targetId is still
 * validated exactly as before. Single-source seam for current and future
 * target-bearing cards (Cards 3/8 today, 1/5 later); card validation must not
 * reimplement these semantics.
 */
export function hasLegalHandTarget(state: RoundState, actorId: PlayerId): boolean {
  return state.players.some((candidate) => canTargetHand(state, actorId, candidate.id));
}

export function checkRoundEnd(round: RoundState): RoundEndCheck {
  const state = cloneRoundState(round);
  const { ended, events } = applyRoundEnd(state);
  return { state, ended, events };
}

/**
 * Pure end-of-round winner resolver (spec §12; rules §§8,9,10; catalog §0).
 * Reads the pre-reveal state only — never mutates it — so the reveal that
 * callers emit around it moves no cards and the discard tie-break totals are
 * inherently pre-reveal.
 *
 * Algorithm (resolved user decision for Card 0):
 * 1. One active player: immediate sole survivor (rules §8); no comparison.
 * 2. Otherwise every pair of survivors is compared directly. Normal
 *    comparison: higher card value wins the pair; equal values award nobody.
 *    Special 0-vs-10 direct matchup (catalog §0): Robot beats Rey Gato, while
 *    Robot loses normally to every other higher card and Rey beats every
 *    non-Robot. Direct pairwise wins are counted; candidates with the maximal
 *    count continue.
 * 3. Tied candidates break the tie by the highest sum of their own face-up
 *    discard card values (rules §10); an exact remaining tie yields multiple
 *    round winners.
 */
export function resolveRoundWinners(round: RoundState): PlayerId[] {
  const activePlayers = round.players.filter((player) => !player.eliminated);
  if (activePlayers.length <= 1) {
    return activePlayers.map((player) => player.id);
  }
  const wins = new Map<PlayerId, number>();
  const discardTotals = new Map<PlayerId, number>();
  for (const player of activePlayers) {
    wins.set(player.id, 0);
    discardTotals.set(
      player.id,
      player.discards.reduce((sum, entry) => sum + entry.card.value, 0),
    );
  }
  for (let i = 0; i < activePlayers.length; i += 1) {
    for (let j = i + 1; j < activePlayers.length; j += 1) {
      const a = activePlayers[i] as PlayerState;
      const b = activePlayers[j] as PlayerState;
      const aCard = a.hand[0];
      const bCard = b.hand[0];
      if (!aCard || !bCard) {
        // Defensive: valid engine states hold exactly one hand card per active
        // player at exhaustion; a cardless survivor cannot win a pair.
        continue;
      }
      const pairWinner = directPairWinner(aCard, bCard);
      if (pairWinner === 'a') {
        wins.set(a.id, (wins.get(a.id) ?? 0) + 1);
      } else if (pairWinner === 'b') {
        wins.set(b.id, (wins.get(b.id) ?? 0) + 1);
      }
    }
  }
  const maxWins = Math.max(...activePlayers.map((player) => wins.get(player.id) ?? 0));
  let candidates = activePlayers.filter((player) => (wins.get(player.id) ?? 0) === maxWins);
  if (candidates.length > 1) {
    const maxTotal = Math.max(...candidates.map((player) => discardTotals.get(player.id) ?? 0));
    candidates = candidates.filter((player) => (discardTotals.get(player.id) ?? 0) === maxTotal);
  }
  return candidates.map((player) => player.id);
}

/**
 * One direct pair comparison of the Robot/Rey special relationship and the
 * normal value order (catalog §0). `null` means equal values: nobody wins the
 * pair and nobody scores a point.
 */
function directPairWinner(a: CardInstance, b: CardInstance): 'a' | 'b' | null {
  if (a.type === 'ROBOT_ASPIRADOR_REAL' && b.type === 'REY_GATO') {
    return 'a';
  }
  if (b.type === 'ROBOT_ASPIRADOR_REAL' && a.type === 'REY_GATO') {
    return 'b';
  }
  if (a.value > b.value) {
    return 'a';
  }
  if (b.value > a.value) {
    return 'b';
  }
  return null;
}

/**
 * Centralized round-end decision (spec §11; rules §§8,9). Mutates the given
 * state, so callers must pass a private clone. The last-survivor check takes
 * precedence over draw-pile exhaustion: a sole survivor wins immediately with
 * no hand reveal, while exhaustion with 2+ active players reveals every
 * survivor's hand (HANDS_REVEALED, always before ROUND_ENDED) and resolves
 * the winners through the pure M4 winner resolver (rules §9, §10; catalog §0).
 */
function applyRoundEnd(state: RoundState): { ended: boolean; events: RoundRulesEvent[] } {
  if (state.status !== 'ROUND_ACTIVE') {
    return { ended: false, events: [] };
  }
  const activePlayers = state.players.filter((player) => !player.eliminated);
  let winners: PlayerId[] | null = null;
  const events: RoundRulesEvent[] = [];
  if (activePlayers.length === 1) {
    winners = [activePlayers[0]!.id];
  } else if (state.drawPile.length === 0 && activePlayers.length >= 2) {
    // Milestone 4 exhaustion resolution (rules §9; resolved user decision):
    // publicly and simultaneously reveal every survivor's single hand, then
    // resolve the winners through the pure resolver. The reveal moves no
    // cards: hands stay in place and the discard tie-break stays pre-reveal.
    events.push({
      type: 'HANDS_REVEALED',
      hands: activePlayers
        .filter((player) => player.hand.length > 0)
        .map((player) => ({
          playerId: player.id,
          card: { ...player.hand[0]! },
        })),
    });
    winners = resolveRoundWinners(state);
  }
  if (winners === null) {
    return { ended: false, events: [] };
  }
  state.status = 'ROUND_END';
  state.winners = winners;
  state.phase = 'DRAW_REQUIRED';
  events.push({ type: 'ROUND_ENDED', winnerIds: winners });
  return { ended: true, events };
}

/**
 * Advances the turn to the next active player, wrapping and skipping
 * eliminated players, and applies begin-turn timing (spec §10): resets the
 * phase to DRAW_REQUIRED and expires the new actor's protection. Mutates the
 * given private-clone state. Shared by elimination and the turn engine so
 * the turn-order algorithm exists exactly once.
 */
export function advanceTurn(state: RoundState): ProtectionExpiredEvent[] {
  const order = state.turnOrder;
  const startIndex = order.indexOf(state.currentPlayerId);
  for (let step = 1; step <= order.length; step += 1) {
    const candidateId = order[(startIndex + step) % order.length];
    const candidate = playerById(state, candidateId);
    if (candidate && !candidate.eliminated) {
      state.currentPlayerId = candidateId;
      state.phase = 'DRAW_REQUIRED';
      if (candidate.protected) {
        candidate.protected = false;
        return [{ type: 'PROTECTION_EXPIRED', playerId: candidateId }];
      }
      return [];
    }
  }
  return [];
}

/** Shared internal helpers used by round-rules and turn-engine. */
export function playerById(round: RoundState, id: PlayerId): PlayerState | undefined {
  return round.players.find((candidate) => candidate.id === id);
}

/** Deep clone so applied transitions never alias an input state. */
export function cloneRoundState(round: RoundState): RoundState {
  return {
    ...round,
    players: round.players.map((player) => ({
      ...player,
      hand: player.hand.map((card) => ({ ...card })),
      discards: player.discards.map((entry) => ({
        card: { ...entry.card },
        origin: entry.origin,
      })),
    })),
    turnOrder: [...round.turnOrder],
    drawPile: round.drawPile.map((card) => ({ ...card })),
    hiddenCard: { ...round.hiddenCard },
    // Pending interactions are plain data; cloning them keeps result states
    // from aliasing the input state's pending object (spec §8 purity). The
    // Ratón pending carries the detached inspected card, so it is cloned
    // card-and-all to keep the detached card private on every clone.
    pendingInteraction:
      round.pendingInteraction === null
        ? null
        : round.pendingInteraction.type === 'RATON_INSERT_POSITION'
          ? {
              ...round.pendingInteraction,
              card: { ...round.pendingInteraction.card },
            }
          : { ...round.pendingInteraction },
  };
}
