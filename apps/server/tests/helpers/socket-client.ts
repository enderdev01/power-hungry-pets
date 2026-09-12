/**
 * Real socket.io-client helpers for gateway tests: typed acknowledgements,
 * broadcast collectors, and room fixtures shared by the gateway test suites.
 */
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  ClientEvents,
  type AckEnvelope,
  type RoomCreateData,
  type RoomJoinData,
} from '../../src/gateway/contracts';

export const CONNECT_TIMEOUT_MS = 5_000;
export const ACK_TIMEOUT_MS = 5_000;
export const EVENT_TIMEOUT_MS = 5_000;

/** Connects a real socket.io client and resolves once the transport is up. */
export function connectClient(port: number): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`client connect timed out after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

/** Emits a client event and resolves its typed acknowledgement envelope. */
export function emitAck<TData>(
  socket: ClientSocket,
  event: string,
  payload?: unknown,
): Promise<AckEnvelope<TData>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${event} ack timed out after ${ACK_TIMEOUT_MS}ms`));
    }, ACK_TIMEOUT_MS);
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit(event, payload, (timeoutError: Error | null, ack: AckEnvelope<TData>) => {
        clearTimeout(timer);
        if (timeoutError) {
          reject(timeoutError);
          return;
        }
        resolve(ack);
      });
  });
}

/** Starts collecting every broadcast of `event` received by the socket. */
export function collectEvents<T>(socket: ClientSocket, event: string): T[] {
  const received: T[] = [];
  socket.on(event, (data: T) => {
    received.push(data);
  });
  return received;
}

/** Resolves once the collector holds at least `count` items. */
export async function waitForCount<T>(
  items: T[],
  count: number,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (items.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`expected ${count} events, received ${items.length} within ${timeoutMs}ms`);
    }
    await sleep(15);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One connected seat of a room fixture. */
export interface SeatFixture {
  socket: ClientSocket;
  playerId: string;
  seatNumber: number;
  /** Raw reconnect token; `null` for seats created without one in tests. */
  reconnectToken: string;
}

/** A lobby room fixture with a connected host and at least one guest. */
export interface RoomFixture {
  code: string;
  host: SeatFixture;
  guests: SeatFixture[];
  seats: SeatFixture[];
}

/**
 * Creates a lobby room over real sockets: the host creates it, then
 * `guestCount` guests join. Every seat keeps its raw reconnect token.
 */
export async function createLobbyRoom(port: number, guestCount = 1): Promise<RoomFixture> {
  const hostSocket = await connectClient(port);
  const createAck = await emitAck<RoomCreateData>(hostSocket, ClientEvents.roomCreate, {
    displayName: 'Host',
  });
  if (!createAck.ok) {
    hostSocket.close();
    throw new Error(`room:create failed: ${createAck.error.code} ${createAck.error.message}`);
  }
  const host: SeatFixture = {
    socket: hostSocket,
    playerId: createAck.data.playerId,
    seatNumber: createAck.data.seatNumber,
    reconnectToken: createAck.data.reconnectToken,
  };

  const guests: SeatFixture[] = [];
  for (let index = 0; index < guestCount; index += 1) {
    const guestSocket = await connectClient(port);
    const joinAck = await emitAck<RoomJoinData>(guestSocket, ClientEvents.roomJoin, {
      code: createAck.data.code,
      displayName: `Guest ${index + 1}`,
    });
    if (!joinAck.ok) {
      guestSocket.close();
      throw new Error(`room:join failed: ${joinAck.error.code} ${joinAck.error.message}`);
    }
    guests.push({
      socket: guestSocket,
      playerId: joinAck.data.playerId,
      seatNumber: joinAck.data.seatNumber,
      reconnectToken: joinAck.data.reconnectToken as string,
    });
  }

  return {
    code: createAck.data.code,
    host,
    guests,
    seats: [host, ...guests],
  };
}

/** Closes every socket in the fixture. */
export function closeRoom(fixture: RoomFixture): void {
  for (const seat of fixture.seats) {
    seat.socket.close();
  }
}
