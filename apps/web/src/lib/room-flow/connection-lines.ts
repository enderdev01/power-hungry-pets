/**
 * Textual connection status lines shared by every screen: each transport
 * state is named in words, never color alone.
 */
import type { ConnectionStatus } from '@/lib/room-flow/reducer';

/** Human sentence for a transport state. */
export function connectionLine(status: ConnectionStatus): string {
  switch (status) {
    case 'idle':
      return 'Accedé al tablero: creá una sala o ingresá con un código.';
    case 'connecting':
      return 'Conectando con el tablero de juego…';
    case 'connected':
      return 'Conectado.';
    case 'disconnected':
      return 'Se perdió la conexión. El tablero está intentando reconectarse al servidor.';
    default:
      return '';
  }
}
