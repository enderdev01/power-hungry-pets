/**
 * Public game-state projection (Milestone 6 work unit 1; engine spec §§14, 22).
 *
 * `GameSnapshot` pairs the canonical `MatchState` with the live `RoundState`
 * (or `null` between rounds), and `getPublicGameView` projects it into a
 * `PublicGameView`: a plain, JSON-serializable view that carries everything a
 * client may see and nothing it must not.
 *
 * Privacy contract (multiplayer spec §§11, 12):
 * - Public player fields: id, name, connection, elimination, protection,
 *   victory tokens, hand count, and public discards projected as
 *   `{ value, type }` plus origin — never a `CardInstance` or `instanceId`.
 * - Public live-round fields: status, phase, current actor, turn order, draw
 *   pile and hidden card counts, the pending interaction's type and actor
 *   (plus the Pecera target id), and round winners.
 * - Never exposed: the draw order, the hidden card identity, any hidden hand
 *   identity, the detached Ratón card, the chosen Ratón insertion index, the
 *   Saqueadog hidden card or swap choice, commands, or legal actions.
 *
 * Exhaustion reveal inference (rules §9): a `ROUND_END` with two or more
 * active players and an empty draw pile is an exhaustion ending, so every
 * survivor's single hand card is public and is exposed as a value/type pair.
 * A last-survivor `ROUND_END` wins immediately with no reveal, so its hand is
 * never exposed. No other `ROUND_END` shape exposes hands.
 *
 * Purity: every projection returns fresh plain objects — no canonical input
 * object or array is aliased, and mutating either side after projection never
 * affects the other. Public cards are copied too.
 *
 * Player-private projection (Milestone 6 work unit 2; engine spec §14,
 * multiplayer spec §6): `getPlayerPrivateView` composes a fresh public
 * projection with only the viewer's authorized private data — the viewer id,
 * a deep-copied own hand, the exact canonical legal actions
 * (`getLegalActions(round, viewerId)`, empty without an active attached
 * round), and private pending data only while the viewer is the pending
 * actor. Authorization runs against the match roster and fails closed: a
 * non-roster playerId throws a typed `ProjectionError` with the stable code
 * `PLAYER_NOT_IN_GAME`, never a null or public fallback. The pending mapping
 * is exhaustive and fails closed with `UNKNOWN_PENDING_INTERACTION` for any
 * future variant it does not know how to project safely.
 */
import type {
  CardInstance,
  CardType,
  MatchState,
  PendingInteraction,
  PlayerId,
  PlayerState,
  PublicDiscardOrigin,
  RoundState,
  TurnPhase,
} from './models';
import { getLegalActions } from './legal-actions';
import type { TurnCommand } from './turn-engine';

/** Canonical input pairing: the match plus the live round, if one is attached. */
export interface GameSnapshot {
  match: MatchState;
  round: RoundState | null;
}

/** A public card: printed value and type only, never the instance identity. */
export interface PublicCard {
  value: number;
  type: CardType;
}

/** One public discard entry: the public card and why it became public. */
export interface PublicDiscardView {
  card: PublicCard;
  origin: PublicDiscardOrigin;
}

/** One player as the public sees them: state flags and counts, no identities. */
export interface PublicPlayerView {
  id: PlayerId;
  name: string;
  connected: boolean;
  eliminated: boolean;
  protected: boolean;
  victoryTokens: number;
  handCount: number;
  discards: PublicDiscardView[];
}

/**
 * The open pending interaction as publicly observable: type and actor always,
 * plus the Pecera target id where the target is itself public. The detached
 * Ratón card, its insertion index, and the Saqueadog choice are private and
 * never appear.
 */
export type PublicPendingInteraction =
  | { type: 'PECERA_TARGET'; actorId: PlayerId }
  | { type: 'PECERA_GUESS'; actorId: PlayerId; targetId: PlayerId }
  | { type: 'RATON_INSERT_POSITION'; actorId: PlayerId }
  | { type: 'SAQUEADOG_SWAP'; actorId: PlayerId };

/** One survivor hand exposed by the exhaustion reveal: value/type only. */
export interface PublicRevealedHand {
  playerId: PlayerId;
  card: PublicCard;
}

/** The live round as the public sees it: structure and counts, no identities. */
export interface PublicRoundView {
  status: RoundState['status'];
  phase: TurnPhase;
  currentPlayerId: PlayerId;
  turnOrder: PlayerId[];
  roundNumber: number;
  drawPileCount: number;
  hiddenCardCount: number;
  pendingInteraction: PublicPendingInteraction | null;
  winners: PlayerId[];
  /**
   * Survivor hands exposed only by an inferred exhaustion reveal (rules §9);
   * `null` whenever the reveal does not apply, including every
   * last-survivor `ROUND_END`.
   */
  revealedHands: PublicRevealedHand[] | null;
}

/** The match frame as the public sees it: lifecycle, progress, and winners. */
export interface PublicMatchView {
  matchId: string;
  status: MatchState['status'];
  roundNumber: number;
  winners: PlayerId[];
}

