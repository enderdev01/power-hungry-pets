'use client';

/**
 * Places the approved design-direction contract (impeccable seed 9719d81e,
 * direction: Cartelera de la partida) into the live DOM.
 *
 * Constraint, precisely: React cannot emit a raw HTML comment as a JSX
 * child — a JSX comment is a code comment that produces no DOM node, and
 * `dangerouslySetInnerHTML` cannot coexist with children, which the body
 * element always has under the Next.js App Router (Next itself injects the
 * router children). There is therefore no statically rendered direct body
 * comment under Next/React. The closest robust runtime behavior is a client
 * component that, at hydration — the earliest React-safe moment — inserts a
 * real comment node as the body's first child, with no wrapper element, and
 * stays idempotent across rerenders (including Strict Mode's double mount).
 */
import { useLayoutEffect } from 'react';
import { DESIGN_DIRECTION_COMMENT } from '@/lib/design-direction';

/** The contract's stable marker inside the emitted comment text. */
const SEED_MARKER = '9719d81e';

export function DirectionContractComment(): null {
  useLayoutEffect(() => {
    const body = document.body;
    const alreadyPlaced = Array.from(body.childNodes).some(
      (node) =>
        node.nodeType === 8 /* COMMENT_NODE */ && (node.nodeValue ?? '').includes(SEED_MARKER),
    );
    if (!alreadyPlaced) {
      body.insertBefore(document.createComment(DESIGN_DIRECTION_COMMENT), body.firstChild);
    }
  }, []);
  return null;
}
