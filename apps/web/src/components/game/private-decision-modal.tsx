'use client';

/**
 * Private decision modal (WU8): the mandatory, centered decision surface for a
 * viewer-matching pending interaction. The table stays visible but inert behind
 * it; focus is trapped inside; Escape and outside clicks never close it; and
 * focus returns to gameplay when the decision resolves. There is no cancel
 * path: the server's pending interaction must be answered. When the server
 * advances the mandatory decision in place (e.g. PECERA_TARGET → PECERA_GUESS),
 * the new stage's first control takes focus immediately while the original
 * pre-modal focus stays reserved for final restoration.
 *
 * Every rendered choice comes from the pure pending-decision selector, which
 * derives it exclusively from the server's private projection — this component
 * never invents a value, a target, or a control. A failed decision command is
 * surfaced as a live alert inside the modal, because the table behind it is
 * inert and could not deliver the message.
 */
import { useEffect, useRef } from 'react';
import { CardPlaceholder } from '@/components/game/card-placeholder';
import { resolveCardArt, type CardAssetConfig } from '@/lib/game/asset-resolver';
import type { PendingDecisionModel } from '@/lib/game/pending-decision';
import { CARD_VALUES, cardPresentation } from '@/lib/game/card-presentation';
import type { FlowError } from '@/lib/room-flow/reducer';
import type { CardType, GameCardInstance } from '@power-hungry-pets/protocol';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * A stable signature of the active decision stage: an in-place stage change
 * (or a changed option set within one stage) re-runs the focus effect, while
 * same-stage rerenders do not.
 */
function stageKeyOf(decision: PendingDecisionModel): string {
  switch (decision.kind) {
    case 'choose-target':
      return `choose-target:${decision.targets.map((target) => target.targetId).join('|')}`;
    case 'submit-guess':
      return `submit-guess:${decision.targetId}:${decision.values.join('|')}`;
    case 'choose-hidden-swap':
      return `choose-hidden-swap:${decision.keepAllowed}:${decision.swapAllowed}`;
    case 'choose-deck-position':
      return `choose-deck-position:${decision.positions.join('|')}`;
    default:
      return decision.kind;
  }
}

function decisionTitle(decision: PendingDecisionModel): string {
  switch (decision.kind) {
    case 'choose-target':
      return 'Pecera de Cristal — elegí un objetivo';
    case 'submit-guess':
      return 'Pecera de Cristal — elegí tu apuesta';
    case 'choose-hidden-swap':
      return 'Saqueadog de Tumbas — la carta oculta';
    case 'choose-deck-position':
      return 'Ratón Trampero — elegí dónde reinsertar la carta';
    case 'unavailable':
      return 'Decisión no disponible';
    default:
      return 'Decisión';
  }
}

/**
 * The already-public card whose effect opened the decision. Its identity was
 * revealed when it was played, so the emblem leaks nothing private.
 */
function decisionSourceCard(decision: PendingDecisionModel): CardType | null {
  switch (decision.kind) {
    case 'choose-target':
    case 'submit-guess':
      return 'PECERA_DE_CRISTAL';
    case 'choose-hidden-swap':
      return 'SAQUEADOG_DE_TUMBAS';
    case 'choose-deck-position':
      return 'RATON_TRAMPERO';
    default:
      return null;
  }
}

function positionLabel(index: number, positions: number[]): string {
  if (positions.length === 1) {
    return 'Parte superior del mazo';
  }
  if (index === 0) {
    return 'Parte superior del mazo';
  }
  if (index === Math.max(...positions)) {
    return 'Parte inferior del mazo';
  }
  return `Posición ${index}`;
}

