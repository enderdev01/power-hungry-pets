/**
 * Player seat avatar contract (M8): a public-safe seat marker derived only
 * from the player's display name — initials plus a deterministic CSS variant —
 * never from raw player ids, and never from images. The marker is labelled
 * accessibly so screen readers announce the seat without leaking anything the
 * public projection does not already publish.
 */
import { render, screen } from '@testing-library/react';
import { PlayerAvatar, avatarVariant, playerInitials } from '@/components/game/player-avatar';

describe('player seat avatar (M8)', () => {
  it('derives initials from the display name', () => {
    expect(playerInitials('Ana')).toBe('AN');
    expect(playerInitials('Bruno')).toBe('BR');
    expect(playerInitials('ana pérez')).toBe('AP');
    expect(playerInitials('  Caro   Ruiz ')).toBe('CR');
  });

  it('caps initials at two characters for multi-word names', () => {
    expect(playerInitials('One Two Three')).toBe('OT');
    expect(playerInitials('One Two Three')).toHaveLength(2);
  });

  it('falls back to a neutral stamp when a name has no letters or digits', () => {
    expect(playerInitials('!!!')).toBe('??');
    expect(playerInitials('')).toBe('??');
    expect(playerInitials('   ')).toBe('??');
  });

  it('keeps letters and digits from any script, including accented names', () => {
    expect(playerInitials('Árbol')).toBe('ÁR');
    expect(playerInitials('Jugador 7')).toBe('J7');
  });

  it('derives a deterministic variant inside a fixed 0–3 range', () => {
    expect(avatarVariant('Ana')).toBe(avatarVariant('Ana'));
    expect(avatarVariant('Bruno')).toBe(avatarVariant('Bruno'));
    for (const name of ['Ana', 'Bruno', 'Caro', 'Dana', 'Él']) {
      expect(avatarVariant(name)).toBeGreaterThanOrEqual(0);
      expect(avatarVariant(name)).toBeLessThanOrEqual(3);
    }
  });

  it('labels the seat accessibly and shows the initials', () => {
    render(<PlayerAvatar name="Bruno" />);
    const avatar = screen.getByRole('img', { name: 'Asiento de Bruno' });
    expect(avatar).toHaveTextContent('BR');
    expect(avatar).toHaveAttribute('data-avatar-variant', String(avatarVariant('Bruno')));
    // The visible initials are decorative repetition of the label.
    expect(avatar.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('accepts an explicit accessible label override', () => {
    render(<PlayerAvatar name="Ana" label="Your seat" />);
    expect(screen.getByRole('img', { name: 'Your seat' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: "Ana's seat" })).toBeNull();
  });

  it('never renders a raw id: the component only accepts a display name', () => {
    render(<PlayerAvatar name="Bruno" />);
    const avatar = screen.getByRole('img', { name: 'Asiento de Bruno' });
    expect(avatar.textContent).not.toMatch(/p-/);
    expect(avatar.textContent).not.toContain('Bruno');
  });
});
