/**
 * Gateway room-lifecycle contract tests (Milestone 6 server work unit 4).
 * Everything runs against a real NestJS Socket.IO server with real
 * socket.io-client connections; membership is authorized by socket identity.
 */
import { createServer, type ServerHandles } from '../src/main';
import {
  ClientEvents,
  ServerEvents,
  type GameCommandData,
  type RoomCreateData,
  type RoomJoinData,
  type RoomLeaveData,
  type RoomStartData,
  type RoomUpdatedEvent,
} from '../src/gateway/contracts';
import {
  closeRoom,
  collectEvents,
  connectClient,
  createLobbyRoom,
  emitAck,
  sleep,
  waitForCount,
  type RoomFixture,
} from './helpers/socket-client';

describe('gateway room lifecycle', () => {
  jest.setTimeout(30_000);
  let server: ServerHandles;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('room:create acks membership with a room snapshot in LOBBY and the creator as host', async () => {
    const socket = await connectClient(server.port);
    try {
      const ack = await emitAck<RoomCreateData>(socket, ClientEvents.roomCreate, {
        displayName: '  Ada   Lovelace ',
      });
      expect(ack.ok).toBe(true);
      if (!ack.ok) {
        throw new Error('expected success envelope');
      }
      expect(ack.data.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
      expect(typeof ack.data.playerId).toBe('string');
      expect(ack.data.seatNumber).toBe(1);
      expect(ack.data.reconnectToken.length).toBeGreaterThan(20);
      expect(ack.data.room.status).toBe('LOBBY');
      expect(ack.data.room.players).toHaveLength(1);
      expect(ack.data.room.players[0]).toMatchObject({
        playerId: ack.data.playerId,
        displayName: 'Ada Lovelace',
        seatNumber: 1,
        connected: true,
        isHost: true,
      });
    } finally {
      socket.close();
    }
  });

  it('room:join acks a new seat and room broadcasts never carry reconnect tokens', async () => {
    const hostSocket = await connectClient(server.port);
    const createAck = await emitAck<RoomCreateData>(hostSocket, ClientEvents.roomCreate, {
      displayName: 'Host',
    });
    if (!createAck.ok) {
      throw new Error(createAck.error.message);
    }
    const guestSocket = await connectClient(server.port);
    try {
      const hostUpdates = collectEvents<RoomUpdatedEvent>(hostSocket, ServerEvents.roomUpdated);
      const guestUpdates = collectEvents<RoomUpdatedEvent>(guestSocket, ServerEvents.roomUpdated);

      const joinAck = await emitAck<RoomJoinData>(guestSocket, ClientEvents.roomJoin, {
        code: createAck.data.code,
        displayName: 'Bob',
      });
      expect(joinAck.ok).toBe(true);
      if (!joinAck.ok) {
        throw new Error('expected success envelope');
      }
      expect(joinAck.data.reconnectToken).toBeTruthy();
      expect(joinAck.data.seatNumber).toBe(2);
      expect(joinAck.data.room.players).toHaveLength(2);
      expect(joinAck.data.room.players[1]).toMatchObject({
        displayName: 'Bob',
        connected: true,
        isHost: false,
      });

      await waitForCount(guestUpdates, 1);
      const serialized = JSON.stringify([...hostUpdates, ...guestUpdates]);
      expect(serialized).not.toContain(joinAck.data.reconnectToken);
      expect(serialized).not.toContain(createAck.data.reconnectToken);
      expect(serialized).not.toContain('reconnectToken');
      expect(serialized).not.toContain('tokenHash');
    } finally {
      hostSocket.close();
      guestSocket.close();
    }
  });

  it('room:start is host-only and transitions the room to IN_MATCH', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const guestStart = await emitAck<RoomStartData>(
        fixture.guests[0]!.socket,
        ClientEvents.roomStart,
        {
          code: fixture.code,
        },
      );
      expect(guestStart.ok).toBe(false);
      if (guestStart.ok) {
        throw new Error('expected failure envelope');
      }
      expect(guestStart.error.code).toBe('NOT_HOST');

      const hostStart = await emitAck<RoomStartData>(fixture.host.socket, ClientEvents.roomStart, {
        code: fixture.code,
      });
      expect(hostStart.ok).toBe(true);
      if (!hostStart.ok) {
        throw new Error(hostStart.error.message);
      }
      expect(hostStart.data.room.status).toBe('IN_MATCH');
      expect(hostStart.data.publicView.round).not.toBeNull();
    } finally {
      closeRoom(fixture);
    }
  });

  it('rejects joins with a bad code, a full room, and an unusable display name', async () => {
    const badCodeSocket = await connectClient(server.port);
    try {
      const badCode = await emitAck<RoomJoinData>(badCodeSocket, ClientEvents.roomJoin, {
        code: 'ZZZZZ',
        displayName: 'Anyone',
      });
      expect(badCode.ok).toBe(false);
      if (!badCode.ok) {
        expect(badCode.error.code).toBe('ROOM_NOT_FOUND');
      }
    } finally {
      badCodeSocket.close();
    }

    const fixture = await createLobbyRoom(server.port, 5);
    try {
      expect(fixture.seats).toHaveLength(6);
      const sixth = await connectClient(server.port);
      const fullAck = await emitAck<RoomJoinData>(sixth, ClientEvents.roomJoin, {
        code: fixture.code,
        displayName: 'Extra',
      });
      sixth.close();
      expect(fullAck.ok).toBe(false);
      if (!fullAck.ok) {
        expect(fullAck.error.code).toBe('ROOM_FULL');
      }
    } finally {
      closeRoom(fixture);
    }

    const nameFixture = await createLobbyRoom(server.port);
    try {
      const blankSocket = await connectClient(server.port);
      const blank = await emitAck<RoomJoinData>(blankSocket, ClientEvents.roomJoin, {
        code: nameFixture.code,
        displayName: '   ',
      });
      blankSocket.close();
      if (!blank.ok) {
        expect(blank.error.code).toBe('INVALID_DISPLAY_NAME');
      } else {
        throw new Error('expected failure envelope');
      }

      const oversizedSocket = await connectClient(server.port);
      const oversized = await emitAck<RoomJoinData>(oversizedSocket, ClientEvents.roomJoin, {
        code: nameFixture.code,
        displayName: 'x'.repeat(25),
      });
      oversizedSocket.close();
      if (!oversized.ok) {
        expect(oversized.error.code).toBe('INVALID_DISPLAY_NAME');
      } else {
        throw new Error('expected failure envelope');
      }
    } finally {
      closeRoom(nameFixture);
    }
  });

  it('rejects an explicit room:leave during IN_MATCH with no mutation and no fanout', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const guestUpdates = collectEvents<RoomUpdatedEvent>(
        fixture.guests[0]!.socket,
        ServerEvents.roomUpdated,
      );
      const startAck = await emitAck<RoomStartData>(fixture.host.socket, ClientEvents.roomStart, {
        code: fixture.code,
      });
      if (!startAck.ok) {
        throw new Error(startAck.error.message);
      }
      // The start fanout is the guest's baseline room:updated.
      await waitForCount(guestUpdates, 1);

      const leave = await emitAck<RoomLeaveData>(
        fixture.guests[0]!.socket,
        ClientEvents.roomLeave,
        {
          code: fixture.code,
        },
      );
      expect(leave.ok).toBe(false);
      if (!leave.ok) {
        expect(leave.error.code).toBe('INVALID_ROOM_TRANSITION');
      }

      // No room:updated fanout followed the rejected leave.
      await sleep(150);
      expect(guestUpdates).toHaveLength(1);

      // The seat is still bound: the same socket still commands in the room
      // (processed or engine-rejected, never as an unbound socket).
      const command = await emitAck<GameCommandData>(
        fixture.guests[0]!.socket,
        ClientEvents.gameCommand,
        {
          code: fixture.code,
          command: { type: 'DRAW_CARD', actorId: fixture.guests[0]!.playerId },
        },
      );
      const commandCode = command.ok ? 'PROCESSED' : command.error.code;
      expect(commandCode).not.toBe('SOCKET_NOT_BOUND');
    } finally {
      closeRoom(fixture);
    }
  });

  it('rate-limits room:join attempts per socket with a typed RATE_LIMITED ack', async () => {
    const socket = await connectClient(server.port);
    try {
      // The deterministic default budget is 8 join attempts per socket per
      // 60s window; every failed attempt counts, so the 9th is limited.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const ack = await emitAck<RoomJoinData>(socket, ClientEvents.roomJoin, {
          code: 'ZZZZZ',
          displayName: 'Spammer',
        });
        expect(ack.ok).toBe(false);
        if (!ack.ok) {
          expect(ack.error.code).toBe('ROOM_NOT_FOUND');
        }
      }

      const limited = await emitAck<RoomJoinData>(socket, ClientEvents.roomJoin, {
        code: 'ZZZZZ',
        displayName: 'Spammer',
      });
      expect(limited.ok).toBe(false);
      if (!limited.ok) {
        expect(limited.error.code).toBe('RATE_LIMITED');
      }
    } finally {
      socket.close();
    }
  });

  it('the join rate limit does not affect already-bound gameplay', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      // Spam joins from the bound host socket: each is counted, and the budget
      // is eventually exhausted, but the seat stays bound.
      for (let attempt = 0; attempt < 9; attempt += 1) {
        const ack = await emitAck<RoomJoinData>(fixture.host.socket, ClientEvents.roomJoin, {
          code: fixture.code,
          displayName: 'Dupe',
        });
        expect(ack.ok).toBe(false);
        if (!ack.ok) {
          expect(['DUPLICATE_SOCKET', 'RATE_LIMITED']).toContain(ack.error.code);
        }
      }

      // Gameplay on the same socket is untouched by the join limiter.
      const command = await emitAck<GameCommandData>(
        fixture.host.socket,
        ClientEvents.gameCommand,
        {
          code: fixture.code,
          command: { type: 'DRAW_CARD', actorId: fixture.host.playerId },
        },
      );
      expect(command.ok).toBe(false);
      if (!command.ok) {
        expect(command.error.code).not.toBe('RATE_LIMITED');
        expect(command.error.code).not.toBe('SOCKET_NOT_BOUND');
      }
    } finally {
      closeRoom(fixture);
    }
  });

  it('malformed payloads fail at the gateway boundary with INVALID_PAYLOAD', async () => {
    const cases: Array<[string, unknown]> = [
      [ClientEvents.roomCreate, 42],
      [ClientEvents.roomCreate, { displayName: 123 }],
      [ClientEvents.roomJoin, { code: 7, displayName: 'x' }],
      [ClientEvents.roomJoin, { code: 'AB123' }],
      // A present reconnectToken must be a nonempty string, never anything else.
      [ClientEvents.roomJoin, { code: 'AB123', reconnectToken: '' }],
      [ClientEvents.roomJoin, { code: 'AB123', reconnectToken: 42 }],
      [ClientEvents.roomJoin, { code: 'AB123', reconnectToken: {} }],
      [ClientEvents.roomJoin, { code: 'AB123', reconnectToken: null, displayName: 'Bob' }],
      [ClientEvents.roomJoin, { code: 'AB123', reconnectToken: 42, displayName: 'Bob' }],
      [ClientEvents.roomLeave, 42],
      [ClientEvents.roomStart, {}],
      [ClientEvents.gameCommand, { code: 'AB123', command: 'DRAW_CARD' }],
      [ClientEvents.gameCommand, { code: 'AB123', command: { type: 'MOSHPIT', actorId: 'p1' } }],
      [ClientEvents.gameCommand, { code: 'AB123', command: { type: 'PLAY_CARD', actorId: 'p1' } }],
      [
        ClientEvents.gameCommand,
        { code: 'AB123', command: { type: 'SUBMIT_GUESS', actorId: 'p1', value: '3' } },
      ],
      [ClientEvents.gameCommand, { code: 'AB123' }],
    ];
    for (const [event, payload] of cases) {
      const socket = await connectClient(server.port);
      try {
        const ack = await emitAck<RoomLeaveData>(socket, event, payload);
        expect(ack.ok).toBe(false);
        if (ack.ok) {
          throw new Error(`expected INVALID_PAYLOAD for ${event} ${JSON.stringify(payload)}`);
        }
        expect(ack.error.code).toBe('INVALID_PAYLOAD');
      } finally {
        socket.close();
      }
    }
  });

  it('unbound sockets cannot command, start, or leave', async () => {
    const socket = await connectClient(server.port);
    try {
      const command = await emitAck<GameCommandData>(socket, ClientEvents.gameCommand, {
        code: 'AB123',
        command: { type: 'DRAW_CARD', actorId: 'someone' },
      });
      if (command.ok) {
        throw new Error('expected failure envelope');
      }
      expect(command.error.code).toBe('SOCKET_NOT_BOUND');

      const start = await emitAck<RoomStartData>(socket, ClientEvents.roomStart, { code: 'AB123' });
      if (start.ok) {
        throw new Error('expected failure envelope');
      }
      expect(start.error.code).toBe('SOCKET_NOT_BOUND');

      const leave = await emitAck<RoomLeaveData>(socket, ClientEvents.roomLeave, { code: 'AB123' });
      if (leave.ok) {
        throw new Error('expected failure envelope');
      }
      expect(leave.error.code).toBe('SOCKET_NOT_BOUND');
    } finally {
      socket.close();
    }
  });

  it('explicit leave is socket-authenticated, transfers host, and broadcasts the remaining room', async () => {
    const fixture = await createLobbyRoom(server.port, 2);
    try {
      const remainingUpdates = collectEvents<RoomUpdatedEvent>(
        fixture.guests[0]!.socket,
        ServerEvents.roomUpdated,
      );

      // A socket bound to a different room cannot leave this room's code.
      const other = await createLobbyRoom(server.port);
      const crossLeave = await emitAck<RoomLeaveData>(
        fixture.guests[0]!.socket,
        ClientEvents.roomLeave,
        {
          code: other.code,
        },
      );
      if (crossLeave.ok) {
        throw new Error('expected failure envelope');
      }
      expect(crossLeave.error.code).toBe('SOCKET_NOT_BOUND');
      closeRoom(other);

      const hostLeave = await emitAck<RoomLeaveData>(fixture.host.socket, ClientEvents.roomLeave, {
        code: fixture.code,
      });
      expect(hostLeave.ok).toBe(true);
      if (!hostLeave.ok) {
        throw new Error(hostLeave.error.message);
      }
      expect(hostLeave.data.room).not.toBeNull();
      expect(hostLeave.data.room!.players.map((player) => player.playerId)).toEqual([
        fixture.guests[0]!.playerId,
        fixture.guests[1]!.playerId,
      ]);
      expect(hostLeave.data.room!.hostPlayerId).toBe(fixture.guests[0]!.playerId);
      expect(hostLeave.data.room!.players[0]!.isHost).toBe(true);

      await waitForCount(remainingUpdates, 1);
      expect(remainingUpdates[0]!.room.players).toHaveLength(2);
      expect(
        remainingUpdates[0]!.room.players.some(
          (player) => player.playerId === fixture.host.playerId,
        ),
      ).toBe(false);
    } finally {
      closeRoom(fixture);
    }
  });

  it('the last seat leaving deletes the room', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const first = await emitAck<RoomLeaveData>(
        fixture.guests[0]!.socket,
        ClientEvents.roomLeave,
        {
          code: fixture.code,
        },
      );
      expect(first.ok).toBe(true);
      if (!first.ok) {
        throw new Error(first.error.message);
      }
      expect(first.data.room).not.toBeNull();

      const last = await emitAck<RoomLeaveData>(fixture.host.socket, ClientEvents.roomLeave, {
        code: fixture.code,
      });
      expect(last.ok).toBe(true);
      if (!last.ok) {
        throw new Error(last.error.message);
      }
      expect(last.data.room).toBeNull();

      const fresh = await connectClient(server.port);
      try {
        const join = await emitAck<RoomJoinData>(fresh, ClientEvents.roomJoin, {
          code: fixture.code,
          displayName: 'Late',
        });
        if (join.ok) {
          throw new Error('expected failure envelope');
        }
        expect(join.error.code).toBe('ROOM_NOT_FOUND');
      } finally {
        fresh.close();
      }
    } finally {
      closeRoom(fixture);
    }
  });

  it('leaves a fixture room between tests without leaking fixtures', async () => {
    // Guards that the suite itself leaves no dangling server state.
    const fixture: RoomFixture = await createLobbyRoom(server.port, 1);
    const ack = await emitAck<RoomLeaveData>(fixture.host.socket, ClientEvents.roomLeave, {
      code: fixture.code,
    });
    expect(ack.ok).toBe(true);
    closeRoom(fixture);
  });
});
