import { createHash } from 'node:crypto';
import { RoomError, RoomErrorCode } from '../src/room/room.errors';
import { RoomRegistry } from '../src/room/room.registry';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SEATS_PER_ROOM,
  RoomStatus,
  type RoomSnapshot,
} from '../src/room/room.types';

/** Crockford base32 uppercase: digits 0-9 plus A-Z minus I, L, O, U (32 symbols). */
const ROOM_CODE_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

function expectRoomError(code: RoomErrorCode, run: () => unknown): RoomError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    const roomError = error as RoomError;
    expect(roomError.code).toBe(code);
    return roomError;
  }
  throw new Error(`expected RoomError with code ${code}, but nothing was thrown`);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function seatNumbers(room: RoomSnapshot): number[] {
  return room.players.map((player) => player.seatNumber);
}

describe('RoomRegistry — creation', () => {
  it('creates a room whose creator is the connected host seat with a stable crypto-random playerId', () => {
    const registry = new RoomRegistry();
    const result = registry.createRoom({ displayName: ' Host ', socketId: 'socket-creator' });

    expect(result.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(result.playerId).not.toBe('socket-creator');
    expect(result.playerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const room = registry.getRoom(result.code);
    expect(room).toBeDefined();
    expect(room?.code).toMatch(ROOM_CODE_PATTERN);
    expect(room?.status).toBe(RoomStatus.Created);
    expect(room?.hostPlayerId).toBe(result.playerId);
    expect(room?.players).toHaveLength(1);
    expect(room?.players[0]).toEqual({
      playerId: result.playerId,
      displayName: 'Host',
      seatNumber: 1,
      connected: true,
      isHost: true,
      joinedAt: expect.any(Number),
    });
  });

  it('generates codes from the unambiguous uppercase alphabet', () => {
    const registry = new RoomRegistry();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const room = registry.createRoom({
        displayName: `p${i}`,
        socketId: `socket-${i}`,
      });
      expect(room.code).toMatch(ROOM_CODE_PATTERN);
      seen.add(room.code);
    }
    expect(seen.size).toBe(25);
  });

  it('retries code collisions and uses the first free code', () => {
    const codes = ['AAAAA', 'AAAAA', 'BBBBB'];
    const registry = new RoomRegistry({
      generateRoomCode: () => codes.shift() ?? 'CCCCC',
    });

    const first = registry.createRoom({ displayName: 'a', socketId: 'socket-a' });
    expect(first.code).toBe('AAAAA');

    const second = registry.createRoom({ displayName: 'b', socketId: 'socket-b' });
    expect(second.code).toBe('BBBBB');
  });

  it('fails bounded code generation with a stable error and creates nothing', () => {
    const registry = new RoomRegistry({
      generateRoomCode: () => 'ZZZZZ',
    });

    registry.createRoom({ displayName: 'a', socketId: 'socket-a' });
    expectRoomError(RoomErrorCode.RoomCodeGenerationFailed, () =>
      registry.createRoom({ displayName: 'b', socketId: 'socket-b' }),
    );

    const rooms = registry.listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]?.code).toBe('ZZZZZ');
    expect(rooms[0]?.players.map((p) => p.displayName)).toEqual(['a']);
  });

  it('rejects injected codes with invalid symbols or wrong length and creates nothing', () => {
    const bad = ['OOOOO', 'ABCDE!', 'ABCD'];
    const registry = new RoomRegistry({ generateRoomCode: () => bad.shift() ?? 'VALID' });

    expectRoomError(RoomErrorCode.RoomCodeGenerationFailed, () =>
      registry.createRoom({ displayName: 'a', socketId: 'socket-a' }),
    );
    expect(registry.listRooms()).toHaveLength(0);
  });

  it('normalizes injected codes with trim and uppercase before validation', () => {
    const registry = new RoomRegistry({ generateRoomCode: () => ' ab2zw ' });

    const room = registry.createRoom({ displayName: 'a', socketId: 'socket-a' });
    expect(room.code).toBe('AB2ZW');
  });
});

