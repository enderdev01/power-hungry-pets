import type { PublicGameView, PublicPlayerView } from '@power-hungry-pets/protocol';
import { nextPileOrder, pileCards, pileTilt, seatSlots } from '@/lib/game/table-layout';
import { announcementForBatch } from '@/lib/game/table-announcement';

function player(id: string, discards: PublicPlayerView['discards'] = []): PublicPlayerView {
  return {
    id,
    name: id.toUpperCase(),
    connected: true,
    eliminated: false,
    protected: false,
    victoryTokens: 0,
    handCount: 1,
    discards,
  };
}

function view(players: PublicPlayerView[]): PublicGameView {
  return {
    match: { matchId: 'm', status: 'LOBBY', roundNumber: 1, winners: [] },
    players,
    round: {
      status: 'ROUND_ACTIVE',
      phase: 'PLAY_REQUIRED',
      currentPlayerId: players[0]!.id,
      turnOrder: players.map((p) => p.id),
      roundNumber: 1,
      drawPileCount: 10,
      hiddenCardCount: 1,
      pendingInteraction: null,
      winners: [],
      revealedHands: null,
    },
  };
}

const KING = { card: { value: 10, type: 'REY_GATO' as const }, origin: 'PLAYED' as const };
const FISH = { card: { value: 1, type: 'PECERA_DE_CRISTAL' as const }, origin: 'PLAYED' as const };

describe('shared discard pile order', () => {
  it('puts newly arrived discards on top and keeps earlier order', () => {
    let order = nextPileOrder([], view([player('a', [FISH]), player('b')]));
    expect(order).toEqual(['a#0']);
    order = nextPileOrder(order, view([player('a', [FISH]), player('b', [KING])]));
    expect(order).toEqual(['a#0', 'b#0']);
    const cards = pileCards(order, view([player('a', [FISH]), player('b', [KING])]));
    expect(cards.map((c) => c.discard.card.type)).toEqual(['PECERA_DE_CRISTAL', 'REY_GATO']);
  });

  it('puts a forced face-up card above the Serpiente that forced it', () => {
    const snake = {
      card: { value: 5, type: 'SERPIENTE_ENCANTADORA' as const },
      origin: 'PLAYED' as const,
    };
    const forced = {
      card: { value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' as const },
      origin: 'FORCED_PLAY' as const,
    };
    const before = view([player('a', [FISH]), player('b')]);
    const order = nextPileOrder(
      nextPileOrder([], before),
      view([player('a', [FISH, snake]), player('b', [forced])]),
    );
    expect(order).toEqual(['a#0', 'a#1', 'b#0']);
  });

  it('returns the same array when nothing changed and resets for a new round', () => {
    const v = view([player('a', [FISH])]);
    const order = nextPileOrder([], v);
    expect(nextPileOrder(order, v)).toBe(order);
    expect(nextPileOrder(order, view([player('a')]))).toEqual([]);
  });

  it('tilts deterministically within a gentle range', () => {
    expect(pileTilt('a#0')).toEqual(pileTilt('a#0'));
    expect(Math.abs(pileTilt('b#3').rotate)).toBeLessThanOrEqual(12);
  });
});

describe('seat slots', () => {
  it('seats the viewer at the bottom and opponents clockwise around the table', () => {
    const v = view([player('a'), player('b'), player('c'), player('d')]);
    expect(seatSlots(v, 'b')).toEqual({ b: 'bottom', c: 'left', d: 'top', a: 'right' });
  });
});

describe('challenge announcements', () => {
  const v = view([player('a'), player('b')]);

  it('announces a missed Pecera guess as a sad failure without any value', () => {
    const result = announcementForBatch(
      [{ kind: 'pecera-resolved', actorId: 'a', targetId: 'b', correct: false }],
      v,
      'a',
    );
    expect(result).toEqual({
      tone: 'fail',
      title: '¡Fallido!',
      detail: 'No adivinaste la carta de B.',
    });
  });

  it('announces a lost duel, a won duel, and a duel without victims', () => {
    const played = {
      kind: 'card-played' as const,
      playerId: 'a',
      card: { value: 3, type: 'CONEJITO_GUERRILLERO' as const },
    };
    expect(
      announcementForBatch([played, { kind: 'player-eliminated', playerId: 'a' }], v, 'b')?.title,
    ).toBe('¡Duelo perdido!');
    expect(
      announcementForBatch([played, { kind: 'player-eliminated', playerId: 'b' }], v, 'b')?.tone,
    ).toBe('fail');
    expect(announcementForBatch([played], v, 'b')?.detail).toBe('Nadie quedó eliminado.');
  });

  it('stays silent for batches without a challenge outcome', () => {
    expect(announcementForBatch([{ kind: 'card-drawn', playerId: 'a' }], v, 'a')).toBeNull();
  });
});
