/**
 * Test fixtures for the M7 game-table slice: well-formed client-safe game
 * projection samples shaped exactly like the shipped gateway payloads
 * (docs/05_MULTIPLAYER_ARCHITECTURE.md §8, engine spec §14).
 */
import type {
  CardType,
  PrivateGameView,
  PublicCard,
  PublicGameView,
  PublicPlayerView,
  PublicRoundView,
  RoomSnapshot,
  TurnCommand,
} from '@power-hungry-pets/protocol';

export const SELF_ID = 'p-self';
export const OTHER_ID = 'p-other';
export const THIRD_ID = 'p-third';

/** One public card. */
export function card(value: number, type: CardType): PublicCard {
  return { value, type };
}

/** Minimal room snapshot at IN_MATCH with two seats. */
export function roomSnapshotInMatch(): RoomSnapshot {
  return {
    roomId: 'room-1',
    code: 'ABC12',
    status: 'IN_MATCH',
    hostPlayerId: SELF_ID,
    createdAt: 1,
    players: [
      {
        playerId: SELF_ID,
        displayName: 'Ana',
        seatNumber: 1,
        connected: true,
        isHost: true,
        joinedAt: 1,
      },
      {
        playerId: OTHER_ID,
        displayName: 'Bruno',
        seatNumber: 2,
        connected: true,
        isHost: false,
        joinedAt: 2,
      },
    ],
  };
}

/** Default public round view: Ana's turn, mid-play, healthy piles. */
export function roundView(overrides: Partial<PublicRoundView> = {}): PublicRoundView {
  return {
    status: 'ROUND_ACTIVE',
    phase: 'PLAY_REQUIRED',
    currentPlayerId: OTHER_ID,
    turnOrder: [SELF_ID, OTHER_ID],
    roundNumber: 1,
    drawPileCount: 18,
    hiddenCardCount: 1,
    pendingInteraction: null,
    winners: [],
    revealedHands: null,
    ...overrides,
  };
}

/** Two-seat public game view. Players carry only counts and public discards. */
export function publicView(
  overrides: {
    round?: PublicRoundView | null;
    players?: PublicPlayerView[];
  } = {},
): PublicGameView {
  const players: PublicPlayerView[] = overrides.players ?? [
    {
      id: SELF_ID,
      name: 'Ana',
      connected: true,
      eliminated: false,
      protected: false,
      victoryTokens: 1,
      handCount: 1,
      discards: [],
    },
    {
      id: OTHER_ID,
      name: 'Bruno',
      connected: true,
      eliminated: false,
      protected: true,
      victoryTokens: 0,
      handCount: 2,
      discards: [{ card: card(10, 'REY_GATO'), origin: 'PLAYED' }],
    },
  ];
  return {
    match: {
      matchId: 'match-1',
      status: 'LOBBY',
      roundNumber: 1,
      winners: [],
    },
    players,
    round: overrides.round !== undefined ? overrides.round : roundView(),
  };
}

/** Private view for one viewer; the hand carries viewer-owned identities only. */
export function privateView(
  viewerId: string = SELF_ID,
  hand: Array<{ instanceId: string; value: number; type: CardType }> = [
    { instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' },
  ],
  legalActions: TurnCommand[] = [],
  publicViewOverride?: PublicGameView,
): PrivateGameView {
  return {
    viewerId,
    publicView: publicViewOverride ?? publicView(),
    hand,
    legalActions,
    pendingDecision: null,
  };
}

/**
 * Private view carrying a viewer-matching pending decision (WU8): the shape
 * the server sends only to the pending actor's own seat.
 */
export function privateViewWithPending(
  viewerId: string,
  pendingDecision: PrivateGameView['pendingDecision'],
  legalActions: TurnCommand[],
  hand: Array<{ instanceId: string; value: number; type: CardType }> = [],
  publicViewOverride?: PublicGameView,
): PrivateGameView {
  return {
    ...privateView(viewerId, hand, legalActions, publicViewOverride),
    pendingDecision,
  };
}

/**
 * Terminal public view (WU10): the shape the server publishes once a match is
 * over — the round is detached and the match roster carries the final victory
 * tokens alongside the authoritative MATCH_END winners.
 */
export function matchEndPublicView(
  matchOverrides: Partial<PublicGameView['match']> = {},
  playerOverrides: {
    selfTokens?: number;
    otherTokens?: number;
  } = {},
): PublicGameView {
  const [ana, bruno] = publicView().players;
  return {
    match: {
      matchId: 'match-1',
      status: 'MATCH_END',
      roundNumber: 4,
      winners: [SELF_ID],
      ...matchOverrides,
    },
    players: [
      { ...ana!, victoryTokens: playerOverrides.selfTokens ?? 3, handCount: 0 },
      { ...bruno!, victoryTokens: playerOverrides.otherTokens ?? 1, handCount: 0 },
    ],
    round: null,
  };
}
