import type { CardAssetConfig } from '@/lib/game/asset-resolver';
import { resolveCardArt } from '@/lib/game/asset-resolver';
import { CARD_BACK_ART_KEY } from '@/lib/game/card-assets';
import { cardPresentation } from '@/lib/game/card-presentation';
import type { PublicCard } from '@power-hungry-pets/protocol';

interface FaceUpCardPlaceholderProps {
  card: PublicCard;
  faceDown?: false;
  showEffect?: boolean;
  assetConfig?: CardAssetConfig;
  label?: string;
  /**
   * Visible textual origin stamp for public discard shells (M8). Only forced
   * and elimination-reveal discards carry one; private surfaces never do.
   */
  originLabel?: string;
  /**
   * One-shot motion hook (M8): only already-public face-up shells accept it.
   * The kind selects the CSS keyframes; the sequence stamps the batch identity
   * so a keyed remount replays the animation exactly once per batch.
   */
  motion?: { kind: string; sequence: string | number };
}

interface FaceDownCardPlaceholderProps {
  card?: never;
  faceDown: true;
  showEffect?: false;
  /** Resolves only the identity-free shared back art key. */
  assetConfig?: CardAssetConfig;
  label: string;
}

type CardPlaceholderProps = FaceUpCardPlaceholderProps | FaceDownCardPlaceholderProps;

/**
 * Card surface for the digital tabletop. When the asset config maps the
 * card's stable art key, the canonical card art is the whole face: value,
 * name, and effect are printed on the art itself, so the textual metadata
 * stays in the DOM for assistive technology but is visually hidden. HTML/CSS
 * only adds state overlays (origin ribbon, shadows, motion). Without a
 * mapping the card falls back to the CSS-only placeholder face. The back
 * resolves the shared, identity-free back key the same way.
 */
export function CardPlaceholder(props: CardPlaceholderProps) {
  if (props.faceDown) {
    const back = resolveCardArt(CARD_BACK_ART_KEY, props.assetConfig);
    return (
      <span
        className="game-card-placeholder game-card-placeholder-back"
        data-visual-placeholder="card-back"
        data-art-kind={back.kind}
        role="img"
        aria-label={props.label}
      >
        {back.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="game-card-image" src={back.src} alt="" draggable={false} />
        )}
        <span className="game-card-back-stamp" aria-hidden="true">
          <span className="game-card-back-frame" aria-hidden="true" />
          <span className="game-card-back-word">Boca abajo</span>
        </span>
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
      data-card-value={props.card.value}
      data-motion={props.motion?.kind}
      data-motion-sequence={props.motion?.sequence}
      aria-label={props.label ?? `${presentation.name}, valor ${props.card.value}`}
    >
      <div className="game-card-art" data-asset-slot={presentation.artKey} aria-hidden="true">
        {art.kind === 'image' ? (
          // The source comes from the asset configuration, never game state.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="game-card-image" src={art.src} alt="" draggable={false} />
        ) : (
          <span className="game-card-art-stamp" aria-hidden="true">
            <span className="game-card-art-mark" aria-hidden="true" />
            Ilustración provisoria
          </span>
        )}
      </div>
      <span className="game-card-value">{props.card.value}</span>
      <span className="game-card-name">{presentation.name}</span>
      {props.originLabel !== undefined && (
        <span className="game-card-origin">{props.originLabel}</span>
      )}
      {props.showEffect && <p className="game-card-effect">{presentation.effectSummary}</p>}
    </article>
  );
}
