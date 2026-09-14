/**
 * Table announcements: short, public-only headlines for challenge outcomes,
 * derived from one motion-cue batch plus the public roster. They explain what
 * the server already resolved; they never reveal compared or guessed values.
 *
 * - Pecera de Cristal: the public PECERA_GUESS_RESOLVED outcome.
 * Conejito duels are presented by the dedicated VS overlay from the public
 * DUEL_RESOLVED outcome.
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

  return null;
}