/**
 * The full public game view. `players` composes both layers while a round is
 * attached: the round's players (in round order) carry the transient fields
 * (elimination, protection, hand count, public discards), while the match
 * roster keyed by id is authoritative for identity, connectivity, and the
 * current victoryTokens; with no round attached, the match's players are
 * projected directly (lobby, between rounds, and match end, where the token
 * source of truth lives).
 */
export interface PublicGameView {
  match: PublicMatchView;
  players: PublicPlayerView[];
  round: PublicRoundView | null;
}

/**
 * Projects a canonical game snapshot into its public, serializable view.
 * Pure: reads the snapshot, returns fresh plain objects, and never mutates
 * or aliases the input.
 */
export function getPublicGameView(snapshot: GameSnapshot): PublicGameView {
  return {
    match: projectMatch(snapshot.match),
    players: projectPlayers(snapshot),
    round: snapshot.round === null ? null : projectRound(snapshot.round),
  };
}

/**
 * The base player states for this snapshot's `players` projection: the
 * round's players (in round order) while a round is attached, otherwise the
 * match's players.
 */
function livePlayers(snapshot: GameSnapshot): readonly PlayerState[] {
  return snapshot.round === null ? snapshot.match.players : snapshot.round.players;
}

function projectMatch(match: MatchState): PublicMatchView {
  return {
    matchId: match.matchId,
    status: match.status,
    roundNumber: match.roundNumber,
    winners: [...match.winners],
  };
}

function projectRound(round: RoundState): PublicRoundView {
  return {
    status: round.status,
    phase: round.phase,
    currentPlayerId: round.currentPlayerId,
    turnOrder: [...round.turnOrder],
    roundNumber: round.roundNumber,
    drawPileCount: round.drawPile.length,
    hiddenCardCount: round.hiddenCard ? 1 : 0,
    pendingInteraction:
      round.pendingInteraction === null
        ? null
        : projectPendingInteraction(round.pendingInteraction),
    winners: [...round.winners],
    revealedHands: exhaustionReveal(round),
  };
}

/**
 * Exhaustion reveal inference (rules §9): `ROUND_END` + at least two active
 * players + an empty draw pile means every survivor's single hand card is
 * public. Survivors follow the round's player order, mirroring the canonical
 * `HANDS_REVEALED` emission. Any other ended-round shape — notably a
 * last-survivor win — reveals nothing.
 */
function exhaustionReveal(round: RoundState): PublicRevealedHand[] | null {
  if (round.status !== 'ROUND_END' || round.drawPile.length !== 0) {
    return null;
  }
  const survivors = round.players.filter((player) => !player.eliminated);
  if (survivors.length < 2) {
    return null;
  }
  return survivors
    .filter((player) => player.hand.length > 0)
    .map((player) => ({
      playerId: player.id,
      card: projectCard(player.hand[0]!),
    }));
}

/** Exhaustively strips a pending interaction down to its public observables. */
function projectPendingInteraction(pending: PendingInteraction): PublicPendingInteraction {
  switch (pending.type) {
    case 'PECERA_TARGET':
      return { type: pending.type, actorId: pending.actorId };
    case 'PECERA_GUESS':
      return {
        type: pending.type,
        actorId: pending.actorId,
        targetId: pending.targetId,
      };
    case 'RATON_INSERT_POSITION':
      return { type: pending.type, actorId: pending.actorId };
    case 'SAQUEADOG_SWAP':
      return { type: pending.type, actorId: pending.actorId };
    default:
      return failUnknownPending(pending);
  }
}

/**
 * Combined-snapshot player composition: the round's players (in round order)
 * carry the round-owned transient fields — elimination, protection, hand
 * count, and public discards — while the match roster keyed by id is
 * authoritative for stable identity and connectivity (name, connected) and
 * the current victoryTokens. An attached ROUND_END therefore simultaneously
 * shows the tokens `applyRoundResult` awarded on the match and the round's
 * public discards/revealed hands, with no array-index coupling between the
 * two rosters. A round player without a match-roster counterpart (malformed
 * roster mismatch) falls back to its own round values per field; projection
 * never validates or rejects.
 */
function projectPlayers(snapshot: GameSnapshot): PublicPlayerView[] {
  const matchPlayers = new Map(snapshot.match.players.map((player) => [player.id, player]));
  return livePlayers(snapshot).map((player) => {
    const matchPlayer = matchPlayers.get(player.id);
    return {
      id: player.id,
      name: matchPlayer?.name ?? player.name,
      connected: matchPlayer?.connected ?? player.connected,
      eliminated: player.eliminated,
      protected: player.protected,
      victoryTokens: matchPlayer?.victoryTokens ?? player.victoryTokens,
      handCount: player.hand.length,
      discards: player.discards.map((entry) => ({
        card: projectCard(entry.card),
        origin: entry.origin,
      })),
    };
  });
}

/** Copies a card into its public value/type shape, dropping the instance id. */
function projectCard(card: CardInstance): PublicCard {
  return { value: card.value, type: card.type };
}

/** Stable, typed failure codes thrown by the private-view projection. */
export type ProjectionErrorCode = 'PLAYER_NOT_IN_GAME' | 'UNKNOWN_PENDING_INTERACTION';

