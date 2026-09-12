/**
 * Gateway disconnect/reconnect contract tests (Milestone 6 server work unit 4):
 * the transport overlay on disconnect, same-token seat rebind restoring room,
 * public, and private state, and reconnect authentication rejections.
 */
import { createServer, type ServerHandles } from '../src/main';
import {
  ClientEvents,
  ServerEvents,
  type GamePrivateStateBroadcast,
  type GamePublicStateBroadcast,
  type RoomJoinData,
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
} from './helpers/socket-client';
import { JoinRateLimiter } from '../src/gateway/join-rate-limiter';

describe('gateway disconnect and reconnect', () => {
  jest.setTimeout(60_000);
  let server: ServerHandles;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('disconnect marks the overlay disconnected and broadcasts room/public/private updates without eliminating', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const hostUpdates = collectEvents<RoomUpdatedEvent>(
        fixture.host.socket,
        ServerEvents.roomUpdated,
      );
      const hostPublic = collectEvents<GamePublicStateBroadcast>(
        fixture.host.socket,
        ServerEvents.gamePublicState,
      );
      const hostPrivate = collectEvents<GamePrivateStateBroadcast>(
        fixture.host.socket,
        ServerEvents.gamePrivateState,
      );
      const startAck = await emitAck<RoomStartData>(fixture.host.socket, ClientEvents.roomStart, {
        code: fixture.code,
      });
      if (!startAck.ok) {
        throw new Error(startAck.error.message);
      }
      await waitForCount(hostUpdates, 1);
      await waitForCount(hostPublic, 1);
      await waitForCount(hostPrivate, 1);

      fixture.guests[0]!.socket.close();
      await waitForCount(hostUpdates, 2);
      await waitForCount(hostPublic, 2);
      await waitForCount(hostPrivate, 2);

      const update = hostUpdates[1]!.room;
      expect(update.status).toBe('IN_MATCH');
      expect(update.players).toHaveLength(2);
      const guestView = update.players.find(
        (player) => player.playerId === fixture.guests[0]!.playerId,
      )!;
      expect(guestView.connected).toBe(false);
      expect(guestView.isHost).toBe(false);

      const publicView = hostPublic[1]!.publicView;
      const publicGuest = publicView.players.find(
        (player) => player.id === fixture.guests[0]!.playerId,
      )!;
      expect(publicGuest.connected).toBe(false);
      expect(publicGuest.eliminated).toBe(false);

      // The host still receives its own fresh private state.
      expect(hostPrivate[1]!.privateView.viewerId).toBe(fixture.host.playerId);
    } finally {
      closeRoom(fixture);
    }
  });

  it('same-token room:join rebinds the seat and restores room, public, and private state', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      // Attached before the start so every room:updated is captured.
      const hostUpdates = collectEvents<RoomUpdatedEvent>(
        fixture.host.socket,
        ServerEvents.roomUpdated,
      );
      const startAck = await emitAck<RoomStartData>(fixture.host.socket, ClientEvents.roomStart, {
        code: fixture.code,
      });
      if (!startAck.ok) {
        throw new Error(startAck.error.message);
      }
      await waitForCount(hostUpdates, 1);

      fixture.guests[0]!.socket.close();
      await waitForCount(hostUpdates, 2);

      const rejoinSocket = await connectClient(server.port);
      fixture.seats.push({
        socket: rejoinSocket,
        playerId: fixture.guests[0]!.playerId,
        seatNumber: fixture.guests[0]!.seatNumber,
        reconnectToken: fixture.guests[0]!.reconnectToken,
      });
      const rejoinUpdates = collectEvents<RoomUpdatedEvent>(rejoinSocket, ServerEvents.roomUpdated);
      const rejoinPublic = collectEvents<GamePublicStateBroadcast>(
        rejoinSocket,
        ServerEvents.gamePublicState,
      );
      const rejoinPrivate = collectEvents<GamePrivateStateBroadcast>(
        rejoinSocket,
        ServerEvents.gamePrivateState,
      );

      const rejoin = await emitAck<RoomJoinData>(rejoinSocket, ClientEvents.roomJoin, {
        code: fixture.code,
        reconnectToken: fixture.guests[0]!.reconnectToken,
      });
      expect(rejoin.ok).toBe(true);
      if (!rejoin.ok) {
        throw new Error(rejoin.error.message);
      }
      expect(rejoin.data.playerId).toBe(fixture.guests[0]!.playerId);
      expect(rejoin.data.seatNumber).toBe(fixture.guests[0]!.seatNumber);
      expect(rejoin.data.reconnectToken).toBeNull();
      expect(
        rejoin.data.room.players.find((p) => p.playerId === rejoin.data.playerId)!.connected,
      ).toBe(true);

      // The rejoining socket gets room, public, and private state restored.
      await waitForCount(rejoinUpdates, 1);
      await waitForCount(rejoinPublic, 1);
      await waitForCount(rejoinPrivate, 1);
      const privateView = rejoinPrivate[0]!.privateView;
      expect(privateView.viewerId).toBe(fixture.guests[0]!.playerId);
      expect(privateView.hand).toHaveLength(1);
      expect(Array.isArray(privateView.legalActions)).toBe(true);
      expect(privateView.pendingDecision).toBeNull();

      // The other seat sees the rebind as a connected overlay.
      await waitForCount(hostUpdates, 3);
      const latest = hostUpdates[2]!.room;
      expect(
        latest.players.find((p) => p.playerId === fixture.guests[0]!.playerId)!.connected,
      ).toBe(true);
    } finally {
      closeRoom(fixture);
    }
  });

  it('reconnect rejects a wrong token and a still-connected seat', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const wrongTokenSocket = await connectClient(server.port);
      const wrongToken = await emitAck<RoomJoinData>(wrongTokenSocket, ClientEvents.roomJoin, {
        code: fixture.code,
        reconnectToken: 'not-a-real-token',
      });
      wrongTokenSocket.close();
      if (wrongToken.ok) {
        throw new Error('expected failure envelope');
      }
      expect(wrongToken.error.code).toBe('INVALID_RECONNECT_TOKEN');

      const replaySocket = await connectClient(server.port);
      const replay = await emitAck<RoomJoinData>(replaySocket, ClientEvents.roomJoin, {
        code: fixture.code,
        reconnectToken: fixture.host.reconnectToken,
      });
      replaySocket.close();
      if (replay.ok) {
        throw new Error('expected failure envelope');
      }
      expect(replay.error.code).toBe('DUPLICATE_SOCKET');
    } finally {
      closeRoom(fixture);
    }
  });

  it('rejects a present reconnectToken that is not a nonempty string as INVALID_PAYLOAD and never creates a seat', async () => {
    const fixture = await createLobbyRoom(server.port);
    try {
      const badTokens: unknown[] = ['', 42, {}, null, true];
      for (const badToken of badTokens) {
        const socket = await connectClient(server.port);
        const ack = await emitAck<RoomJoinData>(socket, ClientEvents.roomJoin, {
          code: fixture.code,
          reconnectToken: badToken,
          displayName: 'Bob',
        });
        socket.close();
        expect(ack.ok).toBe(false);
        if (!ack.ok) {
          expect(ack.error.code).toBe('INVALID_PAYLOAD');
        }
      }

      // No malformed attempt silently created a seat: the next real join is
      // still the third seat (host + guest fixture), never the fourth.
      const fresh = await connectClient(server.port);
      try {
        const join = await emitAck<RoomJoinData>(fresh, ClientEvents.roomJoin, {
          code: fixture.code,
          displayName: 'Real Joiner',
        });
        expect(join.ok).toBe(true);
        if (!join.ok) {
          throw new Error(join.error.message);
        }
        expect(join.data.seatNumber).toBe(3);
      } finally {
        fresh.close();
      }
    } finally {
      closeRoom(fixture);
    }
  });

  it('a new seat without a token joins a lobby but not a running match', async () => {
    const lobby = await createLobbyRoom(server.port);
    try {
      const latecomerSocket = await connectClient(server.port);
      const latecomer = await emitAck<RoomJoinData>(latecomerSocket, ClientEvents.roomJoin, {
        code: lobby.code,
        displayName: 'Late',
      });
      latecomerSocket.close();
      if (!latecomer.ok) {
        throw new Error(latecomer.error.message);
      }
      expect(latecomer.data.seatNumber).toBe(3);
      expect(latecomer.data.reconnectToken).toBeTruthy();
    } finally {
      closeRoom(lobby);
    }

    const running = await createLobbyRoom(server.port);
    try {
      const startAck = await emitAck<RoomStartData>(running.host.socket, ClientEvents.roomStart, {
        code: running.code,
      });
      if (!startAck.ok) {
        throw new Error(startAck.error.message);
      }
      const latecomerSocket = await connectClient(server.port);
      const latecomer = await emitAck<RoomJoinData>(latecomerSocket, ClientEvents.roomJoin, {
        code: running.code,
        displayName: 'Late',
      });
      latecomerSocket.close();
      if (latecomer.ok) {
        throw new Error('expected failure envelope');
      }
      expect(latecomer.error.code).toBe('INVALID_ROOM_TRANSITION');
    } finally {
      closeRoom(running);
    }
  });

  it('disconnect drops the exhausted join budget and a new connection stays independent', async () => {
    // The limiter is the process-wide singleton provider; its recorded-attempts
    // map is the only direct way to observe state removal for a per-connection
    // key that socket.io can never hand out again.
    const limiter = server.app.get(JoinRateLimiter);
    const attemptsOf = () => (limiter as unknown as { attempts: Map<string, unknown> }).attempts;

    const spam = await connectClient(server.port);
    // Connected sockets always carry a server-assigned id.
    const spamId = spam.id as string;
    try {
      // Every room:join attempt counts, malformed included: 8 attempts exhaust
      // the unchanged per-connection budget and the 9th is rate limited.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const ack = await emitAck(spam, ClientEvents.roomJoin, {});
        expect(ack.ok).toBe(false);
        if (!ack.ok) {
          expect(ack.error.code).toBe('INVALID_PAYLOAD');
        }
      }
      const ninth = await emitAck(spam, ClientEvents.roomJoin, {});
      expect(ninth.ok).toBe(false);
      if (!ninth.ok) {
        expect(ninth.error.code).toBe('RATE_LIMITED');
      }
      expect(attemptsOf().has(spamId)).toBe(true);
    } finally {
      spam.close();
    }

    // Disconnect cleanup must forget the connection's key within the event
    // loop's ordinary settling time; no 60s window wait is acceptable.
    const deadline = Date.now() + 5_000;
    while (attemptsOf().has(spamId) && Date.now() < deadline) {
      await sleep(15);
    }
    expect(attemptsOf().has(spamId)).toBe(false);

    // A brand-new connection (fresh key) keeps the full 8/60 budget: 8 more
    // attempts pass and only the 9th is rate limited.
    const fresh = await connectClient(server.port);
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const ack = await emitAck(fresh, ClientEvents.roomJoin, {});
        expect(ack.ok).toBe(false);
        if (!ack.ok) {
          expect(ack.error.code).toBe('INVALID_PAYLOAD');
        }
      }
      const freshNinth = await emitAck(fresh, ClientEvents.roomJoin, {});
      expect(freshNinth.ok).toBe(false);
      if (!freshNinth.ok) {
        expect(freshNinth.error.code).toBe('RATE_LIMITED');
      }
    } finally {
      fresh.close();
    }
  });
});