describe('RoomRegistry — joining', () => {
  function createRoomWithJoiners(joinerCount: number) {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const joiners = [];
    for (let i = 1; i <= joinerCount; i += 1) {
      joiners.push(
        registry.joinRoom({
          code: creator.code,
          displayName: `player-${i}`,
          socketId: `socket-${i}`,
        }),
      );
    }
    return { registry, creator, joiners };
  }

  it('joins by code with a unique playerId independent of socket ids and issues a token', () => {
    const { registry, creator, joiners } = createRoomWithJoiners(2);

    const room = registry.getRoom(creator.code);
    expect(room?.players.map((player) => player.playerId)).not.toContain(creator.code);
    const ids = room?.players.map((player) => player.playerId) ?? [];
    expect(new Set(ids).size).toBe(3);
    for (const joiner of joiners) {
      expect(joiner.playerId).toMatch(/^[0-9a-f-]{36}$/);
      expect(joiner.reconnectToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(joiner.playerId).not.toHaveLength(0);
    }
    expect(seatNumbers(room as RoomSnapshot)).toEqual([1, 2, 3]);
  });

  it('normalizes display names by trimming and collapsing whitespace', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({
      code: creator.code,
      displayName: '  Ana   María\t\nSuárez  ',
      socketId: 'socket-1',
    });

    const room = registry.getRoom(creator.code);
    expect(room?.players[1]?.displayName).toBe('Ana María Suárez');
  });

  it('rejects blank and oversized display names', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });

    expectRoomError(RoomErrorCode.InvalidDisplayName, () =>
      registry.joinRoom({ code: creator.code, displayName: '   ', socketId: 'socket-1' }),
    );
    expectRoomError(RoomErrorCode.InvalidDisplayName, () =>
      registry.joinRoom({
        code: creator.code,
        displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1),
        socketId: 'socket-1',
      }),
    );
    expectRoomError(RoomErrorCode.InvalidDisplayName, () =>
      registry.createRoom({ displayName: '', socketId: 'socket-other' }),
    );

    // At the exact limit the name is accepted.
    const creator2 = registry.createRoom({
      displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH),
      socketId: 'socket-c2',
    });
    expect(registry.getRoom(creator2.code)?.players[0]?.displayName).toHaveLength(
      MAX_DISPLAY_NAME_LENGTH,
    );
  });

  it('rejects the seventh join and joins into unknown rooms', () => {
    const { registry, creator } = createRoomWithJoiners(MAX_SEATS_PER_ROOM - 1);

    expectRoomError(RoomErrorCode.RoomFull, () =>
      registry.joinRoom({
        code: creator.code,
        displayName: 'seventh',
        socketId: 'socket-7',
      }),
    );

    expectRoomError(RoomErrorCode.RoomNotFound, () =>
      registry.joinRoom({ code: 'NOPE9', displayName: 'ghost', socketId: 'socket-ghost' }),
    );
  });

  it('rejects joining rooms in non-joinable statuses with no mutation', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    const code = creator.code;

    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby });
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.InMatch });

    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.joinRoom({ code, displayName: 'late', socketId: 'socket-late' }),
    );
    const inMatch = registry.getRoom(code) as RoomSnapshot;
    expect(inMatch.status).toBe(RoomStatus.InMatch);
    expect(inMatch.players).toHaveLength(2);

    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Finished });
    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.joinRoom({ code, displayName: 'late', socketId: 'socket-late' }),
    );

    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Expired });
    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.joinRoom({ code, displayName: 'late', socketId: 'socket-late' }),
    );

    expect(registry.getRoom(code)?.players).toHaveLength(2);
  });

  it('lets a finished room return to its lobby with the same seats', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-host' });
    const { code } = creator;
    registry.joinRoom({ code, displayName: 'guest', socketId: 'socket-guest' });
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby });
    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby }),
    );
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.InMatch });
    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby }),
    );
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Finished });
    const lobby = registry.transitionRoom({
      code,
      playerId: creator.playerId,
      nextStatus: RoomStatus.Lobby,
    });
    expect(lobby.status).toBe(RoomStatus.Lobby);
    expect(lobby.players).toHaveLength(2);
  });

  it('rejects duplicate socket ids across joins and rooms', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });

    expectRoomError(RoomErrorCode.DuplicateSocket, () =>
      registry.createRoom({ displayName: 'again', socketId: 'socket-0' }),
    );

    const second = registry.createRoom({ displayName: 'host2', socketId: 'socket-1' });
    expectRoomError(RoomErrorCode.DuplicateSocket, () =>
      registry.joinRoom({ code: second.code, displayName: 'cross', socketId: 'socket-0' }),
    );

    expectRoomError(RoomErrorCode.DuplicateSocket, () =>
      registry.joinRoom({
        code: creator.code,
        displayName: 'dupe',
        socketId: 'socket-1',
      }),
    );
  });
});

