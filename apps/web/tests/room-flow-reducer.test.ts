/**
 * Room-flow reducer contract (Milestone 7 vertical slice).
 *
 * The reducer is pure framework-free state: React renders it, the controller
 * feeds it, and it never makes game-rule decisions (the server does).
 */
import {
  createInitialRoomFlowState,
  roomFlowReducer,
  type MembershipResult,
  type RoomFlowAction,
} from '@/lib/room-flow/reducer';
import type { RoomPlayerView, RoomSnapshot } from '@power-hungry-pets/protocol';

function player(overrides: Partial<RoomPlayerView> & { playerId: string }): RoomPlayerView {
  return {
    displayName: overrides.playerId,
    seatNumber: 1,
    connected: true,
    isHost: false,
    joinedAt: 1,
    ...overrides,
  };
}

function room(players: RoomPlayerView[], overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const host = players.find((p) => p.isHost) ?? players[0];
  return {
    roomId: 'room-1',
    code: 'ABC12',
    status: 'LOBBY',
    hostPlayerId: host.playerId,
    createdAt: 1,
    players,
    ...overrides,
  };
}

const HOST = { playerId: 'p-host', displayName: 'Ana', isHost: true, seatNumber: 1 };

function createdMembership(roomValue: RoomSnapshot, seatIndex = 0): MembershipResult {
  return {
    roomId: roomValue.roomId,
    code: roomValue.code,
    playerId: roomValue.players[seatIndex].playerId,
    seatNumber: roomValue.players[seatIndex].seatNumber,
    room: roomValue,
  };
}

