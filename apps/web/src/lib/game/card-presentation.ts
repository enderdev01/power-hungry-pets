/**
 * Card presentation catalog (M7 placeholder boundary): stable, display-only
 * metadata for every card type — canonical name, effect summary, and stable
 * asset key. Presentation is metadata only; no rule logic lives here, and no
 * image URL, texture, or branded asset is referenced.
 */
import type { CardType, PublicCard } from '@power-hungry-pets/protocol';

/** Display metadata for one card type. */
export interface CardPresentation {
  /** The card's canonical catalog name. */
  name: string;
  /** One-sentence human summary of the card's effect. */
  effectSummary: string;
  /** Stable, filesystem-safe asset key derived from the card type. */
  artKey: string;
  /** The card's canonical type. */
  cardType: CardType;
  /** The card's printed value, carried through unchanged. */
  value: number;
}

interface PresentationDefinition {
  /** The card's canonical printed value (catalog numbering 0-10). */
  value: number;
  name: string;
  effectSummary: string;
}

/**
 * Canonical catalog ordering by printed value 0-10, mirroring the engine's
 * card catalog names (docs/03_CARD_CATALOG.md).
 */
const PRESENTATIONS: readonly (PresentationDefinition & { type: CardType })[] = [
  {
    type: 'ROBOT_ASPIRADOR_REAL',
    value: 0,
    name: 'Robot Aspirador Real',
    effectSummary: 'Defeats a Rey Gato holder in the end-of-round comparison.',
  },
  {
    type: 'PECERA_DE_CRISTAL',
    value: 1,
    name: 'Pecera de Cristal',
    effectSummary: 'Guess another player’s hand value; a correct guess eliminates them.',
  },
  {
    type: 'RATON_TRAMPERO',
    value: 2,
    name: 'Ratón Trampero',
    effectSummary: 'Secretly peek at the draw pile’s top card and reinsert it anywhere.',
  },
  {
    type: 'CONEJITO_GUERRILLERO',
    value: 3,
    name: 'Conejito Guerrillero',
    effectSummary: 'Compare hands with another player; the lower value is eliminated.',
  },
  {
    type: 'CAPARAZON_ARMAZON',
    value: 4,
    name: 'Caparazón Armazón',
    effectSummary: 'Protect yourself from targeted effects until your next turn.',
  },
  {
    type: 'SERPIENTE_ENCANTADORA',
    value: 5,
    name: 'Serpiente Encantadora',
    effectSummary: 'Force another player to reveal their hand card face up and redraw.',
  },
  {
    type: 'SAQUEADOG_DE_TUMBAS',
    value: 6,
    name: 'Saqueadog de Tumbas',
    effectSummary: 'Peek at the hidden card and optionally swap it with your hand.',
  },
  {
    type: 'MALABARISTA_DE_OCHO_PATAS',
    value: 7,
    name: 'Malabarista de Ocho Patas',
    effectSummary: 'Everyone returns their hand to the draw pile and draws a fresh card.',
  },
  {
    type: 'ERMITANO_BUSCA_CASA',
    value: 8,
    name: 'Ermitaño Busca Casa',
    effectSummary: 'Swap your hand card with another player’s, both unrevealed.',
  },
  {
    type: 'NO_SOY_UNA_MASCOTA',
    value: 9,
    name: '¡No soy una mascota!',
    effectSummary: 'Force a Rey Gato holder to trade it for the card in your hand.',
  },
  {
    type: 'REY_GATO',
    value: 10,
    name: 'Rey Gato',
    effectSummary: 'Eliminates its holder the moment it is placed face up.',
  },
];

const BY_TYPE = new Map<CardType, PresentationDefinition>(
  PRESENTATIONS.map((definition) => [definition.type, definition]),
);

/** Kebab-cases a card type: `REY_GATO` → `rey-gato`. */
function artKeyFor(cardType: CardType): string {
  return `card/${cardType.toLowerCase().replaceAll('_', '-')}`;
}

/** Returns the stable display metadata for one public card. */
export function cardPresentation(card: PublicCard): CardPresentation {
  const definition = BY_TYPE.get(card.type);
  // The catalog is exhaustive over CardType; an unknown type is a contract
  // drift that must surface loudly instead of rendering an invented card.
  if (definition === undefined) {
    throw new Error(`No presentation metadata for card type "${card.type}".`);
  }
  return {
    name: definition.name,
    effectSummary: definition.effectSummary,
    artKey: artKeyFor(card.type),
    cardType: card.type,
    value: definition.value,
  };
}
