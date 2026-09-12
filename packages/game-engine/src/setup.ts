import { createDeck } from './cards';
import { shuffleDeck } from './deck';
import type { MatchState, PlayerInput, PlayerState, RoundState } from './models';
import type { Rng } from './rng';
import { randomFirstPlayerPolicy, type FirstPlayerPolicy } from './turn-order';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

export function createMatchState({
  matchId,
  players,
}: {
  matchId: string;
  players: PlayerInput[];
}): MatchState {
  validatePlayers(players);

  return {
    matchId,
    status: 'LOBBY',
    players: players.map(createLobbyPlayer),
    roundNumber: 0,
    winners: [],
  };
}

export function setupRound(
  match: MatchState,
  rng: Rng,
  firstPlayerPolicy: FirstPlayerPolicy = randomFirstPlayerPolicy,
): RoundState {
  if (match.status === 'MATCH_END') {
    throw new Error('Cannot set up a round after the match has ended (MATCH_END)');
  }
  const shuffledDeck = shuffleDeck(createDeck(), rng);
  const players = match.players.map((player, index) =>
    createRoundPlayer(player, shuffledDeck[index]),
  );
  const hiddenCard = shuffledDeck[players.length];
  const drawPile = shuffledDeck.slice(players.length + 1);
  const turnOrder = players.map((player) => player.id);
  const currentPlayerId = firstPlayerPolicy({ match, playerIds: turnOrder, rng });

  if (!turnOrder.includes(currentPlayerId)) {
    throw new Error('First-player policy must select an active player');
  }

  return {
    matchId: match.matchId,
    status: 'ROUND_ACTIVE',
    phase: 'DRAW_REQUIRED',
    players,
    turnOrder,
    currentPlayerId,
    roundNumber: match.roundNumber + 1,
    drawPile,
    hiddenCard,
    pendingInteraction: null,
    winners: [],
  };
}

function createLobbyPlayer(player: PlayerInput): PlayerState {
  return {
    ...player,
    connected: true,
    eliminated: false,
    protected: false,
    hand: [],
    discards: [],
    victoryTokens: 0,
  };
}

function createRoundPlayer(player: PlayerState, card: RoundState['hiddenCard']): PlayerState {
  return {
    ...player,
    eliminated: false,
    protected: false,
    hand: [card],
    discards: [],
  };
}

function validatePlayers(players: readonly PlayerInput[]): void {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`A match requires ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }

  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error('Player IDs must be unique');
  }
}
