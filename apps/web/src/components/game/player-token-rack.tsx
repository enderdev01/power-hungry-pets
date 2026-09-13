/**
 * Victory-token rack (M8): the semantic, text-readable replacement for the
 * plain prose-only token count. Every rendered token is a pinned chip and the
 * committed count is printed below the rack, so the count stays readable
 * without color, motion, or artwork. The rack renders exactly the committed
 * count it is given — counts always come from the authoritative public
 * projection or the round-result award model, never from an optimistic local
 * increment — and it exposes the one-shot token-award cue as a keyed
 * non-interactive pulse layer the stylesheet animates; the pulse is a moment,
 * never a state, and replaying a cue remounts only that layer.
 *
 * Accessibility: the rack announces itself exactly once — one group with one
 * coherent label (`<name>: <n victory tokens>`). The chip list and the printed
 * total stay visible but are hidden from the accessibility tree, so a screen
 * reader hears one sentence instead of the group, the list name, every chip,
 * and the total repeated.
 */
interface PlayerTokenRackProps {
  /** Seat display name, used only for accessible labeling. */
  name: string;
  /** Committed victory-token count from the authoritative projection. */
  count: number;
  /**
   * One-shot token-award cue, resolved for this player by the pure
   * presentation-motion seam. `null` renders no motion attribute at all.
   */
  motion?: { kind: string; sequence: number } | null;
}

/** Visible textual total for a committed token count. */
export function tokenLabel(count: number): string {
  return count === 1 ? '1 victory token' : `${count} victory tokens`;
}

export function PlayerTokenRack({ name, count, motion }: PlayerTokenRackProps) {
  return (
    <div className="game-token-rack" role="group" aria-label={`${name}: ${tokenLabel(count)}`}>
      <ul className="game-token-list" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="game-token-slot">
            <span className="game-token-dot" aria-hidden="true" />
            {`Victory token ${index + 1}`}
          </li>
        ))}
      </ul>
      {motion !== null && motion !== undefined && (
        <span
          key={`token-pulse-${motion.sequence}`}
          className="game-token-pulse"
          data-motion={motion.kind}
          data-motion-sequence={motion.sequence}
          aria-hidden="true"
        />
      )}
      <p className="game-token-total" aria-hidden="true">
        {tokenLabel(count)}
      </p>
    </div>
  );
}
