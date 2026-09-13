/**
 * Client-side room-scoped storage contract: reconnect tokens are persisted
 * per room, in client-only storage (sessionStorage, one tab = one seat), and
 * never leak into rendered state or logs.
 */
import {
  clearSeat,
  clearReconnectToken,
  loadDisplayName,
  loadSeat,
  loadReconnectToken,
  saveDisplayName,
  saveSeat,
  saveReconnectToken,
} from '@/lib/room-flow/client-storage';

describe('room-scoped client storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a reconnect token under a room-scoped key', () => {
    saveReconnectToken('ABC12', 'tok-abc');
    expect(loadReconnectToken('ABC12')).toBe('tok-abc');
    expect(Object.keys(sessionStorage)).toContain('php:room:ABC12:reconnect-token');
  });

  it('keeps tokens isolated per room', () => {
    saveReconnectToken('ABC12', 'tok-abc');
    saveReconnectToken('ZZZZ9', 'tok-zzz');
    expect(loadReconnectToken('ABC12')).toBe('tok-abc');
    expect(loadReconnectToken('ZZZZ9')).toBe('tok-zzz');
    clearReconnectToken('ABC12');
    expect(loadReconnectToken('ABC12')).toBeNull();
    expect(loadReconnectToken('ZZZZ9')).toBe('tok-zzz');
  });

  it('normalizes the room code for keying', () => {
    saveReconnectToken(' abc12 ', 'tok-abc');
    expect(loadReconnectToken('ABC12')).toBe('tok-abc');
    expect(loadReconnectToken('abc12')).toBe('tok-abc');
  });

  it('round-trips the seat identity per room', () => {
    saveSeat('ABC12', { playerId: 'p-1', seatNumber: 2 });
    expect(loadSeat('ABC12')).toEqual({ playerId: 'p-1', seatNumber: 2 });
    clearSeat('ABC12');
    expect(loadSeat('ABC12')).toBeNull();
  });

  it('returns null instead of throwing when nothing is stored', () => {
    expect(loadReconnectToken('NOPE1')).toBeNull();
    expect(loadSeat('NOPE1')).toBeNull();
  });

  it('round-trips the remembered display name', () => {
    expect(loadDisplayName()).toBeNull();
    saveDisplayName('  Ana   Pérez ');
    expect(loadDisplayName()).toBe('Ana   Pérez');
  });
});
