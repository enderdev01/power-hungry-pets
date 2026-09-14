/**
 * Card flights: measured, presentation-only travel animations built on the
 * Web Animations API. A flight moves an already-rendered element from a
 * source rectangle (the deck, a seat, the viewer's hand) to where the
 * authoritative layout put it, optionally turning it over on the way.
 *
 * Flights never change layout or state: the element is already in its final
 * place, the animation only offsets it visually and ends at its resting
 * transform. Environments without `Element.animate` (tests, old browsers) and
 * viewers who prefer reduced motion simply see the final state.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface FlightOptions {
  /** Turn the card over during the flight (back → face). */
  flip?: boolean;
  /** Starting spin in degrees, for a tossed feel. */
  spin?: number;
  duration?: number;
}

/** Animates `element` from `from` to its current position. */
export function flyFrom(
  element: HTMLElement | null,
  from: DOMRect | null,
  { flip = false, spin = 0, duration = 560 }: FlightOptions = {},
): void {
  if (element === null || from === null || typeof element.animate !== 'function') {
    return;
  }
  if (prefersReducedMotion()) {
    return;
  }
  const to = element.getBoundingClientRect();
  if (to.width === 0 || from.width === 0) {
    return;
  }
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = Math.min(Math.max(from.width / to.width, 0.3), 1.6);
  // The flight ends exactly on the element's own resting transform (a pile
  // card's tilt, a held card's fan), so nothing jumps when it finishes.
  const rest = getComputedStyle(element).transform;
  const resting = rest === 'none' || rest === '' ? 'none' : rest;
  element.animate(
    [
      {
        transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(${spin}deg)${flip ? ' rotateY(180deg)' : ''}`,
      },
      {
        offset: 0.62,
        transform: `translate(${dx * 0.12}px, ${dy * 0.12}px) scale(1.12) rotate(${spin * 0.15}deg)${flip ? ' rotateY(0deg)' : ''}`,
      },
      { transform: resting },
    ],
    { duration, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
  );
}

export function rectOf(element: Element | null | undefined): DOMRect | null {
  return element instanceof Element ? element.getBoundingClientRect() : null;
}