describe('RoomRegistry — minimum seats for match start', () => {
  it('requires at least 2 seats before LOBBY can transition to IN_MATCH', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const code = creator.code;

    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby });
    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.InMatch }),
    );
    expect(registry.getRoom(code)?.status).toBe(RoomStatus.Lobby);

    registry.joinRoom({ code, displayName: 'p1', socketId: 'socket-1' });
    expect(
      registry.transitionRoom({
        code,
        playerId: creator.playerId,
        nextStatus: RoomStatus.InMatch,
      }).status,
    ).toBe(RoomStatus.InMatch);
  });
});

describe('RoomRegistry — reconnect tokens and seat rebinding', () => {
  function setupRoom() {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const joiner = registry.joinRoom({
      code: creator.code,
      displayName: 'ally',
      socketId: 'socket-1',
    });
    return { registry, creator, joiner };
  }

  it('returns the raw token only to the joining client and stores only its SHA-256 hash', () => {
    const { registry, creator, joiner } = setupRoom();
    const room = registry.getRoom(creator.code) as RoomSnapshot;

    const serialized = JSON.stringify(room);
    expect(serialized).not.toContain(joiner.reconnectToken);
    expect(serialized).not.toContain(creator.reconnectToken);
    expect(serialized.toLowerCase()).not.toContain('token');

    // The internal hash is not derivable from the snapshot either, but the
    // registry must be able to verify the raw token against it.
    const expectedHash = sha256Hex(joiner.reconnectToken);
    expect(expectedHash).toHaveLength(64);
    expect(registry.getRoom(creator.code)).toEqual(room);

    const rebound = registry.disconnectSeat({ code: creator.code, socketId: 'socket-1' });
    expect(rebound.players.find((p) => p.seatNumber === joiner.seatNumber)?.connected).toBe(false);

    const reconnect = registry.reconnectSeat({
      code: creator.code,
      reconnectToken: joiner.reconnectToken,
      socketId: 'socket-1b',
    });
    expect(reconnect.playerId).toBe(joiner.playerId);
    expect(reconnect.seatNumber).toBe(joiner.seatNumber);
    expect(sha256Hex(joiner.reconnectToken)).toBe(expectedHash);
  });

  it('rebinds a disconnected seat to a new socket without creating a player', () => {
    const { registry, creator, joiner } = setupRoom();

    registry.disconnectSeat({ code: creator.code, socketId: 'socket-1' });
    const before = registry.getRoom(creator.code) as RoomSnapshot;
    expect(before.players).toHaveLength(2);

    const reconnect = registry.reconnectSeat({
      code: creator.code,
      reconnectToken: joiner.reconnectToken,
      socketId: 'socket-1-re',
    });
    expect(reconnect.playerId).toBe(joiner.playerId);
    expect(reconnect.seatNumber).toBe(joiner.seatNumber);

    const after = registry.getRoom(creator.code) as RoomSnapshot;
    expect(after.players).toHaveLength(2);
    const seat = after.players.find((p) => p.playerId === joiner.playerId);
    expect(seat?.connected).toBe(true);
    expect(seat?.playerId).toBe(joiner.playerId);
  });

  it('rejects invalid, foreign, and replayed-alive tokens without leaking seat state', () => {
    const { registry, creator, joiner } = setupRoom();

    expectRoomError(RoomErrorCode.InvalidReconnectToken, () =>
      registry.reconnectSeat({
        code: creator.code,
        reconnectToken: 'not-a-real-token',
        socketId: 'socket-x',
      }),
    );
    expectRoomError(RoomErrorCode.InvalidReconnectToken, () =>
      registry.reconnectSeat({
        code: creator.code,
        reconnectToken: '',
        socketId: 'socket-x',
      }),
    );
    expectRoomError(RoomErrorCode.RoomNotFound, () =>
      registry.reconnectSeat({
        code: 'NOPE9',
        reconnectToken: joiner.reconnectToken,
        socketId: 'socket-x',
      }),
    );

    // A token for another room fails here too.
    const other = registry.createRoom({ displayName: 'host2', socketId: 'socket-2' });
    expectRoomError(RoomErrorCode.InvalidReconnectToken, () =>
      registry.reconnectSeat({
        code: creator.code,
        reconnectToken: other.reconnectToken,
        socketId: 'socket-y',
      }),
    );

    // Replayed while the seat is still connected: rejected as duplicate socket,
    // and the connected seat is untouched.
    expectRoomError(RoomErrorCode.DuplicateSocket, () =>
      registry.reconnectSeat({
        code: creator.code,
        reconnectToken: joiner.reconnectToken,
        socketId: 'socket-fresh',
      }),
    );
    const room = registry.getRoom(creator.code) as RoomSnapshot;
    expect(room.players).toHaveLength(2);
    expect(room.players.find((p) => p.playerId === joiner.playerId)?.connected).toBe(true);
    expect(room.players.find((p) => p.playerId === other.playerId)).toBeUndefined();
  });

  it('rejects reconnect when the socket id is already bound elsewhere', () => {
    const { registry, creator, joiner } = setupRoom();
    registry.disconnectSeat({ code: creator.code, socketId: 'socket-1' });

    expectRoomError(RoomErrorCode.DuplicateSocket, () =>
      registry.reconnectSeat({
        code: creator.code,
        reconnectToken: joiner.reconnectToken,
        socketId: 'socket-0',
      }),
    );
  });

  it('rejects a single-character-tampered token and accepts case-insensitive code lookup', () => {
    const { registry, creator, joiner } = setupRoom();

    // Flip one character of an otherwise well-formed base64url token.
    const original = joiner.reconnectToken;
    const flipped = original[0] === 'A' ? `B${original.slice(1)}` : `A${original.slice(1)}`;
    expect(flipped).not.toBe(original);
    registry.disconnectSeat({ code: creator.code, socketId: 'socket-1' });
    expectRoomError(RoomErrorCode.InvalidReconnectToken, () =>
      registry.reconnectSeat({
        code: creator.code,
        reconnectToken: flipped,
        socketId: 'socket-1b',
      }),
    );

    // Valid token still rebinds; and lowercase code lookup normalizes.
    const reconnect = registry.reconnectSeat({
      code: creator.code.toLowerCase(),
      reconnectToken: original,
      socketId: 'socket-1b',
    });
    expect(reconnect.playerId).toBe(joiner.playerId);
  });
});

