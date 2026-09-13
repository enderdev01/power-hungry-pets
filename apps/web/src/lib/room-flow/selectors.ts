/**
 * Lobby selectors: the start button renders purely from these results.
 * Match legality itself stays server-side; these mirror only the published
 * lobby contract (2–6 players, host-only, LOBBY status, live transport).
 */
import { MIN_SEATS_TO_START_MATCH, type RoomSnapshot } from '@power-hungry-pets/protocol';
import type { ConnectionStatus, SeatIdentity } from './reducer';

export type StartBlockReason = 'not-host' | 'min-players' | 'room-status' | 'not-connected';

export interface StartDecision {
  allowed: boolean;
  reason: StartBlockReason | null;
}

/** Evaluates whether the start control may be enabled for this tab. */
export function evaluateStart(
  room: RoomSnapshot | null,
  self: SeatIdentity | null,
  connection: ConnectionStatus,
): StartDecision {
  if (room === null || self === null) {
    return { allowed: false, reason: 'room-status' };
  }
  if (room.hostPlayerId !== self.playerId) {
    return { allowed: false, reason: 'not-host' };
  }
  if (room.status !== 'LOBBY') {
    return { allowed: false, reason: 'room-status' };
  }
  if (room.players.length < MIN_SEATS_TO_START_MATCH) {
    return { allowed: false, reason: 'min-players' };
  }
  if (connection !== 'connected') {
    return { allowed: false, reason: 'not-connected' };
  }
  return { allowed: true, reason: null };
}

/** Human sentence for each block reason, distinct per reason. */
export function startBlockMessage(reason: StartBlockReason): string {
  switch (reason) {
    case 'not-host':
      return 'Only the room host can start the match.';
    case 'min-players':
      return `Waiting for at least ${MIN_SEATS_TO_START_MATCH} players to start.`;
    case 'room-status':
      return 'The match is not waiting in the lobby anymore.';
    case 'not-connected':
      return 'Reconnect before starting the match.';
  }
}
