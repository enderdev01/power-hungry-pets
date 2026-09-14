/**
 * Victory-token rack contract (M8): a semantic, text-readable rack that
 * replaces the plain prose-only token count. The rack renders exactly the
 * committed count it is given — counts always come from the authoritative
 * public projection or the round-result award model, never from an optimistic
 * local increment — and exposes the one-shot token cue as a keyed
 * non-interactive pulse layer only. The rack announces itself exactly once.
 */
import { render, screen, within } from '@testing-library/react';
import { PlayerTokenRack, tokenLabel } from '@/components/game/player-token-rack';

describe('player token rack', () => {
  it('renders the committed count as readable text, singular and plural', () => {
    const { rerender } = render(<PlayerTokenRack name="Ana" count={1} />);
    expect(screen.getByText('1 ficha de victoria')).toBeInTheDocument();

    rerender(<PlayerTokenRack name="Ana" count={3} />);
    expect(screen.getByText('3 fichas de victoria')).toBeInTheDocument();
    expect(tokenLabel(3)).toBe('3 fichas de victoria');
    expect(tokenLabel(0)).toBe('0 fichas de victoria');
  });

  it('renders one labelled slot per committed token', () => {
    render(<PlayerTokenRack name="Ana" count={3} />);
    const rack = screen.getByRole('group', { name: 'Ana: 3 fichas de victoria' });
    const slots = within(rack).getAllByRole('listitem', { hidden: true });
    expect(slots).toHaveLength(3);
    expect(within(rack).getByText('Ficha de victoria 1')).toBeInTheDocument();
    expect(within(rack).getByText('Ficha de victoria 3')).toBeInTheDocument();
  });

  it('announces itself exactly once — one coherent label, no repeated verbose tree', () => {
    render(<PlayerTokenRack name="Ana" count={3} />);
    const rack = screen.getByRole('group', { name: 'Ana: 3 fichas de victoria' });
    // The chip list and the printed total stay visible but are hidden from the
    // accessibility tree, so the rack's single group label is the whole
    // announcement — never the list name, every chip, and the total repeated.
    expect(rack.querySelector('.game-token-list')).toHaveAttribute('aria-hidden', 'true');
    expect(rack.querySelector('.game-token-total')).toHaveAttribute('aria-hidden', 'true');
    // The visible text is fully preserved for sighted readers.
    expect(rack).toHaveTextContent('Ficha de victoria 1');
    expect(rack).toHaveTextContent('3 fichas de victoria');
  });

  it('never renders slots or an optimistic increment for an empty count', () => {
    render(<PlayerTokenRack name="Ana" count={0} />);
    const rack = screen.getByRole('group', { name: 'Ana: 0 fichas de victoria' });
    expect(within(rack).queryAllByRole('listitem', { hidden: true })).toHaveLength(0);
    expect(within(rack).getByText('0 fichas de victoria')).toBeInTheDocument();
  });

  it('marks the one-shot token cue only as a keyed pulse layer, never a rack state', () => {
    const { container, rerender } = render(
      <PlayerTokenRack name="Ana" count={2} motion={{ kind: 'token-settle', sequence: 4 }} />,
    );
    let pulse = container.querySelector('.game-token-pulse');
    expect(pulse).toHaveAttribute('data-motion', 'token-settle');
    expect(pulse).toHaveAttribute('data-motion-sequence', '4');
    // The rack element itself never carries a motion attribute.
    expect(container.querySelector('.game-token-rack')).not.toHaveAttribute('data-motion');

    rerender(<PlayerTokenRack name="Ana" count={2} />);
    expect(container.querySelector('.game-token-pulse')).toBeNull();
    expect(container.querySelector('.game-token-rack')).not.toHaveAttribute('data-motion');
    expect(container.querySelector('.game-token-rack')).not.toHaveAttribute('data-motion-sequence');

    // A consecutive same-kind cue remounts only the keyed pulse layer, so the
    // animation retriggers; the rack subtree itself stays mounted.
    const rackBefore = container.querySelector('.game-token-rack');
    rerender(
      <PlayerTokenRack name="Ana" count={2} motion={{ kind: 'token-settle', sequence: 5 }} />,
    );
    pulse = container.querySelector('.game-token-pulse');
    expect(pulse).toHaveAttribute('data-motion-sequence', '5');
    expect(container.querySelector('.game-token-rack')).toBe(rackBefore);
  });

  it('never renders raw ids, instance ids, or invented state', () => {
    const { container } = render(
      <PlayerTokenRack name="Ana" count={2} motion={{ kind: 'token-settle', sequence: 1 }} />,
    );
    expect(screen.getByRole('group', { name: 'Ana: 2 fichas de victoria' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('instance');
    expect(container.textContent).not.toContain('inst-');
  });
});
