/**
 * Asset resolver seam (M7 placeholder boundary): maps a stable art key to its
 * concrete art. The shipped M7 default config maps nothing — every key
 * resolves to "no image / placeholder" — so no final art, image URL, texture,
 * or branded asset can leak into the build. A later milestone fills the
 * config without code changes.
 */
/** The resolved art for one key: either a configured image or the placeholder. */
export type ResolvedCardArt =
  { kind: 'none'; alt: string } | { kind: 'image'; src: string; alt: string };

/** Art mapping table: stable art key → image source. */
export interface CardAssetConfig {
  images: Record<string, string>;
}

/**
 * The shipped M7 default: an intentionally empty mapping. Every key resolves
 * to the placeholder; no URL or branded reference ships with this config.
 */
export const M7_PLACEHOLDER_ASSET_CONFIG: CardAssetConfig = {
  images: {},
};

/** Human alt text for a card art key's placeholder or image. */
function altFor(artKey: string): string {
  const name = artKey.startsWith('card/') ? artKey.slice('card/'.length) : artKey;
  return `Illustration for ${name.replaceAll('-', ' ')}`;
}

/**
 * Resolves one art key against a config. Unknown keys and unmapped keys fail
 * closed to the placeholder — never to a guessed URL.
 */
export function resolveCardArt(
  artKey: string,
  config: CardAssetConfig = M7_PLACEHOLDER_ASSET_CONFIG,
): ResolvedCardArt {
  const src = config.images[artKey];
  if (typeof src === 'string' && src.trim() !== '') {
    return { kind: 'image', src, alt: altFor(artKey) };
  }
  return { kind: 'none', alt: altFor(artKey) };
}
