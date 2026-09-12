export type PlayerId = string;
export type CardInstanceId = string;

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

export interface CardInstance {
  instanceId: CardInstanceId;
  value: number;
  type: CardType;
}

export type TurnPhase = 'DRAW_REQUIRED' | 'PLAY_REQUIRED';

export type PublicDiscardOrigin = 'PLAYED' | 'FORCED_PLAY' | 'ELIMINATION_REVEAL';

export interface PublicDiscardEntry {
  card: CardInstance;
  origin: PublicDiscardOrigin;
}

export type PendingInteraction =
  | { type: 'PECERA_TARGET'; actorId: PlayerId }
  | { type: 'PECERA_GUESS'; actorId: PlayerId; targetId: PlayerId }
  | {
      type: 'RATON_INSERT_POSITION';
      /**
       * Card 2 Ratón Trampero: the inspected draw-pile card is detached from
       * the draw pile and kept here as a private deep clone while the turn is
       * paused (conservation stays explicit in canonical state). No public
       * event ever carries this identity or the eventual insertion index.
       */
      actorId: PlayerId;
      card: CardInstance;
    }
  | { type: 'SAQUEADOG_SWAP'; actorId: PlayerId };

export interface PlayerInput {
  id: PlayerId;
  name: string;
}

export interface PlayerState extends PlayerInput {
  connected: boolean;
  eliminated: boolean;
  protected: boolean;
  hand: CardInstance[];
  discards: PublicDiscardEntry[];
  victoryTokens: number;
}

export interface MatchState {
  matchId: string;
  /**
   * Match lifecycle (spec §3): LOBBY before the first round, ROUND_END between
   * rounds, and MATCH_END once every qualifying player has crossed the victory
   * threshold (rules §11). `winners` carries the match winners at MATCH_END and
   * stays empty otherwise; round winners live on the ended RoundState.
   */
  status: 'LOBBY' | 'ROUND_END' | 'MATCH_END';
  players: PlayerState[];
  roundNumber: number;
  winners: PlayerId[];
}

export interface RoundState {
  matchId: string;
  status: 'ROUND_ACTIVE' | 'ROUND_END';
  players: PlayerState[];
  turnOrder: PlayerId[];
  currentPlayerId: PlayerId;
  roundNumber: number;
  drawPile: CardInstance[];
  hiddenCard: CardInstance;
  phase: TurnPhase;
  pendingInteraction: PendingInteraction | null;
  winners: PlayerId[];
}
