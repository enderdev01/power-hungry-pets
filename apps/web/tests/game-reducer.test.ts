/**
 * Game-flow reducer contract: pure, framework-free state for the M7 game-table
 * slice. Server projections are the only truth — the reducer stores them, keeps
 * a bounded animation-only event feed, and clears everything on room switch,
 * seat invalidation, and leave. It never computes rules and never invents state.
 */
import { createInitialGameState, gameReducer, GAME_EVENT_LOG_LIMIT } from '@/lib/game/game-reducer';
import { createInitialRoomFlowState, roomFlowReducer } from '@/lib/room-flow/reducer';
import { privateView, publicView, roomSnapshotInMatch } from './helpers/game-views';

const aPublicView = publicView();
const aPrivateView = privateView();

describe('game reducer', () => {
  it('starts truthful: no projections, no match end, empty event feed', () => {
    const state = createInitialGameState();
    expect(state.publicView).toBeNull();
    expect(state.privateView).toBeNull();
    expect(state.matchEnded).toBe(false);
    expect(state.matchWinners).toEqual([]);
    expect(state.recentEvents).toEqual([]);
  });

  it('stores an authoritative public view unchanged', () => {
    const next = gameReducer(createInitialGameState(), {
      type: 'game/public-state',
      publicView: aPublicView,
    });
    expect(next.publicView).toBe(aPublicView);
    expect(next.privateView).toBeNull();
  });

  it('stores the viewer-private view unchanged', () => {
    const next = gameReducer(createInitialGameState(), {
      type: 'game/private-state',
      privateView: aPrivateView,
    });
    expect(next.privateView).toBe(aPrivateView);
  });

  it('keeps the event feed bounded for animation only', () => {
    let state = createInitialGameState();
    for (let i = 0; i < GAME_EVENT_LOG_LIMIT + 5; i += 1) {
      state = gameReducer(state, {
        type: 'game/events',
        events: [{ type: 'CARD_DRAWN', playerId: `p-${i}` }],
      });
    }
    expect(state.recentEvents).toHaveLength(GAME_EVENT_LOG_LIMIT);
    expect(state.recentEvents.at(-1)).toEqual({ type: 'CARD_DRAWN', playerId: 'p-24' });
  });

  it('records a match end without touching the projections', () => {
    const withViews = gameReducer(createInitialGameState(), {
      type: 'game/public-state',
      publicView: aPublicView,
    });
    const ended = gameReducer(withViews, {
      type: 'game/match-ended',
      winners: ['p-self'],
    });
    expect(ended.matchEnded).toBe(true);
    expect(ended.matchWinners).toEqual(['p-self']);
    expect(ended.publicView).toBe(aPublicView);
  });

  it('cleared state is truthful from zero again', () => {
    let state = gameReducer(createInitialGameState(), {
      type: 'game/public-state',
      publicView: aPublicView,
    });
    state = gameReducer(state, {
      type: 'game/private-state',
      privateView: aPrivateView,
    });
    state = gameReducer(state, { type: 'game/match-ended', winners: ['p-other'] });
    state = gameReducer(state, { type: 'game/cleared' });
    expect(state).toEqual(createInitialGameState());
  });
});

describe('room-flow reducer hosts the game slice', () => {
  it('starts with an awaiting-projections game state', () => {
    const state = createInitialRoomFlowState();
    expect(state.game).toEqual(createInitialGameState());
  });

  it('forwards game projections into its game slice', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, { type: 'game/private-state', privateView: aPrivateView });
    expect(state.game.publicView).toBe(aPublicView);
    expect(state.game.privateView).toBe(aPrivateView);
    expect(state.room).toBeNull();
  });

  it('clears all game state when the room is switched', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, {
      type: 'membership/joined',
      membership: {
        roomId: 'room-1',
        code: 'ABC12',
        playerId: 'p-self',
        seatNumber: 1,
        room: roomSnapshotInMatch(),
      },
      rejoined: false,
    });
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, { type: 'game/private-state', privateView: aPrivateView });

    state = roomFlowReducer(state, { type: 'room/switched' });
    expect(state.game).toEqual(createInitialGameState());
    expect(state.room).toBeNull();
  });

  it('clears all game state when the seat is invalidated', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, { type: 'game/private-state', privateView: aPrivateView });

    state = roomFlowReducer(state, { type: 'seat/invalidated' });
    expect(state.game).toEqual(createInitialGameState());
  });

  it('clears all game state when the seat leaves', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, { type: 'game/private-state', privateView: aPrivateView });

    state = roomFlowReducer(state, { type: 'room/left', room: null });
    expect(state.game).toEqual(createInitialGameState());
  });

  it('resets the game slice whenever new membership is established', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, {
      type: 'membership/created',
      membership: {
        roomId: 'room-2',
        code: 'DEF34',
        playerId: 'p-self',
        seatNumber: 1,
        room: roomSnapshotInMatch(),
      },
    });
    expect(state.game).toEqual(createInitialGameState());
  });

  it('preserves the latest authoritative game state during a seat rebind', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, { type: 'game/private-state', privateView: aPrivateView });
    state = roomFlowReducer(state, {
      type: 'membership/joined',
      membership: {
        roomId: 'room-1',
        code: 'ABC12',
        playerId: 'p-self',
        seatNumber: 1,
        room: roomSnapshotInMatch(),
      },
      rejoined: true,
    });
    expect(state.game.publicView).toBe(aPublicView);
    expect(state.game.privateView).toBe(aPrivateView);
  });

  it('stores a match end inside the room-flow game slice', () => {
    let state = createInitialRoomFlowState();
    state = roomFlowReducer(state, { type: 'game/public-state', publicView: aPublicView });
    state = roomFlowReducer(state, { type: 'game/match-ended', winners: ['p-other'] });
    expect(state.game.matchEnded).toBe(true);
    expect(state.game.matchWinners).toEqual(['p-other']);
    expect(state.room).toBeNull();
  });
});
