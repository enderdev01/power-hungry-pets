/**
 * Start-gating selectors: the lobby start button renders purely from these
 * results. Legality itself stays server-side; this only mirrors the published
 * lobby contract (2–6 players, host-only, LOBBY status).
 */
import { evaluateStart, startBlockMessage, type StartBlockReason } from '@/lib/room-flow/selectors';
import type { SeatIdentity } from '@/lib/room-flow/reducer';
import type { RoomSnapshot } from '@power-hungry-pets/protocol';

function roomWith(count: number, overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomId: 'room-1',
    code: 'ABC12',
    status: 'LOBBY',
    hostPlayerId: 'p-host',
    createdAt: 1,
    players: Array.from({ length: count }, (_, i) => ({
      playerId: `p-${i}`,
      displayName: `Player ${i}`,
      seatNumber: i + 1,
      connected: true,
      isHost: i === 0,
      joinedAt: i,
    })),
    ...overrides,
  };
}

const HOST: SeatIdentity = { playerId: 'p-host', seatNumber: 1 };
const GUEST: SeatIdentity = { playerId: 'p-1', seatNumber: 2 };

describe('evaluateStart', () => {
  it('allows the host to start with two connected players in a lobby', () => {
    expect(evaluateStart(roomWith(2), HOST, 'connected')).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('allows a full six-seat lobby to start', () => {
    expect(evaluateStart(roomWith(6), HOST, 'connected').allowed).toBe(true);
  });

  it('blocks a one-player lobby on the minimum', () => {
    expect(evaluateStart(roomWith(1), HOST, 'connected')).toEqual({
      allowed: false,
      reason: 'min-players',
    });
  });

  it('blocks a non-host seat', () => {
    expect(evaluateStart(roomWith(2), GUEST, 'connected')).toEqual({
      allowed: false,
      reason: 'not-host',
    });
  });

  it('blocks a room that already left the lobby stage', () => {
    expect(evaluateStart(roomWith(2, { status: 'IN_MATCH' }), HOST, 'connected')).toEqual({
      allowed: false,
      reason: 'room-status',
    });
  });

  it('blocks while the transport is down', () => {
    expect(evaluateStart(roomWith(2), HOST, 'disconnected')).toEqual({
      allowed: false,
      reason: 'not-connected',
    });
  });

  it('blocks when there is no seat yet', () => {
    expect(evaluateStart(roomWith(2), null, 'connected').allowed).toBe(false);
  });
});

describe('startBlockMessage', () => {
  it('gives a distinct text for every block reason', () => {
    const reasons: StartBlockReason[] = ['not-host', 'min-players', 'room-status', 'not-connected'];
    const messages = reasons.map(startBlockMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('explains the minimum count concretely', () => {
    expect(startBlockMessage('min-players')).toMatch(/2/);
  });
});