describe('RoomRegistry — disconnect and leave lifecycle', () => {
  it('keeps seat and host when the host disconnects and only flips the transport overlay', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });

    const after = registry.disconnectSeat({ code: creator.code, socketId: 'socket-0' });
    expect(after.players).toHaveLength(2);
    expect(after.hostPlayerId).toBe(creator.playerId);
    const hostSeat = after.players.find((p) => p.playerId === creator.playerId);
    expect(hostSeat?.connected).toBe(false);
    expect(hostSeat?.isHost).toBe(true);

    expectRoomError(RoomErrorCode.PlayerNotFound, () =>
      registry.disconnectSeat({ code: creator.code, socketId: 'socket-unknown' }),
    );
    expectRoomError(RoomErrorCode.RoomNotFound, () =>
      registry.disconnectSeat({ code: 'NOPE9', socketId: 'socket-0' }),
    );
  });

  it('transfers host to the earliest-joined connected seat on explicit host leave', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const j1 = registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    registry.joinRoom({ code: creator.code, displayName: 'p2', socketId: 'socket-2' });

    // The earliest-joined connected seat is p1 (seat 2).
    const after = registry.leaveRoom({ code: creator.code, socketId: 'socket-0' });
    expect(after?.hostPlayerId).toBe(j1.playerId);
    const players = after?.players ?? [];
    expect(players).toHaveLength(2);
    expect(players.find((p) => p.playerId === j1.playerId)?.isHost).toBe(true);
    expect(players.find((p) => p.seatNumber === 1)).toBeUndefined();
  });

  it('falls back to the earliest remaining seat when no seat is connected', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const j1 = registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    const j2 = registry.joinRoom({ code: creator.code, displayName: 'p2', socketId: 'socket-2' });

    registry.disconnectSeat({ code: creator.code, socketId: 'socket-1' });
    registry.disconnectSeat({ code: creator.code, socketId: 'socket-2' });

    const after = registry.leaveRoom({ code: creator.code, socketId: 'socket-0' });
    expect(after?.hostPlayerId).toBe(j1.playerId);
    expect(after?.players.find((p) => p.playerId === j2.playerId)?.isHost).toBe(false);
  });

  it('keeps the host when a non-host seat leaves explicitly', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });

    const after = registry.leaveRoom({ code: creator.code, socketId: 'socket-1' });
    expect(after?.hostPlayerId).toBe(creator.playerId);
    expect(after?.players).toHaveLength(1);
  });

  it('removes exactly the seat bound to the leaving socket and clears the binding', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const j1 = registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    const j2 = registry.joinRoom({ code: creator.code, displayName: 'p2', socketId: 'socket-2' });

    const after = registry.leaveRoom({ code: creator.code, socketId: 'socket-1' });
    expect(after?.players.map((p) => p.playerId)).toEqual([creator.playerId, j2.playerId]);
    expect(after?.hostPlayerId).toBe(creator.playerId);
    expect(after?.players.find((p) => p.playerId === j1.playerId)).toBeUndefined();

    // The leaving socket is unbound; a second leave attempt is rejected.
    expectRoomError(RoomErrorCode.SocketNotBound, () =>
      registry.leaveRoom({ code: creator.code, socketId: 'socket-1' }),
    );
  });

  it('proves one player cannot evict another: unbound and cross-room sockets are rejected', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const j1 = registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    registry.createRoom({ displayName: 'other-host', socketId: 'socket-other' });

    // An unbound socket cannot evict player 1.
    expectRoomError(RoomErrorCode.SocketNotBound, () =>
      registry.leaveRoom({ code: creator.code, socketId: 'socket-attacker' }),
    );

    // A socket bound to a different room cannot evict player 1 either.
    expectRoomError(RoomErrorCode.SocketNotBound, () =>
      registry.leaveRoom({ code: creator.code, socketId: 'socket-other' }),
    );

    const room = registry.getRoom(creator.code) as RoomSnapshot;
    expect(room.players).toHaveLength(2);
    expect(room.players.find((p) => p.playerId === j1.playerId)).toBeDefined();
    expect(room.hostPlayerId).toBe(creator.playerId);
  });

  it('deletes the room when the last seat leaves and rejects unbound sockets', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });

    expectRoomError(RoomErrorCode.SocketNotBound, () =>
      registry.leaveRoom({ code: creator.code, socketId: 'socket-unknown' }),
    );

    const removed = registry.leaveRoom({ code: creator.code, socketId: 'socket-0' });
    expect(removed).toBeNull();
    expect(registry.getRoom(creator.code)).toBeUndefined();
    expect(registry.listRooms()).toHaveLength(0);
  });
});

