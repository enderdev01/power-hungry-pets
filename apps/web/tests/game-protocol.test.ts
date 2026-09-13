/**
 * Client-safe game projection contract: the game/event payload types exported
 * by packages/protocol must type-check against samples shaped exactly like the
 * shipped gateway broadcasts (docs/05_MULTIPLAYER_ARCHITECTURE.md §8, engine
 * spec §14). A missing or drifted type here fails compilation — the RED signal
 * for the protocol seam of the game-table slice.
 */
import type {
  GameEventBroadcast,
  GamePrivateStateBroadcast,
  GamePublicStateBroadcast,
  MatchEndedBroadcast,
  PublicGameView,
  PublicPlayerView,
  PrivateGameView,
  RoomStartData,
  RoomSnapshot,
} from '@power-hungry-pets/protocol';
import { privateView, publicView, roomSnapshotInMatch } from './helpers/game-views';

const samplePublic: PublicGameView = publicView();
const samplePrivate: PrivateGameView = privateView();
const sampleRoom: RoomSnapshot = roomSnapshotInMatch();

describe('protocol game projection seam', () => {
  it('accepts a well-formed public game view sample', () => {
    expect(samplePublic.players).toHaveLength(2);
    expect(samplePublic.round?.drawPileCount).toBe(18);
    expect(samplePublic.round?.hiddenCardCount).toBe(1);
  });

  it('accepts a well-formed private game view sample', () => {
    expect(samplePrivate.viewerId).toBe('p-self');
    expect(samplePrivate.hand).toHaveLength(1);
    expect(samplePrivate.hand[0].type).toBe('MALABARISTA_DE_OCHO_PATAS');
  });

  it('accepts the four game broadcast payload shapes', () => {
    const events: GameEventBroadcast = {
      roomCode: 'ABC12',
      events: [{ type: 'CARD_DRAWN', playerId: 'p-self' }],
    };
    const publicState: GamePublicStateBroadcast = { roomCode: 'ABC12', publicView: samplePublic };
    const privateState: GamePrivateStateBroadcast = {
      roomCode: 'ABC12',
      playerId: 'p-self',
      privateView: samplePrivate,
    };
    const matchEnded: MatchEndedBroadcast = {
      roomCode: 'ABC12',
      winners: ['p-self'],
      room: sampleRoom,
    };
    expect(events.events).toHaveLength(1);
    expect(publicState.roomCode).toBe('ABC12');
    expect(privateState.playerId).toBe('p-self');
    expect(matchEnded.winners).toEqual(['p-self']);
  });

  it('carries the initial public view in the room:start acknowledgement', () => {
    const startAck: RoomStartData = { room: sampleRoom, publicView: samplePublic };
    expect(startAck.publicView.match.matchId).toBe('match-1');
    expect(startAck.room.status).toBe('IN_MATCH');
  });

  it('keeps public players count-only: no hand identity field may exist', () => {
    // Privacy witness: a public player view carries hand counts, never hand
    // identities. If a `hand` field is ever added to the view, the suppressed
    // error disappears and this file stops compiling.
    // @ts-expect-error public player views carry hand counts, never identities
    const leakProbe: PublicPlayerView['hand'] = undefined;
    expect(leakProbe).toBeUndefined();
  });
});