interface PrivateDecisionModalProps {
  /** The selector-derived decision; `none` renders nothing. */
  decision: PendingDecisionModel;
  /** The viewer's own hand, shown privately beside the Saqueadog hidden card. */
  hand: GameCardInstance[] | null;
  /** Card art mapping; the modal resolves art exactly like the table. */
  assetConfig?: CardAssetConfig;
  /** True while a command is in flight; every choice disables textually. */
  busy: boolean;
  onChooseTarget: (targetId: string) => void;
  onSubmitGuess: (value: number) => void;
  onChooseHiddenSwap: (swap: boolean) => void;
  onChooseDeckPosition: (index: number) => void;
  /**
   * The game-table container focus falls back to when the element focused
   * before the modal opened no longer exists when the decision resolves.
   */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * The table's current command failure, mirrored inside the modal while the
   * table is inert; null or absent renders nothing.
   */
  error?: FlowError | null;
  /** Replays the failed attempt; rendered only when the error supports retry. */
  onRetry?: () => void;
}

export function PrivateDecisionModal({
  decision,
  hand,
  assetConfig,
  busy,
  onChooseTarget,
  onSubmitGuess,
  onChooseHiddenSwap,
  onChooseDeckPosition,
  restoreFocusRef,
  error,
  onRetry,
}: PrivateDecisionModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Mount-only effect: capture the pre-modal focus exactly once (it must
  // survive in-place stage changes) and own the mandatory-contract key handling
  // for the modal's whole lifetime.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        // Escape must not close a mandatory decision.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const container = dialogRef.current;
      if (container === null) {
        return;
      }
      const focusables = focusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active !== null && container.contains(active);
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Focus restoration: the element focused before the modal opened, or the
      // first live gameplay control inside the table, or the table itself.
      // `document.body` is never a meaningful gameplay element: it means focus
      // was already loose (or the trigger unmounted with the old projection),
      // so the table fallback must apply instead.
      const previous = previousFocusRef.current;
      if (previous !== null && previous !== document.body && previous.isConnected) {
        previous.focus();
        return;
      }
      const container = restoreFocusRef?.current;
      if (container !== null && container !== undefined) {
        const [first] = focusableElements(container);
        (first ?? container).focus();
      }
    };
    // The modal's lifetime is exactly one pending interaction; the key contract
    // never changes while it is open.
  }, []);

  // Focus follows the active decision stage: on mount and again whenever the
  // mandatory decision changes in place (e.g. PECERA_TARGET → PECERA_GUESS),
  // the new stage's first control takes focus immediately. The pre-modal focus
  // captured above is never overwritten here, so final restoration still
  // returns to the element the viewer held before the modal opened — never to
  // the inert table between stages.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const [first] = focusableElements(dialog);
    (first ?? dialog).focus();
  }, [stageKeyOf(decision)]);

  if (decision.kind === 'none') {
    return null;
  }

  const title = decisionTitle(decision);
  const sourceType = decisionSourceCard(decision);
  const sourceArt =
    sourceType === null
      ? null
      : resolveCardArt(cardPresentation({ type: sourceType, value: 0 }).artKey, assetConfig);

  return (
    <div
      className="game-modal-overlay"
      data-testid="private-decision-overlay"
      // Outside clicks never cancel a mandatory decision: the overlay is inert.
      onClick={(event) => event.preventDefault()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="private-decision-title"
        className="game-modal"
        data-decision={decision.kind}
        tabIndex={-1}
      >
        <header className="game-modal-header">
          {sourceArt !== null && (
            <span className="game-modal-emblem" data-art-kind={sourceArt.kind} aria-hidden="true">
              {sourceArt.kind === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="game-card-image" src={sourceArt.src} alt="" draggable={false} />
              )}
            </span>
          )}
          <span className="game-modal-kicker" aria-hidden="true">
            Decisión privada
          </span>
          <h2 id="private-decision-title" className="game-modal-title">
            {title}
          </h2>
        </header>

        {error !== null && error !== undefined && (
          <div className="game-modal-error" role="alert">
            <p className="game-error-sentence">{error.sentence}</p>
            {error.recovery === 'retry' && onRetry !== undefined && (
              <button type="button" className="action-button" onClick={onRetry}>
                Intentar de nuevo
              </button>
            )}
          </div>
        )}

        {decision.kind === 'unavailable' && (
          <p className="game-modal-status" role="status">
            Esperando la confirmación del servidor. Tu decisión aparecerá acá en cuanto la mesa esté
            lista.
          </p>
        )}

        {decision.kind === 'choose-target' && (
          <>
            <p className="game-modal-copy">¿Qué mano querés mirar?</p>
            <div className="game-decision-controls">
              {decision.targets.map((target) => (
                <button
                  key={target.targetId}
                  type="button"
                  className="action-button game-decision-button"
                  disabled={busy}
                  onClick={() => onChooseTarget(target.targetId)}
                >
                  {`Elegir a ${target.name}`}
                </button>
              ))}
            </div>
          </>
        )}

        {decision.kind === 'submit-guess' && (
          <>
            <p className="game-modal-copy">
              {decision.targetName === null
                ? 'Elegí el valor que querés apostar.'
                : `Estás apostando el valor de la mano de ${decision.targetName}.`}
            </p>
            <div className="game-decision-controls game-decision-values">
              {/* Only server-published values are buttons. Other catalog values
                  render as inert, labelled tiles so the value grid keeps its
                  shape; they never become choices. */}
              {CARD_VALUES.map((value) =>
                decision.values.includes(value) ? (
                  <button
                    key={value}
                    type="button"
                    className="action-button game-decision-button game-decision-value"
                    disabled={busy}
                    onClick={() => onSubmitGuess(value)}
                  >
                    <span className="game-decision-value-number" aria-hidden="true">
                      {value}
                    </span>
                    <span className="game-decision-value-verb">{`Apostar ${value}`}</span>
                  </button>
                ) : (
                  <span key={value} className="game-decision-value-unavailable">
                    <span className="game-decision-value-number" aria-hidden="true">
                      {value}
                    </span>
                    <span className="game-decision-value-verb">{`${value} no disponible`}</span>
                  </span>
                ),
              )}
            </div>
          </>
        )}

        {decision.kind === 'choose-hidden-swap' && (
          <>
            <p className="game-modal-copy">Solo vos podés ver la carta oculta.</p>
            <div className="game-modal-cards">
              <CardPlaceholder
                card={decision.hiddenCard}
                showEffect
                assetConfig={assetConfig}
                label={`${cardPresentation(decision.hiddenCard).name}, valor ${decision.hiddenCard.value} — carta oculta`}
              />
              <div className="game-modal-hand" role="group" aria-label="Tu mano">
                <h3>Tu mano</h3>
                {hand === null ? (
                  <p>Tu mano todavía no llegó.</p>
                ) : hand.length === 0 ? (
                  <p>Tu mano está vacía en este momento.</p>
                ) : (
                  hand.map((card) => (
                    <CardPlaceholder
                      key={card.instanceId}
                      card={card}
                      assetConfig={assetConfig}
                      label={`${cardPresentation(card).name}, valor ${card.value}`}
                    />
                  ))
                )}
              </div>
            </div>
            <div className="game-decision-controls">
              {decision.keepAllowed && (
                <button
                  type="button"
                  className="action-button game-decision-button"
                  disabled={busy}
                  onClick={() => onChooseHiddenSwap(false)}
                >
                  Conservar mi carta
                </button>
              )}
              {decision.swapAllowed && (
                <button
                  type="button"
                  className="action-button game-decision-button"
                  disabled={busy}
                  onClick={() => onChooseHiddenSwap(true)}
                >
                  Cambiar por la carta oculta
                </button>
              )}
            </div>
          </>
        )}

        {decision.kind === 'choose-deck-position' && (
          <>
            <p className="game-modal-copy">
              Solo vos podés ver esta carta. Elegí dónde devolverla.
            </p>
            <div className="game-modal-cards">
              <CardPlaceholder
                card={decision.card}
                showEffect
                assetConfig={assetConfig}
                label={`${cardPresentation(decision.card).name}, valor ${decision.card.value} — carta inspeccionada`}
              />
            </div>
            <div className="game-decision-controls">
              {decision.positions.map((index) => (
                <button
                  key={index}
                  type="button"
                  className="action-button game-decision-button"
                  disabled={busy}
                  onClick={() => onChooseDeckPosition(index)}
                >
                  {positionLabel(index, decision.positions)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
