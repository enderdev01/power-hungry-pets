/**
 * Client-safe game projection contracts (M7 game-table slice).
 *
 * These mirrors describe exactly what the server gateway broadcasts for a live
 * match: the public game view, one viewer's private view, sanitized public
 * events, and the four game broadcast payloads. They are structural mirrors of
 * the server's engine projections — `apps/server/src/gateway/contracts.ts`
 * carries compile-time drift witnesses asserting the server types stay equal
 * to these client-safe shapes.
 *
 * Privacy contract (multiplayer spec §§6, 11-13): public players carry counts
 * and public discards only — never a `hand` identity field. Private views are
 * addressed to a single viewer and carry only that viewer's own hand and legal
 * actions. No instance identity beyond the viewer's own hand is ever exposed.
 */

// -- Card identity ---------------------------------------------------------------

/** Canonical card types, values 0-10; mirrored from the engine catalog. */
export type CardType =
  | 'ROBOT_ASPIRADOR_REAL'
  | 'PECERA_DE_CRISTAL'
  | 'RATON_TRAMPERO'
  | 'CONEJITO_GUERRILLERO'
  | 'CAPARAZON_ARMAZON'
  | 'SERPIENTE_ENCANTADORA'
  | 'SAQUEADOG_DE_TUMBAS'
  | 'MALABARISTA_DE_OCHO_PATAS'
  | 'ERMITANO_BUSCA_CASA'
  | 'NO_SOY_UNA_MASCOTA'
  | 'REY_GATO';

/** One card with its runtime instance identity (viewer-owned hand only). */
export interface GameCardInstance {
  instanceId: string;
  value: number;
  type: CardType;
}

/** A public card: printed value and type only, never the instance identity. */
export interface PublicCard {
  value: number;
  type: CardType;
}

/** One public discard entry: the public card and why it became public. */
export interface PublicDiscardView {
  card: PublicCard;
  origin: 'PLAYED' | 'FORCED_PLAY' | 'ELIMINATION_REVEAL';
}

// -- Player commands (canonical engine TurnCommand mirror) ------------------------

/**
 * The exact canonical turn command set a private view's `legalActions` may
 * carry. Plain serializable data; legality is decided by the server only.
 */
export type TurnCommand =
  | { type: 'DRAW_CARD'; actorId: string }
  | { type: 'PLAY_CARD'; actorId: string; cardInstanceId: string; targetId?: string }
  | { type: 'CHOOSE_TARGET'; actorId: string; targetId: string }
  | { type: 'SUBMIT_GUESS'; actorId: string; value: number }
  | { type: 'CHOOSE_HIDDEN_SWAP'; actorId: string; swap: boolean }
  | { type: 'CHOOSE_DECK_POSITION'; actorId: string; index: number };

// -- Public game view ---------------------------------------------------------

/** The open pending interaction as publicly observable: type and actor only. */
export type PublicPendingInteraction =
  | { type: 'PECERA_TARGET'; actorId: string }
  | { type: 'PECERA_GUESS'; actorId: string; targetId: string }
  | { type: 'RATON_INSERT_POSITION'; actorId: string }
  | { type: 'SAQUEADOG_SWAP'; actorId: string };

/** One survivor hand exposed by the exhaustion reveal: value/type only. */
export interface PublicRevealedHand {
  playerId: string;
  card: PublicCard;
}

/** The live round as the public sees it: structure and counts, no identities. */
export interface PublicRoundView {
  status: 'ROUND_ACTIVE' | 'ROUND_END';
  phase: 'DRAW_REQUIRED' | 'PLAY_REQUIRED';
  currentPlayerId: string;
  turnOrder: string[];
  roundNumber: number;
  drawPileCount: number;
  hiddenCardCount: number;
  pendingInteraction: PublicPendingInteraction | null;
  winners: string[];
  /** Survivor hands exposed only by an inferred exhaustion reveal; else `null`. */
  revealedHands: PublicRevealedHand[] | null;
}