/**
 * Typed projection failure. `code` is a stable machine-readable identifier for
 * callers; `message` is human-facing detail. Failing closed means throwing —
 * an unverifiable authorization or an unknown pending variant never yields a
 * (possibly leaking) view.
 */
export class ProjectionError extends Error {
  public readonly code: ProjectionErrorCode;

  constructor(code: ProjectionErrorCode, message: string) {
    super(message);
    this.name = 'ProjectionError';
    this.code = code;
  }
}

/**
 * The owed pending decision as the actor privately sees it. The Pecera stages
 * identify the owed decision only (the target id is already public); the Ratón
 * stage additionally carries a deep copy of the detached card, and the
 * Saqueadog stage a deep copy of the hidden card. No stage ever carries the
 * eventual insertion index, guess value, or swap choice — those exist only as
 * the stage's legal-action domain until the canonical decision resolves.
 */
export type PrivatePendingDecision =
  | { type: 'PECERA_TARGET'; actorId: PlayerId }
  | { type: 'PECERA_GUESS'; actorId: PlayerId; targetId: PlayerId }
  | { type: 'RATON_INSERT_POSITION'; actorId: PlayerId; card: CardInstance }
  | { type: 'SAQUEADOG_SWAP'; actorId: PlayerId; hiddenCard: CardInstance };

/**
 * The full player-private game view. `publicView` is a fresh composition of
 * the same public projection every observer receives; `hand` holds only the
 * viewer's own cards as deep copies; `legalActions` is the exact canonical
 * command set for the viewer (empty without an active attached round, for a
 * non-actor during a pending stage, or for an eliminated viewer); and
 * `pendingDecision` carries private pending data only while the viewer is the
 * pending actor — `null` for every other observer.
 */
export interface PrivateGameView {
  viewerId: PlayerId;
  publicView: PublicGameView;
  hand: CardInstance[];
  legalActions: TurnCommand[];
  pendingDecision: PrivatePendingDecision | null;
}

/**
 * Projects a canonical game snapshot into the private view of one rostered
 * player. Pure: reads the snapshot, returns fresh plain objects, and never
 * mutates or aliases the input.
 *
 * Fails closed with `ProjectionError` code `PLAYER_NOT_IN_GAME` when `playerId`
 * is not in the match roster (the match roster is the single authorization
 * surface — a round-side presence alone never authorizes a viewer).
 */
export function getPlayerPrivateView(snapshot: GameSnapshot, playerId: PlayerId): PrivateGameView {
  const rosterPlayer = snapshot.match.players.find((player) => player.id === playerId);
  if (!rosterPlayer) {
    throw new ProjectionError(
      'PLAYER_NOT_IN_GAME',
      `Player "${playerId}" is not in this game's roster; no private view exists.`,
    );
  }

  const round = snapshot.round;
  const livePlayer =
    round === null ? undefined : round.players.find((player) => player.id === playerId);

  return {
    viewerId: playerId,
    publicView: getPublicGameView(snapshot),
    // The live round owns the transient hand while attached; without a round
    // the roster's (empty) hand is the truth. A rostered viewer missing from a
    // malformed round roster holds no live cards.
    hand: (livePlayer ?? rosterPlayer).hand.map(deepCopyCard),
    legalActions: round === null ? [] : getLegalActions(round, playerId),
    pendingDecision: round === null ? null : projectPrivatePending(round, playerId),
  };
}

/**
 * Exhaustive, fail-closed private pending projection: only the pending actor
 * receives a payload, and an unknown future variant throws instead of silently
 * projecting an unsafe shape.
 */
function projectPrivatePending(
  round: RoundState,
  viewerId: PlayerId,
): PrivatePendingDecision | null {
  const pending = round.pendingInteraction;
  if (pending === null || pending.actorId !== viewerId) {
    return null;
  }
  switch (pending.type) {
    case 'PECERA_TARGET':
      return { type: pending.type, actorId: pending.actorId };
    case 'PECERA_GUESS':
      return {
        type: pending.type,
        actorId: pending.actorId,
        targetId: pending.targetId,
      };
    case 'RATON_INSERT_POSITION':
      return {
        type: pending.type,
        actorId: pending.actorId,
        card: deepCopyCard(pending.card),
      };
    case 'SAQUEADOG_SWAP':
      return {
        type: pending.type,
        actorId: pending.actorId,
        hiddenCard: deepCopyCard(round.hiddenCard),
      };
    default:
      return failUnknownPending(pending);
  }
}

/**
 * Fail-closed guard: an unknown pending variant can never be projected. Shared
 * by the public and private pending projections so both fail closed
 * symmetrically with the same typed `ProjectionError` code.
 */
function failUnknownPending(pending: never): never {
  const type = String((pending as { type?: unknown }).type);
  throw new ProjectionError(
    'UNKNOWN_PENDING_INTERACTION',
    `Pending interaction type "${type}" has no known projection; refusing to project.`,
  );
}

/** Deep copy of a flat card instance: fresh object, same identity fields. */
function deepCopyCard(card: CardInstance): CardInstance {
  return { instanceId: card.instanceId, value: card.value, type: card.type };
}
