import type { CardAssetConfig } from '@/lib/game/asset-resolver';
import { resolveCardArt } from '@/lib/game/asset-resolver';
import { cardPresentation } from '@/lib/game/card-presentation';
import type { PublicCard } from '@power-hungry-pets/protocol';

interface FaceUpCardPlaceholderProps {
  card: PublicCard;
  faceDown?: false;
  showEffect?: boolean;
  assetConfig?: CardAssetConfig;
  label?: string;
}

interface FaceDownCardPlaceholderProps {
  card?: never;
  faceDown: true;
  showEffect?: false;
  assetConfig?: never;
  label: string;
}

type CardPlaceholderProps = FaceUpCardPlaceholderProps | FaceDownCardPlaceholderProps;

/**
 * Visual-only card shell for M7. Geometry and imagery are intentionally
 * provisional; stable art keys and semantic CSS hooks let M8 replace both.
 */
export function CardPlaceholder(props: CardPlaceholderProps) {
  if (props.faceDown) {
    return (
      <span
        className="game-card-placeholder game-card-placeholder-back"
        data-visual-placeholder="card-back"
        role="img"
        aria-label={props.label}
      >
        <span aria-hidden="true">Face down</span>
      </span>
    );
  }

  const presentation = cardPresentation(props.card);
  const art = resolveCardArt(presentation.artKey, props.assetConfig);

  return (
    <article
      className="game-card-placeholder"
      data-visual-placeholder="card"
      data-art-key={presentation.artKey}
      data-art-kind={art.kind}
      aria-label={props.label ?? `${presentation.name}, value ${props.card.value}`}
    >
      <div className="game-card-art" data-asset-slot={presentation.artKey} aria-hidden="true">
        {art.kind === 'image' ? (
          // The source is supplied by a future asset configuration, never game state.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art.src} alt="" />
        ) : (
          <span>Artwork placeholder</span>
        )}
      </div>
      <span className="game-card-value">{props.card.value}</span>
      <span className="game-card-name">{presentation.name}</span>
      {props.showEffect && <p className="game-card-effect">{presentation.effectSummary}</p>}
    </article>
  );
}
