/**
 * Textual connection status lines shared by every screen: each transport
 * state is named in words, never color alone.
 */
import type { ConnectionStatus } from '@/lib/room-flow/reducer';

/** Human sentence for a transport state. */
export function connectionLine(status: ConnectionStatus): string {
  switch (status) {
    case 'idle':
      return 'Reach the noticeboard: pin a new room or join with a code.';
    case 'connecting':
      return 'Reaching the game noticeboard…';
    case 'connected':
      return 'Connected.';
    case 'disconnected':
      return 'Connection lost — the board is trying to reach the server again.';
    default:
      return '';
  }
}