describe('RoomRegistry — explicit leave during a match', () => {
  function setupMatchRoom() {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    const code = creator.code;
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby });
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.InMatch });
    return { registry, creator, code };
  }

  it('rejects an explicit leave during IN_MATCH without any mutation', () => {
    const { registry, creator, code } = setupMatchRoom();

    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.leaveRoom({ code, socketId: 'socket-0' }),
    );

    // The seat, the host, and the status are all untouched.
    const room = registry.getRoom(code) as RoomSnapshot;
    expect(room.status).toBe(RoomStatus.InMatch);
    expect(room.players).toHaveLength(2);
    expect(room.hostPlayerId).toBe(creator.playerId);
    expect(room.players.find((p) => p.playerId === creator.playerId)?.connected).toBe(true);
  });

  it('keeps disconnect as the supported pause path during IN_MATCH', () => {
    const { registry, creator, code } = setupMatchRoom();

    // Disconnect (transport overlay) is still allowed mid-match...
    const afterDisconnect = registry.disconnectSeat({ code, socketId: 'socket-0' });
    expect(afterDisconnect.status).toBe(RoomStatus.InMatch);
    const hostSeat = afterDisconnect.players.find((p) => p.playerId === creator.playerId);
    expect(hostSeat?.connected).toBe(false);
    expect(hostSeat?.isHost).toBe(true);

    // ...and the seat/token survive so the player can rebind.
    const rebound = registry.reconnectSeat({
      code,
      reconnectToken: creator.reconnectToken,
      socketId: 'socket-0-re',
    });
    expect(rebound.playerId).toBe(creator.playerId);
    expect(rebound.seatNumber).toBe(1);
  });

  it('allows an explicit leave once the match is FINISHED', () => {
    const { registry, creator, code } = setupMatchRoom();
    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Finished });

    const after = registry.leaveRoom({ code, socketId: 'socket-0' });
    expect(after).not.toBeNull();
    expect(after?.players).toHaveLength(1);
    expect(after?.players[0]?.isHost).toBe(true);
  });

  it('allows explicit leaves in CREATED and LOBBY statuses', () => {
    const registry = new RoomRegistry();
    const created = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: created.code, displayName: 'p1', socketId: 'socket-1' });
    const afterCreatedLeave = registry.leaveRoom({ code: created.code, socketId: 'socket-0' });
    expect(afterCreatedLeave).not.toBeNull();

    const lobby = registry.createRoom({ displayName: 'host2', socketId: 'socket-2' });
    registry.joinRoom({ code: lobby.code, displayName: 'p1', socketId: 'socket-3' });
    registry.transitionRoom({
      code: lobby.code,
      playerId: lobby.playerId,
      nextStatus: RoomStatus.Lobby,
    });
    const afterLobbyLeave = registry.leaveRoom({ code: lobby.code, socketId: 'socket-2' });
    expect(afterLobbyLeave).not.toBeNull();
  });
});

