/**
 * Card placeholder M8 motion-hook contract: the shell is a visual-only surface.
 * One-shot motion hooks and textual origin stamps attach only to already-public
 * face-up shells; face-down backs and private surfaces never carry them.
 */
import { render, screen } from '@testing-library/react';
import { CardPlaceholder } from '@/components/game/card-placeholder';

describe('card placeholder shell (M7 baseline)', () => {
  it('renders a face-up shell with value, name, and honest aria labeling', () => {
    render(<CardPlaceholder card={{ value: 10, type: 'REY_GATO' }} />);
    const shell = screen.getByLabelText('Rey Gato, valor 10');
    expect(shell).toHaveAttribute('data-visual-placeholder', 'card');
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders a face-down back with its label and no card identity', () => {
    render(<CardPlaceholder faceDown label="Carta boca abajo 1" />);
    const back = screen.getByRole('img', { name: 'Carta boca abajo 1' });
    expect(back).toHaveAttribute('data-visual-placeholder', 'card-back');
    expect(back).toHaveTextContent('Boca abajo');
  });
});

describe('card placeholder motion hooks (M8)', () => {
  it('carries one-shot motion hooks exactly when a plan addresses the shell', () => {
    const { rerender } = render(<CardPlaceholder card={{ value: 10, type: 'REY_GATO' }} />);
    let shell = screen.getByLabelText('Rey Gato, valor 10');
    expect(shell).not.toHaveAttribute('data-motion');
    expect(shell).not.toHaveAttribute('data-motion-sequence');

    rerender(
      <CardPlaceholder
        card={{ value: 10, type: 'REY_GATO' }}
        motion={{ kind: 'card-flip', sequence: 3 }}
      />,
    );
    shell = screen.getByLabelText('Rey Gato, valor 10');
    expect(shell).toHaveAttribute('data-motion', 'card-flip');
    expect(shell).toHaveAttribute('data-motion-sequence', '3');
  });

  it('renders a visible textual origin label when the discard origin demands one', () => {
    render(
      <CardPlaceholder
        card={{ value: 5, type: 'SERPIENTE_ENCANTADORA' }}
        originLabel="Forzada boca arriba"
      />,
    );
    const shell = screen.getByLabelText('Serpiente Encantadora, valor 5');
    expect(shell).toHaveTextContent('Forzada boca arriba');
  });

  it('renders no origin label when none is provided', () => {
    render(<CardPlaceholder card={{ value: 10, type: 'REY_GATO' }} />);
    expect(document.querySelector('.game-card-origin')).toBeNull();
  });

  it('never puts motion or origin hooks on a face-down back', () => {
    render(<CardPlaceholder faceDown label="Carta boca abajo 2" />);
    const back = screen.getByRole('img', { name: 'Carta boca abajo 2' });
    expect(back).not.toHaveAttribute('data-motion');
    expect(back).not.toHaveAttribute('data-motion-sequence');
    expect(back.querySelector('.game-card-origin')).toBeNull();
  });
});
