/**
 * Tabletop layout helpers: pure, presentation-only derivations from the
 * public projection. Nothing here decides legality or reads private state.
 *
 * - The shared discard pile: the protocol publishes discards per player with
 *   no global order, so the pile keeps a client-side arrival order. Cards
 *   already on the table when the view is first seen are interleaved by turn
 *   order (a stable approximation); every later card goes on top as it
 *   arrives.
 * - Seat slots: where each seat sits around the table, rotated so the viewer
 *   is always at the bottom.
 */
import type { PublicDiscardView, PublicGameView } from '@power-hungry-pets/protocol';

/** Stable identity of one public discard: `<playerId>#<index>`. */
export type PileKey = string;

export interface PileCard {
  key: PileKey;
  playerId: string;
  playerName: string;
  discard: PublicDiscardView;
}

function keyOf(playerId: string, index: number): PileKey {
  return `${playerId}#${index}`;
}

function seatOrder(view: PublicGameView): string[] {
  const listed = view.players.map((player) => player.id);
  const turnOrder = view.round?.turnOrder ?? [];
  const ordered = turnOrder.filter((id) => listed.includes(id));
  return [...ordered, ...listed.filter((id) => !ordered.includes(id))];
}

/**
 * Advances the pile arrival order against a new projection. Keys that still
 * exist keep their position; new keys are appended (interleaved by turn order
 * when several arrive together); keys that vanished (a new round) are
 * dropped. Returns the previous array when nothing changed.
 */
export function nextPileOrder(
  previous: readonly PileKey[],
  view: PublicGameView | null,
): PileKey[] {
  if (view === null) {
    return previous.length === 0 ? (previous as PileKey[]) : [];
  }
  const byId = new Map(view.players.map((player) => [player.id, player]));
  const present = new Set<PileKey>();
  for (const player of view.players) {
    player.discards.forEach((_, index) => present.add(keyOf(player.id, index)));
  }
  const kept = previous.filter((key) => present.has(key));
  const known = new Set(kept);
  const additions: PileKey[] = [];
  const order = seatOrder(view);
  const depth = Math.max(0, ...view.players.map((player) => player.discards.length));
  for (let index = 0; index < depth; index += 1) {
    for (const id of order) {
      const player = byId.get(id);
      if (player !== undefined && index < player.discards.length) {
        const key = keyOf(id, index);
        if (!known.has(key)) {
          additions.push(key);
        }
      }
    }
  }
  if (additions.length === 0 && kept.length === previous.length) {
    return previous as PileKey[];
  }
  // Within one projection, effects resolve after the card that caused them:
  // a card forced face up (Serpiente) or revealed by elimination lands on top
  // of the played card that produced it.
  const originOf = (key: PileKey) => {
    const hash = key.lastIndexOf('#');
    return byId.get(key.slice(0, hash))?.discards[Number(key.slice(hash + 1))]?.origin;
  };
  const played = additions.filter((key) => originOf(key) === 'PLAYED');
  const effects = additions.filter((key) => originOf(key) !== 'PLAYED');
  return [...kept, ...played, ...effects];
}

/** Resolves pile keys to the projection's own public discards, in order. */
export function pileCards(order: readonly PileKey[], view: PublicGameView | null): PileCard[] {
  if (view === null) {
    return [];
  }
  const byId = new Map(view.players.map((player) => [player.id, player]));
  const cards: PileCard[] = [];
  for (const key of order) {
    const hash = key.lastIndexOf('#');
    const player = byId.get(key.slice(0, hash));
    const discard = player?.discards[Number(key.slice(hash + 1))];
    if (player !== undefined && discard !== undefined) {
      cards.push({ key, playerId: player.id, playerName: player.name, discard });
    }
  }
  return cards;
}

/** Deterministic resting tilt for one pile card, so cards look tossed. */
export function pileTilt(key: PileKey): { rotate: number; x: number; y: number } {
  let hash = 7;
  for (const ch of key) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 10007;
  }
  return {
    rotate: (hash % 25) - 12,
    x: ((hash >> 3) % 13) - 6,
    y: ((hash >> 6) % 9) - 4,
  };
}

export type SeatSlot = 'bottom' | 'left' | 'top-left' | 'top' | 'top-right' | 'right';

const OPPONENT_SLOTS: Record<number, SeatSlot[]> = {
  0: [],
  1: ['top'],
  2: ['left', 'right'],
  3: ['left', 'top', 'right'],
  4: ['left', 'top-left', 'top-right', 'right'],
  5: ['left', 'top-left', 'top', 'top-right', 'right'],
};

/**
 * Seat slot per player id: the viewer sits at the bottom and the others
 * follow turn order clockwise (left → top → right). A spectator-less table
 * without a viewer seats everyone around the top.
 */
export function seatSlots(view: PublicGameView, viewerId: string | null): Record<string, SeatSlot> {
  const order = seatOrder(view);
  const viewerIndex = viewerId === null ? -1 : order.indexOf(viewerId);
  const rotated =
    viewerIndex < 0 ? order : [...order.slice(viewerIndex + 1), ...order.slice(0, viewerIndex)];
  const slots = OPPONENT_SLOTS[Math.min(rotated.length, 5)] ?? OPPONENT_SLOTS[5]!;
  const result: Record<string, SeatSlot> = {};
  rotated.slice(0, slots.length).forEach((id, index) => {
    result[id] = slots[index]!;
  });
  if (viewerIndex >= 0) {
    result[viewerId as string] = 'bottom';
  }
  return result;
}
