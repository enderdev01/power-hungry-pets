/**
 * Acknowledgement error handling: every server error code a room-flow client
 * can observe maps to a human sentence and a recovery path. Legality stays
 * server-side; this only explains the server's verdict to the player.
 */
import type { ErrorRecovery } from './reducer';

export interface DescribedAckError {
  sentence: string;
  recovery: ErrorRecovery;
}

const DESCRIPTIONS: Record<string, DescribedAckError> = {
  INVALID_PAYLOAD: {
    sentence: 'El servidor rechazó el formato de la solicitud. Intentá de nuevo.',
    recovery: 'retry',
  },
  INTERNAL_ERROR: {
    sentence: 'Ocurrió un error inesperado en el servidor. Intentá de nuevo.',
    recovery: 'retry',
  },
  RATE_LIMITED: {
    sentence: 'Hubo demasiados intentos de ingreso. Esperá un minuto e intentá de nuevo.',
    recovery: 'retry',
  },
  NOT_IMPLEMENTED: {
    sentence: 'Esa función todavía no está disponible.',
    recovery: 'none',
  },
  ROOM_NOT_FOUND: {
    sentence: 'No existe una sala activa con ese código. Revisalo o creá una sala nueva.',
    recovery: 'edit-input',
  },
  ROOM_FULL: {
    sentence: 'Esa sala ya alcanzó el máximo de 6 jugadores.',
    recovery: 'edit-input',
  },
  DUPLICATE_SOCKET: {
    sentence: 'Esta pestaña ya ocupa un asiento. Salí de la sala actual primero.',
    recovery: 'none',
  },
  INVALID_RECONNECT_TOKEN: {
    sentence: 'No se pudo recuperar tu asiento. Volvé a ingresar a la sala.',
    recovery: 'edit-input',
  },
  INVALID_DISPLAY_NAME: {
    sentence: 'Elegí un nombre de entre 1 y 24 caracteres.',
    recovery: 'edit-input',
  },
  INVALID_ROOM_TRANSITION: {
    sentence: 'Ese movimiento no está permitido en el estado actual de la sala.',
    recovery: 'none',
  },
  NOT_HOST: {
    sentence: 'Solo el anfitrión de la sala puede comenzar la partida.',
    recovery: 'none',
  },
  PLAYER_NOT_FOUND: {
    sentence: 'Tu asiento no pertenece a esta sala.',
    recovery: 'edit-input',
  },
  SOCKET_NOT_BOUND: {
    sentence: 'Esta pestaña perdió su asiento. Volvé a ingresar a la sala.',
    recovery: 'edit-input',
  },
  ROOM_CODE_GENERATION_FAILED: {
    sentence: 'El servidor no pudo generar un código de sala. Intentá de nuevo.',
    recovery: 'retry',
  },
  INVALID_ROOM_CODE: {
    sentence: 'Ese código de sala no es válido.',
    recovery: 'edit-input',
  },
  SESSION_NOT_FOUND: {
    sentence: 'No hay una partida activa para esta sala. Iniciala desde la sala de espera.',
    recovery: 'retry',
  },
  SESSION_ALREADY_EXISTS: {
    sentence: 'Ya hay una partida activa en esta sala.',
    recovery: 'none',
  },
  INVALID_ROOM_STATUS: {
    sentence: 'La sala no está en el estado requerido para esa acción.',
    recovery: 'retry',
  },
  INVALID_ROSTER: {
    sentence: 'La lista de jugadores no es válida para esa acción.',
    recovery: 'retry',
  },
  INVALID_SEED: {
    sentence: 'El servidor no pudo iniciar la partida. Intentá de nuevo.',
    recovery: 'retry',
  },
  ACTOR_NOT_AUTHENTICATED: {
    sentence: 'Esta pestaña no está autorizada para esa acción.',
    recovery: 'edit-input',
  },
  ENGINE_REJECTED: {
    sentence: 'Las reglas del juego rechazaron ese movimiento.',
    recovery: 'none',
  },
  NO_ACTIVE_ROUND: {
    sentence: 'No hay una ronda activa en este momento.',
    recovery: 'none',
  },
  UNKNOWN_EVENT_TYPE: {
    sentence: 'El servidor rechazó un tipo de evento desconocido.',
    recovery: 'retry',
  },
  UNKNOWN_PUBLIC_EVENT: {
    sentence: 'El servidor rechazó un evento de juego inválido.',
    recovery: 'retry',
  },
  PLAYER_NOT_IN_GAME: {
    sentence: 'Tu asiento no forma parte de la partida activa.',
    recovery: 'edit-input',
  },
  UNKNOWN_PENDING_INTERACTION: {
    sentence: 'La decisión pendiente ya no está disponible.',
    recovery: 'retry',
  },
};

/** Maps a stable server error code to a human sentence and recovery path. */
export function describeAckError(code: string): DescribedAckError {
  return (
    DESCRIPTIONS[code] ?? {
      sentence: `El servidor rechazó la solicitud (${code}). Intentá de nuevo.`,
      recovery: 'retry',
    }
  );
}
