import type { CardInstance, CardType } from './models';

export interface CardDefinition {
  type: CardType;
  value: number;
  name: string;
  quantity: number;
  assetKey: string;
}

export const CARD_CATALOG: readonly CardDefinition[] = [
  {
    type: 'ROBOT_ASPIRADOR_REAL',
    value: 0,
    name: 'Robot Aspirador Real',
    quantity: 1,
    assetKey: 'card-0',
  },
  {
    type: 'PECERA_DE_CRISTAL',
    value: 1,
    name: 'Pecera de Cristal',
    quantity: 5,
    assetKey: 'card-1',
  },
  { type: 'RATON_TRAMPERO', value: 2, name: 'Ratón Trampero', quantity: 3, assetKey: 'card-2' },
  {
    type: 'CONEJITO_GUERRILLERO',
    value: 3,
    name: 'Conejito Guerrillero',
    quantity: 3,
    assetKey: 'card-3',
  },
  {
    type: 'CAPARAZON_ARMAZON',
    value: 4,
    name: 'Caparazón Armazón',
    quantity: 2,
    assetKey: 'card-4',
  },
  {
    type: 'SERPIENTE_ENCANTADORA',
    value: 5,
    name: 'Serpiente Encantadora',
    quantity: 2,
    assetKey: 'card-5',
  },
  {
    type: 'SAQUEADOG_DE_TUMBAS',
    value: 6,
    name: 'Saqueadog de Tumbas',
    quantity: 1,
    assetKey: 'card-6',
  },
  {
    type: 'MALABARISTA_DE_OCHO_PATAS',
    value: 7,
    name: 'Malabarista de Ocho Patas',
    quantity: 1,
    assetKey: 'card-7',
  },
  {
    type: 'ERMITANO_BUSCA_CASA',
    value: 8,
    name: 'Ermitaño Busca Casa',
    quantity: 1,
    assetKey: 'card-8',
  },
  {
    type: 'NO_SOY_UNA_MASCOTA',
    value: 9,
    name: '¡No soy una mascota!',
    quantity: 1,
    assetKey: 'card-9',
  },
  { type: 'REY_GATO', value: 10, name: 'Rey Gato', quantity: 1, assetKey: 'card-10' },
];

export function createDeck(): CardInstance[] {
  return CARD_CATALOG.flatMap((definition) =>
    Array.from({ length: definition.quantity }, (_, copyIndex) => ({
      instanceId: `card-${definition.value}-${copyIndex + 1}`,
      value: definition.value,
      type: definition.type,
    })),
  );
}
