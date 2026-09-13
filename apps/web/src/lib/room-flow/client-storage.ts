/**
 * Client-only room-scoped persistence, built on sessionStorage: one browser
 * tab holds exactly one seat per room. Reconnect token material lives only
 * in these keys — never in rendered state, never in logs.
 */
import type { RoomFlowStores, ReconnectTokenSink, SeatStore } from './controller';

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function tokenKey(code: string): string {
  return `php:room:${normalizeCode(code)}:reconnect-token`;
}

function seatKey(code: string): string {
  return `php:room:${normalizeCode(code)}:seat`;
}

const NAME_KEY = 'php:display-name';

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

const tokenSink: ReconnectTokenSink = {
  save(code, token) {
    if (storageAvailable()) {
      sessionStorage.setItem(tokenKey(code), token);
    }
  },
  load(code) {
    return storageAvailable() ? sessionStorage.getItem(tokenKey(code)) : null;
  },
  clear(code) {
    if (storageAvailable()) {
      sessionStorage.removeItem(tokenKey(code));
    }
  },
};

const seatStore: SeatStore = {
  save(code, seat) {
    if (storageAvailable()) {
      sessionStorage.setItem(seatKey(code), JSON.stringify(seat));
    }
  },
  load(code) {
    if (!storageAvailable()) {
      return null;
    }
    const raw = sessionStorage.getItem(seatKey(code));
    if (raw === null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { playerId?: unknown }).playerId === 'string' &&
        typeof (parsed as { seatNumber?: unknown }).seatNumber === 'number'
      ) {
        return {
          playerId: (parsed as { playerId: string }).playerId,
          seatNumber: (parsed as { seatNumber: number }).seatNumber,
        };
      }
    } catch {
      // Corrupt or hand-edited storage: treat as absent.
    }
    return null;
  },
  clear(code) {
    if (storageAvailable()) {
      sessionStorage.removeItem(seatKey(code));
    }
  },
};

const nameStore = {
  save(name: string) {
    if (storageAvailable()) {
      sessionStorage.setItem(NAME_KEY, name.trim());
    }
  },
  load() {
    if (!storageAvailable()) {
      return null;
    }
    const raw = sessionStorage.getItem(NAME_KEY);
    return raw === null || raw.length === 0 ? null : raw.trim();
  },
};

export function createBrowserStores(): RoomFlowStores {
  return { tokenSink, seatStore, nameStore };
}

// Direct helpers for callers that touch one room at a time.

export function saveReconnectToken(code: string, token: string): void {
  tokenSink.save(code, token);
}

export function loadReconnectToken(code: string): string | null {
  return tokenSink.load(code);
}

export function clearReconnectToken(code: string): void {
  tokenSink.clear(code);
}

export function saveSeat(code: string, seat: { playerId: string; seatNumber: number }): void {
  seatStore.save(code, seat);
}

export function loadSeat(code: string): { playerId: string; seatNumber: number } | null {
  return seatStore.load(code);
}

export function clearSeat(code: string): void {
  seatStore.clear(code);
}

export function saveDisplayName(name: string): void {
  nameStore.save(name);
}

export function loadDisplayName(): string | null {
  return nameStore.load();
}
