/**
 * Table announcements: short, public-only headlines for challenge outcomes,
 * derived from one motion-cue batch plus the public roster. They explain what
 * the server already resolved; they never reveal compared or guessed values.
 *
 * - Pecera de Cristal: the public PECERA_GUESS_RESOLVED outcome.
 * - Conejito Guerrillero: the played card plus any elimination in the same
 *   batch. No elimination means nobody fell (a tie or no legal target); the
 *   copy says exactly that and nothing more.
 */
import type { PublicGameView } from '@power-hungry-pets/protocol';
import type { MotionCue } from '@/lib/game/motion-cues';

export interface TableAnnouncement {
  tone: 'fail' | 'success' | 'neutral';
  title: string;
  detail: string;
}

function nameOf(view: PublicGameView | null, playerId: string): string {
  return view?.players.find((player) => player.id === playerId)?.name ?? 'Un jugador';
}

export function announcementForBatch(
  cues: readonly MotionCue[] | null | undefined,
  view: PublicGameView | null,
  viewerId: string | null,
): TableAnnouncement | null {
  if (!Array.isArray(cues)) {
    return null;
  }
  const you = (id: string) => id === viewerId;

  const pecera = cues.find(
    (cue): cue is Extract<MotionCue, { kind: 'pecera-resolved' }> => cue.kind === 'pecera-resolved',
  );
  if (pecera !== undefined) {
    const actor = nameOf(view, pecera.actorId);
    const target = nameOf(view, pecera.targetId);
    if (pecera.correct) {
      return {
        tone: 'success',
        title: '¡Adivinó!',
        detail: you(pecera.actorId)
          ? `Acertaste la carta de ${target}.`
          : `${actor} acertó la carta de ${target}.`,
      };
    }
    return {
      tone: 'fail',
      title: '¡Fallido!',
      detail: you(pecera.actorId)
        ? `No adivinaste la carta de ${target}.`
        : `${actor} no adivinó la carta de ${target}.`,
    };
  }

  const duel = cues.find(
    (cue): cue is Extract<MotionCue, { kind: 'card-played' }> =>
      cue.kind === 'card-played' && cue.card.type === 'CONEJITO_GUERRILLERO',
  );
  if (duel !== undefined) {
    const fallen = cues.find(
      (cue): cue is Extract<MotionCue, { kind: 'player-eliminated' }> =>
        cue.kind === 'player-eliminated',
    );
    const actor = nameOf(view, duel.playerId);
    if (fallen === undefined) {
      return {
        tone: 'neutral',
        title: 'Duelo sin víctimas',
        detail: 'Nadie quedó eliminado.',
      };
    }
    if (fallen.playerId === duel.playerId) {
      return {
        tone: 'fail',
        title: '¡Duelo perdido!',
        detail: you(duel.playerId) ? 'Perdiste el duelo.' : `${actor} perdió el duelo.`,
      };
    }
    const loser = nameOf(view, fallen.playerId);
    return {
      tone: you(fallen.playerId) ? 'fail' : 'success',
      title: you(fallen.playerId) ? '¡Duelo perdido!' : '¡Duelo ganado!',
      detail: you(fallen.playerId) ? `${actor} te ganó el duelo.` : `${actor} eliminó a ${loser}.`,
    };
  }
  return null;
}
