import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { ClientEvents, type AckEnvelope, type SystemPingData } from '../src/gateway/contracts';
import { createServer, type ServerHandles } from '../src/main';

const CONNECT_TIMEOUT_MS = 5_000;
const ACK_TIMEOUT_MS = 5_000;
const DISCONNECT_GRACE_MS = 100;

function connectClient(port: number): Promise<ClientSocket> {
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

function ping(socket: ClientSocket, sentAt: number): Promise<AckEnvelope<SystemPingData>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`system:ping ack timed out after ${ACK_TIMEOUT_MS}ms`));
    }, ACK_TIMEOUT_MS);
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit(
        ClientEvents.systemPing,
        { sentAt },
        (timeoutError: Error | null, ack: AckEnvelope<SystemPingData>) => {
          clearTimeout(timer);
          if (timeoutError) {
            reject(timeoutError);
            return;
          }
          resolve(ack);
        },
      );
  });
}

describe('server smoke contract', () => {
  let server: ServerHandles;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('boots on an ephemeral port', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.httpServer.listening).toBe(true);
  });

  it('acks system:ping with a typed success envelope', async () => {
    const client = await connectClient(server.port);
    try {
      const ack = await ping(client, 1234);
      expect(ack.ok).toBe(true);
      if (!ack.ok) {
        throw new Error('expected success envelope');
      }
      expect(ack.data.pong).toBe(true);
      expect(typeof ack.data.serverTime).toBe('number');
      expect(ack.data.echoedAt).toBe(1234);
    } finally {
      client.close();
    }
  });

  it('serves two concurrent clients with independent envelopes', async () => {
    const [clientA, clientB] = await Promise.all([
      connectClient(server.port),
      connectClient(server.port),
    ]);
    try {
      const [ackA, ackB] = await Promise.all([ping(clientA, 1), ping(clientB, 2)]);
      expect(ackA).toEqual({
        ok: true,
        data: { pong: true, serverTime: expect.any(Number), echoedAt: 1 },
      });
      expect(ackB).toEqual({
        ok: true,
        data: { pong: true, serverTime: expect.any(Number), echoedAt: 2 },
      });
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it('acks a payload-less ping without echoing sentAt', async () => {
    const client = await connectClient(server.port);
    try {
      const ack = await ping(client, undefined as unknown as number);
      expect(ack.ok).toBe(true);
      if (!ack.ok) {
        throw new Error('expected success envelope');
      }
      expect(ack.data.pong).toBe(true);
      expect(ack.data.echoedAt).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it('closes cleanly without leaving the server listening or clients attached', async () => {
    const ephemeral = await createServer({ port: 0 });
    const client = await connectClient(ephemeral.port);

    await ephemeral.close();
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_GRACE_MS));

    expect(ephemeral.httpServer.listening).toBe(false);
    expect(client.connected).toBe(false);
    client.close();
  });
});