describe('room-flow reducer', () => {
  it('starts idle with no room, no seat, and no notices', () => {
    const state = createInitialRoomFlowState();
    expect(state.connection).toBe('idle');
    expect(state.room).toBeNull();
    expect(state.roomCode).toBeNull();
    expect(state.self).toBeNull();
    expect(state.busy).toBeNull();
    expect(state.error).toBeNull();
    expect(state.pendingAttempt).toBeNull();
    expect(state.notices).toEqual([]);
  });

  it('confirms a created room textually and records the host seat', () => {
    const state = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'membership/created',
      membership: createdMembership(room([{ ...player(HOST) }])),
    });
    expect(state.room).not.toBeNull();
    expect(state.roomCode).toBe('ABC12');
    expect(state.self).toEqual({ playerId: 'p-host', seatNumber: 1 });
    expect(state.busy).toBeNull();
    expect(state.pendingAttempt).toBeNull();
    expect(state.notices.map((n) => n.text)).toEqual(['Room ABC12 is pinned. You host seat 1.']);
    expect(state.notices[0].tone).toBe('success');
  });

  it('confirms a joined room textually', () => {
    const joined = room([
      player(HOST),
      player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
    ]);
    const state = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'membership/joined',
      membership: createdMembership(joined, 1),
      rejoined: false,
    });
    expect(state.self).toEqual({ playerId: 'p-2', seatNumber: 2 });
    expect(state.notices.map((n) => n.text)).toEqual(['You joined room ABC12 (seat 2).']);
  });

  it('confirms a restored seat differently from a fresh join', () => {
    const joined = room([
      player(HOST),
      player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
    ]);
    const state = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'membership/joined',
      membership: createdMembership(joined, 1),
      rejoined: true,
    });
    expect(state.notices.map((n) => n.text)).toEqual(['Back in room ABC12 (seat 2).']);
  });

  describe('room:updated lobby notices', () => {
    const first = room([player(HOST)]);
    const withRoom = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'membership/created',
      membership: createdMembership(first),
    });

    it('announces a newly arrived player', () => {
      const next = room([
        player(HOST),
        player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
      ]);
      const state = roomFlowReducer(withRoom, { type: 'room/updated', room: next });
      expect(state.notices.at(-1)?.text).toBe('Bruno arrived (seat 2).');
    });

    it('announces away and back transport changes', () => {
      const away = room([{ ...player(HOST), connected: false }]);
      const awayState = roomFlowReducer(withRoom, { type: 'room/updated', room: away });
      expect(awayState.notices.at(-1)?.text).toBe('Ana stepped away.');
      const back = roomFlowReducer(awayState, {
        type: 'room/updated',
        room: room([player(HOST)]),
      });
      expect(back.notices.at(-1)?.text).toBe('Ana is back.');
    });

    it('announces a host transfer', () => {
      const two = roomFlowReducer(withRoom, {
        type: 'room/updated',
        room: room([
          player(HOST),
          player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
        ]),
      });
      const state = roomFlowReducer(two, {
        type: 'room/updated',
        room: room([
          { ...player(HOST), isHost: false },
          { playerId: 'p-2', displayName: 'Bruno', seatNumber: 2, isHost: true, joinedAt: 1 },
        ]),
      });
      expect(state.notices.at(-1)?.text).toBe('Bruno now hosts the room.');
    });

    it('announces a leaving player', () => {
      const two = roomFlowReducer(withRoom, {
        type: 'room/updated',
        room: room([
          player(HOST),
          player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
        ]),
      });
      const after = roomFlowReducer(two, {
        type: 'room/updated',
        room: room([player(HOST)]),
      });
      expect(after.notices.at(-1)?.text).toBe('Bruno left the room.');
    });

    it('announces the match start on the status transition', () => {
      const state = roomFlowReducer(withRoom, {
        type: 'room/updated',
        room: room([player(HOST)], { status: 'IN_MATCH' }),
      });
      expect(state.notices.at(-1)?.text).toBe('The match has started.');
    });

    it('stays quiet when the snapshot has no visible change', () => {
      const before = withRoom.notices.length;
      const state = roomFlowReducer(withRoom, { type: 'room/updated', room: first });
      expect(state.notices).toHaveLength(before);
    });

    it('never carries reconnect token material in any state it produces', () => {
      const state = roomFlowReducer(withRoom, {
        type: 'room/updated',
        room: room([
          player(HOST),
          player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
        ]),
      });
      expect(JSON.stringify(state)).not.toMatch(/reconnectToken|reconnect-token/i);
    });
  });

  it('surfaces a failed ack as a typed error plus an error notice', () => {
    const state = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'ack/failed',
      attempt: { action: 'join', code: 'ZZZZZ', displayName: 'Bruno' },
      code: 'ROOM_FULL',
      message: 'room ABC12 is full',
    });
    expect(state.error).toEqual({
      action: 'join',
      code: 'ROOM_FULL',
      message: 'room ABC12 is full',
      sentence: expect.stringContaining('6 players'),
      recovery: 'edit-input',
    });
    expect(state.notices.at(-1)?.tone).toBe('error');
    expect(state.pendingAttempt).toEqual({
      action: 'join',
      code: 'ZZZZZ',
      displayName: 'Bruno',
    });
    expect(state.busy).toBeNull();
  });

  it('marks busy while an action is in flight and clears it after', () => {
    const busy = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'busy/started',
      action: 'create',
    });
    expect(busy.busy).toBe('create');
    const cleared = roomFlowReducer(busy, { type: 'busy/cleared' });
    expect(cleared.busy).toBeNull();
  });

  it('clears an error on demand while keeping the pending attempt', () => {
    const failed = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'ack/failed',
      attempt: { action: 'create' },
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });
    const cleared = roomFlowReducer(failed, { type: 'error/cleared' });
    expect(cleared.error).toBeNull();
    expect(cleared.pendingAttempt).toEqual({ action: 'create' });
  });

  it('announces disconnection but keeps the seat and room', () => {
    const seated = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'membership/created',
      membership: createdMembership(room([player(HOST)])),
    });
    const state = roomFlowReducer(seated, {
      type: 'connection/status',
      status: 'disconnected',
    });
    expect(state.connection).toBe('disconnected');
    expect(state.room).not.toBeNull();
    expect(state.self).not.toBeNull();
    expect(state.notices.at(-1)?.tone).toBe('error');
    expect(state.notices.at(-1)?.text).toContain('Connection lost');
  });

  it('announces the transport coming back online', () => {
    const down = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'connection/status',
      status: 'disconnected',
    });
    const state = roomFlowReducer(down, { type: 'connection/status', status: 'connected' });
    expect(state.connection).toBe('connected');
    expect(state.notices.at(-1)?.text).toContain('Connected');
    expect(state.notices.at(-1)?.tone).toBe('success');
  });

  it('clears the seat on an acknowledged leave', () => {
    const seated = roomFlowReducer(createInitialRoomFlowState(), {
      type: 'membership/created',
      membership: createdMembership(room([player(HOST)])),
    });
    const state = roomFlowReducer(seated, { type: 'room/left', room: null });
    expect(state.room).toBeNull();
    expect(state.roomCode).toBeNull();
    expect(state.self).toBeNull();
    expect(state.notices.at(-1)?.text).toContain('You left room ABC12');
  });

  it('never reuses a notice id', () => {
    let state = createInitialRoomFlowState();
    const actions: RoomFlowAction[] = [
      { type: 'membership/created', membership: createdMembership(room([player(HOST)])) },
      {
        type: 'room/updated',
        room: room([
          player(HOST),
          player({ playerId: 'p-2', displayName: 'Bruno', seatNumber: 2 }),
        ]),
      },
      { type: 'room/updated', room: room([player(HOST)]) },
    ];
    for (const action of actions) {
      state = roomFlowReducer(state, action);
    }
    const ids = state.notices.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('stale-state clearing', () => {
  const seated = roomFlowReducer(createInitialRoomFlowState(), {
    type: 'membership/created',
    membership: createdMembership(room([player(HOST)])),
  });
  const failed = roomFlowReducer(seated, {
    type: 'ack/failed',
    attempt: { action: 'start' },
    code: 'NOT_HOST',
    message: 'nope',
  });

  it('room/switched clears the previous room, seat, and notices', () => {
    const switched = roomFlowReducer(failed, { type: 'room/switched' });
    expect(switched.room).toBeNull();
    expect(switched.roomCode).toBeNull();
    expect(switched.self).toBeNull();
    expect(switched.busy).toBeNull();
    expect(switched.error).toBeNull();
    expect(switched.pendingAttempt).toBeNull();
    expect(switched.notices).toEqual([]);
  });

  it('seat/invalidated clears the stale room and seat state', () => {
    const invalidated = roomFlowReducer(failed, { type: 'seat/invalidated' });
    expect(invalidated.room).toBeNull();
    expect(invalidated.roomCode).toBeNull();
    expect(invalidated.self).toBeNull();
    expect(invalidated.busy).toBeNull();
    expect(invalidated.error).toBeNull();
    expect(invalidated.pendingAttempt).toBeNull();
    expect(invalidated.notices).toEqual([]);
  });

  it('keeps the notice counter monotonic across clearing', () => {
    const cleared = roomFlowReducer(failed, { type: 'room/switched' });
    const state = roomFlowReducer(cleared, {
      type: 'membership/joined',
      membership: createdMembership(room([player(HOST)])),
      rejoined: false,
    });
    for (const notice of state.notices) {
      expect(notice.id).toBeGreaterThanOrEqual(failed.nextNoticeId);
    }
  });
});
