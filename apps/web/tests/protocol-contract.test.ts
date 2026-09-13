/**
 * Client-safe protocol seam contract: the event names and lobby constants
 * exposed by packages/protocol must match the shipped Socket.IO gateway
 * contract exactly (docs/05_MULTIPLAYER_ARCHITECTURE.md §8).
 */
import {
  ClientEvents,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SEATS_PER_ROOM,
  MIN_SEATS_TO_START_MATCH,
  RoomStatus,
  ROOM_CODE_LENGTH,
  ServerEvents,
} from '@power-hungry-pets/protocol';

describe('protocol seam', () => {
  it('exposes the exact client event names', () => {
    expect(ClientEvents.systemPing).toBe('system:ping');
    expect(ClientEvents.roomCreate).toBe('room:create');
    expect(ClientEvents.roomJoin).toBe('room:join');
    expect(ClientEvents.roomLeave).toBe('room:leave');
    expect(ClientEvents.roomStart).toBe('room:start');
    expect(ClientEvents.gameCommand).toBe('game:command');
  });

  it('exposes the exact server event names', () => {
    expect(ServerEvents.systemNotice).toBe('system:notice');
    expect(ServerEvents.roomUpdated).toBe('room:updated');
    expect(ServerEvents.gameEvent).toBe('game:event');
    expect(ServerEvents.gamePublicState).toBe('game:public-state');
    expect(ServerEvents.gamePrivateState).toBe('game:private-state');
    expect(ServerEvents.matchEnded).toBe('match:ended');
  });

  it('mirrors the published room-flow limits', () => {
    expect(MAX_SEATS_PER_ROOM).toBe(6);
    expect(MIN_SEATS_TO_START_MATCH).toBe(2);
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(24);
    expect(ROOM_CODE_LENGTH).toBe(5);
  });

  it('mirrors the guarded room statuses', () => {
    expect(RoomStatus).toEqual({
      Created: 'CREATED',
      Lobby: 'LOBBY',
      InMatch: 'IN_MATCH',
      Finished: 'FINISHED',
      Expired: 'EXPIRED',
    });
  });
});
