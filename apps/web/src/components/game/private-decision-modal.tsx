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
import type { PendingDecisionModel } from '@/lib/game/pending-decision';
import { cardPresentation } from '@/lib/game/card-presentation';
import type { FlowError } from '@/lib/room-flow/reducer';
import type { GameCardInstance } from '@power-hungry-pets/protocol';

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
      return 'Pecera de Cristal — choose a target';
    case 'submit-guess':
      return 'Pecera de Cristal — name your guess';
    case 'choose-hidden-swap':
      return 'Saqueadog de Tumbas — the hidden card';
    case 'choose-deck-position':
      return 'Ratón Trampero — choose the reinsertion slot';
    case 'unavailable':
      return 'Decision unavailable';
    default:
      return 'Decision';
  }
}

function positionLabel(index: number, positions: number[]): string {
  if (positions.length === 1) {
    return 'Top of the draw pile';
  }
  if (index === 0) {
    return 'Top of the draw pile';
  }
  if (index === Math.max(...positions)) {
    return 'Bottom of the draw pile';
  }
  return `Slot ${index}`;
}

interface PrivateDecisionModalProps {
  /** The selector-derived decision; `none` renders nothing. */
  decision: PendingDecisionModel;
  /** The viewer's own hand, shown privately beside the Saqueadog hidden card. */
  hand: GameCardInstance[] | null;
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
        tabIndex={-1}
      >
        <h2 id="private-decision-title" className="game-modal-title">
          {title}
        </h2>

        {error !== null && error !== undefined && (
          <div className="game-modal-error" role="alert">
            <p className="game-error-sentence">{error.sentence}</p>
            {error.recovery === 'retry' && onRetry !== undefined && (
              <button type="button" className="action-button" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}

        {decision.kind === 'unavailable' && (
          <p className="game-modal-status" role="status">
            Waiting for the table to settle — your decision will appear here as soon as the server
            confirms it.
          </p>
        )}

        {decision.kind === 'choose-target' && (
          <>
            <p className="game-modal-copy">Whose hand will you look into?</p>
            <div className="game-decision-controls">
              {decision.targets.map((target) => (
                <button
                  key={target.targetId}
                  type="button"
                  className="action-button game-decision-button"
                  disabled={busy}
                  onClick={() => onChooseTarget(target.targetId)}
                >
                  {`Choose ${target.name}`}
                </button>
              ))}
            </div>
          </>
        )}

        {decision.kind === 'submit-guess' && (
          <>
            <p className="game-modal-copy">
              {decision.targetName === null
                ? 'Choose the value you will guess.'
                : `You are guessing ${decision.targetName}'s hand.`}
            </p>
            <div className="game-decision-controls">
              {decision.values.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="action-button game-decision-button game-decision-value"
                  disabled={busy}
                  onClick={() => onSubmitGuess(value)}
                >
                  {`Guess ${value}`}
                </button>
              ))}
            </div>
          </>
        )}

        {decision.kind === 'choose-hidden-swap' && (
          <>
            <p className="game-modal-copy">Only you can see the hidden card.</p>
            <div className="game-modal-cards">
              <CardPlaceholder
                card={decision.hiddenCard}
                showEffect
                label={`${cardPresentation(decision.hiddenCard).name}, value ${decision.hiddenCard.value} — the hidden card`}
              />
              <div className="game-modal-hand" role="group" aria-label="Your hand">
                <h3>Your hand</h3>
                {hand === null ? (
                  <p>Your hand has not arrived yet.</p>
                ) : hand.length === 0 ? (
                  <p>Your hand is empty right now.</p>
                ) : (
                  hand.map((card) => (
                    <CardPlaceholder
                      key={card.instanceId}
                      card={card}
                      label={`${cardPresentation(card).name}, value ${card.value}`}
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
                  Keep my card
                </button>
              )}
              {decision.swapAllowed && (
                <button
                  type="button"
                  className="action-button game-decision-button"
                  disabled={busy}
                  onClick={() => onChooseHiddenSwap(true)}
                >
                  Swap with the hidden card
                </button>
              )}
            </div>
          </>
        )}

        {decision.kind === 'choose-deck-position' && (
          <>
            <p className="game-modal-copy">
              Only you can see this card. Choose where it goes back.
            </p>
            <div className="game-modal-cards">
              <CardPlaceholder
                card={decision.card}
                showEffect
                label={`${cardPresentation(decision.card).name}, value ${decision.card.value} — the inspected card`}
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
