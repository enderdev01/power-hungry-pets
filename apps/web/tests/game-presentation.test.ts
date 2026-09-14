/**
 * Card presentation catalog and asset resolver seam (M7 placeholder boundary):
 * every card type must resolve to stable presentation metadata — name, effect
 * summary, stable asset key — and the M7 default resolver must resolve every
 * asset key to "no image / placeholder" without any hardcoded URL, import, or
 * branded asset. Presentation is metadata only; no rule logic lives here.
 */
import type { CardType } from '@power-hungry-pets/protocol';
import { cardPresentation } from '@/lib/game/card-presentation';
import {
  M7_PLACEHOLDER_ASSET_CONFIG,
  resolveCardArt,
  type CardAssetConfig,
} from '@/lib/game/asset-resolver';
import { CARD_BACK_ART_KEY, TABLETOP_ASSET_CONFIG } from '@/lib/game/card-assets';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ALL_CARD_TYPES: CardType[] = [
  'ROBOT_ASPIRADOR_REAL',
  'PECERA_DE_CRISTAL',
  'RATON_TRAMPERO',
  'CONEJITO_GUERRILLERO',
  'CAPARAZON_ARMAZON',
  'SERPIENTE_ENCANTADORA',
  'SAQUEADOG_DE_TUMBAS',
  'MALABARISTA_DE_OCHO_PATAS',
  'ERMITANO_BUSCA_CASA',
  'NO_SOY_UNA_MASCOTA',
  'REY_GATO',
];

describe('card presentation catalog', () => {
  it('covers every card type with nonempty presentation metadata', () => {
    for (const cardType of ALL_CARD_TYPES) {
      const presentation = cardPresentation({ type: cardType, value: 1 });
      expect(presentation.name.trim()).not.toBe('');
      expect(presentation.effectSummary.trim()).not.toBe('');
      expect(presentation.artKey.trim()).not.toBe('');
      expect(presentation.cardType).toBe(cardType);
    }
  });

  it('uses the canonical card names from the card catalog', () => {
    expect(cardPresentation({ type: 'REY_GATO', value: 10 }).name).toBe('Rey Gato');
    expect(cardPresentation({ type: 'PECERA_DE_CRISTAL', value: 1 }).name).toBe(
      'Pecera de Cristal',
    );
    expect(cardPresentation({ type: 'NO_SOY_UNA_MASCOTA', value: 9 }).name).toBe(
      '¡No soy una mascota!',
    );
    expect(cardPresentation({ type: 'ROBOT_ASPIRADOR_REAL', value: 0 }).name).toBe(
      'Robot Aspirador Real',
    );
    expect(cardPresentation({ type: 'MALABARISTA_DE_OCHO_PATAS', value: 7 }).name).toBe(
      'Malabarista de Ocho Patas',
    );
  });

  it('carries the card value through unchanged', () => {
    expect(cardPresentation({ type: 'REY_GATO', value: 10 }).value).toBe(10);
    expect(cardPresentation({ type: 'ROBOT_ASPIRADOR_REAL', value: 0 }).value).toBe(0);
  });

  it('derives stable, unique asset keys keyed by card type', () => {
    const keys = new Set<string>();
    const expectedByValue = new Map<number, string>();
    for (const cardType of ALL_CARD_TYPES) {
      const artKey = cardPresentation({ type: cardType, value: 1 }).artKey;
      expect(artKey).toMatch(/^card\/[a-z0-9-]+$/);
      expect(keys.has(artKey)).toBe(false);
      keys.add(artKey);
      expectedByValue.set(cardPresentation({ type: cardType, value: 1 }).value, artKey);
    }
    expect(keys.size).toBe(ALL_CARD_TYPES.length);
    // Stable spot checks against the catalog's value numbering.
    expect(expectedByValue.get(0)).toBe('card/robot-aspirador-real');
    expect(expectedByValue.get(10)).toBe('card/rey-gato');
  });

  it('is stable across repeated reads (pure metadata, no rule logic)', () => {
    const first = cardPresentation({ type: 'CAPARAZON_ARMAZON', value: 4 });
    const second = cardPresentation({ type: 'CAPARAZON_ARMAZON', value: 4 });
    expect(first).toEqual({ ...second, value: 4 });
  });
});

describe('M7 asset resolver seam', () => {
  it('resolves every card art key to no image under the default M7 config', () => {
    for (const cardType of ALL_CARD_TYPES) {
      const art = resolveCardArt(cardPresentation({ type: cardType, value: 1 }).artKey);
      expect(art.kind).toBe('none');
      expect('src' in art).toBe(false);
      expect(art.alt.trim()).not.toBe('');
    }
  });

  it('resolves arbitrary unknown keys to no image as well', () => {
    expect(resolveCardArt('some/future-asset').kind).toBe('none');
  });

  it('never leaks a URL or branded reference through the placeholder result', () => {
    const serialized = JSON.stringify(
      resolveCardArt(cardPresentation({ type: 'PECERA_DE_CRISTAL', value: 1 }).artKey),
    );
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/\.(png|jpe?g|webp|svg|gif|avif)\b/i);
  });

  it('exposes a config seam that a later milestone can fill without code changes', () => {
    const configured: CardAssetConfig = {
      images: { 'card/rey-gato': 'https://example.test/rey-gato.webp' },
    };
    const resolved = resolveCardArt('card/rey-gato', configured);
    expect(resolved.kind).toBe('image');
    if (resolved.kind === 'image') {
      expect(resolved.src).toBe('https://example.test/rey-gato.webp');
      expect(resolved.alt.trim()).not.toBe('');
    }
    // Unmapped keys keep resolving to the placeholder.
    expect(resolveCardArt('card/rey-gato', M7_PLACEHOLDER_ASSET_CONFIG).kind).toBe('none');
  });

  it('never maps a key in the shipped M7 default config', () => {
    expect(Object.keys(M7_PLACEHOLDER_ASSET_CONFIG.images)).toEqual([]);
  });
});

describe('tabletop card asset mapping', () => {
  it('maps every card type and the shared back to an existing web asset', () => {
    const keys = [
      ...ALL_CARD_TYPES.map((type) => cardPresentation({ type, value: 0 }).artKey),
      CARD_BACK_ART_KEY,
    ];
    for (const key of keys) {
      const art = resolveCardArt(key, TABLETOP_ASSET_CONFIG);
      expect(art.kind).toBe('image');
      if (art.kind === 'image') {
        expect(existsSync(join(__dirname, '..', 'public', art.src))).toBe(true);
      }
    }
    // One distinct file per key: no card silently reuses another card's art.
    expect(new Set(keys.map((key) => TABLETOP_ASSET_CONFIG.images[key])).size).toBe(keys.length);
  });

  it('keeps the mapping outside game logic: unknown keys still fail closed', () => {
    expect(resolveCardArt('card/unknown', TABLETOP_ASSET_CONFIG).kind).toBe('none');
  });
});