describe('RoomRegistry — guarded status transitions', () => {
  it('walks the forward lifecycle when driven by the host', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    const code = creator.code;

    expect(
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby })
        .status,
    ).toBe(RoomStatus.Lobby);
    expect(
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.InMatch })
        .status,
    ).toBe(RoomStatus.InMatch);
    expect(
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Finished })
        .status,
    ).toBe(RoomStatus.Finished);
    expect(
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Expired })
        .status,
    ).toBe(RoomStatus.Expired);
  });

  it('guards illegal transitions, non-host drivers, and terminal rooms', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    const j1 = registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });
    const code = creator.code;

    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.InMatch }),
    );
    expectRoomError(RoomErrorCode.NotHost, () =>
      registry.transitionRoom({ code, playerId: j1.playerId, nextStatus: RoomStatus.Lobby }),
    );
    expectRoomError(RoomErrorCode.PlayerNotFound, () =>
      registry.transitionRoom({ code, playerId: 'ghost', nextStatus: RoomStatus.Lobby }),
    );
    expectRoomError(RoomErrorCode.RoomNotFound, () =>
      registry.transitionRoom({
        code: 'NOPE9',
        playerId: creator.playerId,
        nextStatus: RoomStatus.Lobby,
      }),
    );

    registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Expired });
    expectRoomError(RoomErrorCode.InvalidRoomTransition, () =>
      registry.transitionRoom({ code, playerId: creator.playerId, nextStatus: RoomStatus.Lobby }),
    );
  });
});

describe('RoomRegistry — snapshot isolation', () => {
  it('returns copies so callers cannot mutate registry internals', () => {
    const registry = new RoomRegistry();
    const creator = registry.createRoom({ displayName: 'host', socketId: 'socket-0' });
    registry.joinRoom({ code: creator.code, displayName: 'p1', socketId: 'socket-1' });

    const snapshot = registry.getRoom(creator.code) as RoomSnapshot;
    snapshot.status = RoomStatus.Finished;
    snapshot.hostPlayerId = 'hacked';
    snapshot.players.pop();
    snapshot.players[0]!.displayName = 'hacked';
    snapshot.players[0]!.connected = false;
    snapshot.players[0]!.isHost = false;
    snapshot.players.push({
      playerId: 'fake',
      displayName: 'fake',
      seatNumber: 99,
      connected: true,
      isHost: true,
      joinedAt: 0,
    });

    const fresh = registry.getRoom(creator.code) as RoomSnapshot;
    expect(fresh.status).toBe(RoomStatus.Created);
    expect(fresh.hostPlayerId).toBe(creator.playerId);
    expect(fresh.players).toHaveLength(2);
    expect(fresh.players[0]?.displayName).toBe('host');
    expect(fresh.players[0]?.connected).toBe(true);
    expect(fresh.players[0]?.isHost).toBe(true);
    expect(fresh).toEqual(registry.getRoom(creator.code));

    const listed = registry.listRooms();
    listed.pop();
    expect(registry.listRooms()).toHaveLength(1);
  });
});