/** One player as the public sees them: state flags and counts, no identities. */
export interface PublicPlayerView {
  id: string;
  name: string;
  connected: boolean;
  eliminated: boolean;
  protected: boolean;
  victoryTokens: number;
  handCount: number;
  discards: PublicDiscardView[];
}

/** The match frame as the public sees it: lifecycle, progress, and winners. */
export interface PublicMatchView {
  matchId: string;
  status: 'LOBBY' | 'ROUND_END' | 'MATCH_END';
  roundNumber: number;
  winners: string[];
}

/** The full public game view shared with every seated client. */
export interface PublicGameView {
  match: PublicMatchView;
  players: PublicPlayerView[];
  round: PublicRoundView | null;
}

// -- Private game view ---------------------------------------------------------

/** Private pending data, shown only while the viewer is the pending actor. */
export type PrivatePendingDecision =
  | { type: 'PECERA_TARGET'; actorId: string }
  | { type: 'PECERA_GUESS'; actorId: string; targetId: string }
  | { type: 'RATON_INSERT_POSITION'; actorId: string; card: GameCardInstance }
  | { type: 'SAQUEADOG_SWAP'; actorId: string; hiddenCard: GameCardInstance };

/**
 * The full player-private game view for exactly one viewer: the shared public
 * projection, the viewer's own hand identities, the viewer's canonical legal
 * actions, and private pending data only while the viewer is the pending actor.
 */
export interface PrivateGameView {
  viewerId: string;
  publicView: PublicGameView;
  hand: GameCardInstance[];
  legalActions: TurnCommand[];
  pendingDecision: PrivatePendingDecision | null;
}

// -- Broadcast payloads ----------------------------------------------------------

/**
 * Sanitized public event shapes, mirrored from the server's public-event
 * sanitizer: public card identities only, never commands, guesses, indexes,
 * swap choices, or hidden/detached card identity.
 */
export type GamePublicEvent =
  | { type: 'CARD_DRAWN'; playerId: string }
  | { type: 'CARD_PLAYED'; playerId: string; card: PublicCard }
  | { type: 'PECERA_GUESS_RESOLVED'; actorId: string; targetId: string; correct: boolean }
  | { type: 'DUEL_RESOLVED'; actorId: string; targetId: string; loserId: string | null }
  | { type: 'SAQUEADOG_RESOLVED'; playerId: string }
  | { type: 'RATON_RESOLVED'; playerId: string }
  | { type: 'PROTECTION_EXPIRED'; playerId: string }
  | { type: 'HANDS_SWAPPED'; playerIds: [string, string] }
  | { type: 'HANDS_REDEALT'; playerIds: string[] }
  | { type: 'CARD_FORCED_FACE_UP'; playerId: string; card: PublicCard }
  | { type: 'PLAYER_PROTECTED'; playerId: string }
  | { type: 'PLAYER_ELIMINATED'; playerId: string }
  | { type: 'HANDS_REVEALED'; hands: Array<{ playerId: string; card: PublicCard }> }
  | { type: 'ROUND_ENDED'; winnerIds: string[] }
  | { type: 'TOKEN_AWARDED'; playerId: string }
  | { type: 'MATCH_ENDED'; winnerIds: string[] };

/** `game:event` broadcast payload: sanitized public events only. */
export interface GameEventBroadcast {
  roomCode: string;
  events: GamePublicEvent[];
}

/** `game:public-state` broadcast payload: the shared public view. */
export interface GamePublicStateBroadcast {
  roomCode: string;
  publicView: PublicGameView;
}

/** `game:private-state` payload: emitted individually to one connected seat. */
export interface GamePrivateStateBroadcast {
  roomCode: string;
  playerId: string;
  privateView: PrivateGameView;
}

/** `match:ended` broadcast payload, emitted once when the match completes. */
export interface MatchEndedBroadcast {
  roomCode: string;
  winners: string[];
  /** Room snapshot at FINISHED status. */
  room: import('./room-flow').RoomSnapshot;
}
