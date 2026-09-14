/**
 * Private decision modal contract (WU8): the mandatory, centered, focus-trapped
 * decision surface for viewer-matching pending interactions. It renders only
 * what the pure pending-decision selector derived from the server's own
 * private projection, sends byte-exact choices through the injected callbacks,
 * never offers a cancel path, never closes on Escape or outside clicks, and
 * restores focus when the decision resolves.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivateDecisionModal } from '@/components/game/private-decision-modal';
import type { PendingDecisionModel } from '@/lib/game/pending-decision';
import type { CardAssetConfig } from '@/lib/game/asset-resolver';
import { TABLETOP_ASSET_CONFIG } from '@/lib/game/card-assets';
import type { FlowError } from '@/lib/room-flow/reducer';
import type { GameCardInstance } from '@power-hungry-pets/protocol';
import { OTHER_ID } from './helpers/game-views';

const HIDDEN_CARD: GameCardInstance = {
  instanceId: 'hidden-instance-1',
  value: 6,
  type: 'SAQUEADOG_DE_TUMBAS',
};

const INSPECTED_CARD: GameCardInstance = {
  instanceId: 'inspected-instance-1',
  value: 2,
  type: 'RATON_TRAMPERO',
};

const OWN_HAND: GameCardInstance[] = [
  { instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' },
];

interface Callbacks {
  onChooseTarget: jest.Mock<Promise<boolean>, [string]>;
  onSubmitGuess: jest.Mock<Promise<boolean>, [number]>;
  onChooseHiddenSwap: jest.Mock<Promise<boolean>, [boolean]>;
  onChooseDeckPosition: jest.Mock<Promise<boolean>, [number]>;
  onRetry: jest.Mock<Promise<boolean>, []>;
}

function callbacks(): Callbacks {
  return {
    onChooseTarget: jest.fn<Promise<boolean>, [string]>(),
    onSubmitGuess: jest.fn<Promise<boolean>, [number]>(),
    onChooseHiddenSwap: jest.fn<Promise<boolean>, [boolean]>(),
    onChooseDeckPosition: jest.fn<Promise<boolean>, [number]>(),
    onRetry: jest.fn<Promise<boolean>, []>(),
  };
}

function renderModal(
  decision: Exclude<PendingDecisionModel, { kind: 'none' }>,
  overrides: {
    hand?: GameCardInstance[] | null;
    busy?: boolean;
    callbacks?: Callbacks;
    error?: FlowError | null;
    assetConfig?: CardAssetConfig;
  } = {},
): Callbacks {
  const cb = overrides.callbacks ?? callbacks();
  render(
    <div data-testid="table-shell">
      <PrivateDecisionModal
        decision={decision}
        hand={overrides.hand !== undefined ? overrides.hand : OWN_HAND}
        busy={overrides.busy ?? false}
        error={overrides.error}
        assetConfig={overrides.assetConfig}
        onChooseTarget={cb.onChooseTarget}
        onSubmitGuess={cb.onSubmitGuess}
        onChooseHiddenSwap={cb.onChooseHiddenSwap}
        onChooseDeckPosition={cb.onChooseDeckPosition}
        onRetry={cb.onRetry}
      />
    </div>,
  );
  return cb;
}

describe('private decision modal: mandatory shell', () => {
  it('renders a centered modal dialog with an accessible name', () => {
    renderModal({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
    const dialog = screen.getByRole('dialog', { name: /Pecera de Cristal/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('offers no cancel, close, or dismiss control of any kind', () => {
    renderModal({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
    const buttons = Array.from(screen.getByRole('dialog').querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const label of buttons.map((button) => button.textContent ?? '')) {
      expect(label).not.toMatch(/cancel|close|dismiss|later/i);
    }
  });

  it('cancels the Escape default, stops its propagation, and stays open', async () => {
    renderModal({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
    // Registered after the modal's own capture listener, so it observes the
    // event only after the modal handled it: defaultPrevented must be true.
    const seen: KeyboardEvent[] = [];
    const observeOnDocument = (event: KeyboardEvent): void => {
      seen.push(event);
    };
    document.addEventListener('keydown', observeOnDocument, true);
    // A bubble-phase listener on the same node sits after the modal's capture
    // handler in the propagation sequence: stopPropagation must keep the Escape
    // keydown from ever reaching it.
    const bubbled: KeyboardEvent[] = [];
    const observeBubble = (event: KeyboardEvent): void => {
      bubbled.push(event);
    };
    document.addEventListener('keydown', observeBubble);
    try {
      await userEvent.keyboard('{Escape}');
    } finally {
      document.removeEventListener('keydown', observeOnDocument, true);
      document.removeEventListener('keydown', observeBubble);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.defaultPrevented).toBe(true);
    expect(bubbled).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: /Pecera de Cristal/i })).toBeInTheDocument();
  });

  it('prevents the default of an outside overlay click and stays open', async () => {
    renderModal({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
    // The overlay handler preventDefaults the click; a document-level observer
    // proves the native event really was cancelled, not merely ignored.
    const seen: MouseEvent[] = [];
    const observe = (event: MouseEvent): void => {
      seen.push(event);
    };
    document.addEventListener('click', observe);
    try {
      await userEvent.click(screen.getByTestId('private-decision-overlay'));
    } finally {
      document.removeEventListener('click', observe);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((event) => event.defaultPrevented)).toBe(true);
    expect(screen.getByRole('dialog', { name: /Pecera de Cristal/i })).toBeInTheDocument();
  });

  it('renders the truthful waiting state with no controls for a stale decision', () => {
    renderModal({ kind: 'unavailable' });
    expect(screen.getByRole('status')).toHaveTextContent(/esperando/i);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('private decision modal: focus trap edge cases', () => {
  it('keeps Tab and Shift+Tab inert on a zero-control dialog', async () => {
    renderModal({ kind: 'unavailable' });
    // With no controls, initial focus lands on the dialog itself and both Tab
    // directions must leave it there instead of escaping into the inert table.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    await userEvent.tab();
    expect(dialog).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(dialog).toHaveFocus();
  });

  it('wraps Tab and Shift+Tab on a single-control dialog', async () => {
    renderModal({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
    const only = screen.getByRole('button', { name: 'Elegir a Bruno' });
    expect(only).toHaveFocus();
    // Tab past the only control wraps back to it; Shift+Tab before it does too.
    await userEvent.tab();
    expect(only).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(only).toHaveFocus();
  });
});

describe('private decision modal: Pecera target stage', () => {
  it('renders one name-labeled choice per resolved target', async () => {
    const cb = renderModal({
      kind: 'choose-target',
      targets: [
        { targetId: OTHER_ID, name: 'Bruno' },
        { targetId: 'p-third', name: 'Caro' },
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Elegir a Bruno' }));
    expect(cb.onChooseTarget).toHaveBeenCalledTimes(1);
    expect(cb.onChooseTarget).toHaveBeenCalledWith(OTHER_ID);
    expect(screen.getByRole('button', { name: 'Elegir a Caro' })).toBeInTheDocument();
  });

  it('disables every choice while a command is in flight', () => {
    renderModal(
      { kind: 'choose-target', targets: [{ targetId: OTHER_ID, name: 'Bruno' }] },
      { busy: true },
    );
    expect(screen.getByRole('button', { name: 'Elegir a Bruno' })).toBeDisabled();
  });
});

describe('private decision modal: Pecera guess stage', () => {
  it('renders exactly the published values and sends the chosen one', async () => {
    const cb = renderModal({
      kind: 'submit-guess',
      targetId: OTHER_ID,
      targetName: 'Bruno',
      values: [0, 2, 3, 10],
    });
    expect(screen.getByRole('button', { name: 'Apostar 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apostar 10' })).toBeInTheDocument();
    // The prohibited value 1 is never invented by the client.
    expect(screen.queryByRole('button', { name: 'Apostar 1' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Apostar 3' }));
    expect(cb.onSubmitGuess).toHaveBeenCalledTimes(1);
    expect(cb.onSubmitGuess).toHaveBeenCalledWith(3);
  });

  it('shows unpublished catalog values as inert, labelled tiles that are never choices', () => {
    renderModal({
      kind: 'submit-guess',
      targetId: OTHER_ID,
      targetName: 'Bruno',
      values: [0, 2, 3, 10],
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 no disponible')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /no disponible/ })).toBeNull();
    // Exactly the published values are buttons.
    expect(within(dialog).getAllByRole('button', { name: /^Apostar \d+$/ })).toHaveLength(4);
  });

  it('names the guessed player from the public roster when resolvable', () => {
    renderModal({
      kind: 'submit-guess',
      targetId: OTHER_ID,
      targetName: 'Bruno',
      values: [4],
    });
    expect(screen.getByText(/Bruno/i)).toBeInTheDocument();
  });

  it('never surfaces a raw target id when the roster name is unknown', () => {
    renderModal({
      kind: 'submit-guess',
      targetId: 'p-ghost',
      targetName: null,
      values: [4],
    });
    expect(screen.queryByText(/p-ghost/)).toBeNull();
  });
});

describe('private decision modal: Saqueadog swap stage', () => {
  it('shows the private hidden card to the actor only and both decisions', async () => {
    const cb = renderModal({
      kind: 'choose-hidden-swap',
      hiddenCard: HIDDEN_CARD,
      keepAllowed: true,
      swapAllowed: true,
    });
    expect(screen.getByLabelText(/Saqueadog de Tumbas, valor 6/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conservar mi carta' }));
    expect(cb.onChooseHiddenSwap).toHaveBeenCalledWith(false);

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar por la carta oculta' }));
    expect(cb.onChooseHiddenSwap).toHaveBeenCalledWith(true);
    expect(cb.onChooseHiddenSwap).toHaveBeenCalledTimes(2);
  });

  it('shows the viewer’s own hand next to the hidden card', () => {
    renderModal({
      kind: 'choose-hidden-swap',
      hiddenCard: HIDDEN_CARD,
      keepAllowed: true,
      swapAllowed: true,
    });
    expect(screen.getByLabelText(/Malabarista de Ocho Patas, valor 7/i)).toBeInTheDocument();
  });

  it('offers only the swap answers the server published', () => {
    renderModal({
      kind: 'choose-hidden-swap',
      hiddenCard: HIDDEN_CARD,
      keepAllowed: true,
      swapAllowed: false,
    });
    expect(screen.getByRole('button', { name: 'Conservar mi carta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar por la carta oculta' })).toBeNull();
  });
});

describe('private decision modal: Ratón reinsertion stage', () => {
  it('shows the inspected card and labeled insertion slots', async () => {
    const cb = renderModal({
      kind: 'choose-deck-position',
      card: INSPECTED_CARD,
      positions: [0, 1, 2],
    });
    expect(screen.getByLabelText(/Ratón Trampero, valor 2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parte superior del mazo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Posición 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parte inferior del mazo' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Posición 1' }));
    expect(cb.onChooseDeckPosition).toHaveBeenCalledTimes(1);
    expect(cb.onChooseDeckPosition).toHaveBeenCalledWith(1);
  });

  it('labels a single-slot deck as both top and bottom without duplication', () => {
    renderModal({
      kind: 'choose-deck-position',
      card: INSPECTED_CARD,
      positions: [0],
    });
    expect(screen.getByRole('button', { name: 'Parte superior del mazo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Parte inferior del mazo' })).toBeNull();
  });
});

describe('private decision modal: focus contract', () => {
  it('moves initial focus into the dialog', () => {
    renderModal({
      kind: 'choose-target',
      targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
    });
    expect(screen.getByRole('button', { name: 'Elegir a Bruno' })).toHaveFocus();
  });

  it('traps Tab focus inside the dialog', async () => {
    renderModal({
      kind: 'submit-guess',
      targetId: OTHER_ID,
      targetName: 'Bruno',
      values: [0, 2, 3],
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(3);
    // Initial focus is the first choice; Tab past the last wraps to the first.
    buttons[2]?.focus();
    await userEvent.tab();
    expect(buttons[0]).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(buttons[2]).toHaveFocus();
  });

  it('restores focus to the element focused before the modal opened', async () => {
    const cb = callbacks();
    function TableShell({ withModal }: { withModal: boolean }) {
      return (
        <>
          <button type="button" data-testid="gameplay-trigger">
            Robar una carta
          </button>
          {withModal && (
            <PrivateDecisionModal
              decision={{
                kind: 'choose-target',
                targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
              }}
              hand={OWN_HAND}
              busy={false}
              onChooseTarget={cb.onChooseTarget}
              onSubmitGuess={cb.onSubmitGuess}
              onChooseHiddenSwap={cb.onChooseHiddenSwap}
              onChooseDeckPosition={cb.onChooseDeckPosition}
            />
          )}
        </>
      );
    }
    const { rerender } = render(<TableShell withModal={false} />);
    // The gameplay element holds focus when the projection opens the modal.
    screen.getByTestId('gameplay-trigger').focus();
    rerender(<TableShell withModal />);
    expect(screen.getByRole('button', { name: 'Elegir a Bruno' })).toHaveFocus();
    // The decision resolves: the modal unmounts and focus returns to gameplay.
    rerender(<TableShell withModal={false} />);
    expect(screen.getByTestId('gameplay-trigger')).toHaveFocus();
  });

  it('restores focus into the table when the previous element is gone', async () => {
    const cb = callbacks();
    const tableRef = { current: null } as { current: HTMLDivElement | null };
    function TableShell({ withTrigger, withModal }: { withTrigger: boolean; withModal: boolean }) {
      return (
        <>
          <div ref={tableRef} data-testid="table-shell" tabIndex={-1}>
            {withTrigger && (
              <button type="button" data-testid="gameplay-trigger">
                Robar una carta
              </button>
            )}
          </div>
          {withModal && (
            <PrivateDecisionModal
              decision={{
                kind: 'choose-target',
                targets: [{ targetId: OTHER_ID, name: 'Bruno' }],
              }}
              hand={OWN_HAND}
              busy={false}
              onChooseTarget={cb.onChooseTarget}
              onSubmitGuess={cb.onSubmitGuess}
              onChooseHiddenSwap={cb.onChooseHiddenSwap}
              onChooseDeckPosition={cb.onChooseDeckPosition}
              restoreFocusRef={tableRef}
            />
          )}
        </>
      );
    }
    const { rerender } = render(<TableShell withTrigger withModal={false} />);
    screen.getByTestId('gameplay-trigger').focus();
    rerender(<TableShell withTrigger withModal />);
    rerender(<TableShell withTrigger={false} withModal={false} />);
    // The previous element unmounted; focus must land inside the table instead
    // of dropping to <body>.
    expect(document.activeElement).not.toBe(document.body);
    expect(tableRef.current?.contains(document.activeElement)).toBe(true);
  });

  it('focuses the first control of a new stage when the decision changes in place', async () => {
    const cb = callbacks();
    type Stage = 'target' | 'guess' | 'resolved';
    function StageShell({ stage }: { stage: Stage }) {
      return (
        <>
          <button type="button" data-testid="gameplay-trigger">
            Robar una carta
          </button>
          {stage !== 'resolved' && (
            <PrivateDecisionModal
              decision={
                stage === 'target'
                  ? { kind: 'choose-target', targets: [{ targetId: OTHER_ID, name: 'Bruno' }] }
                  : {
                      kind: 'submit-guess',
                      targetId: OTHER_ID,
                      targetName: 'Bruno',
                      values: [0, 2],
                    }
              }
              hand={OWN_HAND}
              busy={false}
              onChooseTarget={cb.onChooseTarget}
              onSubmitGuess={cb.onSubmitGuess}
              onChooseHiddenSwap={cb.onChooseHiddenSwap}
              onChooseDeckPosition={cb.onChooseDeckPosition}
              onRetry={cb.onRetry}
            />
          )}
        </>
      );
    }
    const { rerender } = render(<StageShell stage="resolved" />);
    // The gameplay element holds focus when the projection opens the modal.
    screen.getByTestId('gameplay-trigger').focus();
    rerender(<StageShell stage="target" />);
    expect(screen.getByRole('button', { name: 'Elegir a Bruno' })).toHaveFocus();

    // The server advances the mandatory decision in place (PECERA_TARGET →
    // PECERA_GUESS): the old control unmounts, and the first control of the
    // new stage must take focus immediately — never the body, never a stale
    // control, and never the inert table.
    rerender(<StageShell stage="guess" />);
    expect(screen.getByRole('button', { name: 'Apostar 0' })).toHaveFocus();

    // The pre-modal focus is still reserved: when the decision finally
    // resolves, focus returns to the element held before the modal opened.
    rerender(<StageShell stage="resolved" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('gameplay-trigger')).toHaveFocus();
  });
});

describe('private decision modal: in-modal error surface', () => {
  it('announces the failure as an alert inside the dialog with a retry control', async () => {
    const cb = renderModal(
      {
        kind: 'choose-hidden-swap',
        hiddenCard: HIDDEN_CARD,
        keepAllowed: true,
        swapAllowed: true,
      },
      {
        error: {
          action: 'choose-hidden-swap',
          code: 'ENGINE_REJECTED',
          message: 'Las reglas del juego rechazaron ese movimiento.',
          sentence: 'Las reglas del juego rechazaron ese movimiento.',
          recovery: 'retry',
        },
      },
    );
    const dialog = screen.getByRole('dialog');
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent(/Las reglas del juego rechazaron ese movimiento/i);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Intentar de nuevo' }));
    expect(cb.onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no retry control when the failure has no recovery path', () => {
    renderModal(
      {
        kind: 'choose-hidden-swap',
        hiddenCard: HIDDEN_CARD,
        keepAllowed: true,
        swapAllowed: true,
      },
      {
        error: {
          action: 'choose-hidden-swap',
          code: 'ENGINE_REJECTED',
          message: 'Las reglas del juego rechazaron ese movimiento.',
          sentence: 'Las reglas del juego rechazaron ese movimiento.',
          recovery: 'none',
        },
      },
    );
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
      /Las reglas del juego rechazaron ese movimiento/i,
    );
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).toBeNull();
  });

  it('renders no alert when the table reports no failure', () => {
    renderModal({ kind: 'choose-target', targets: [{ targetId: OTHER_ID, name: 'Bruno' }] });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('private decision modal: tabletop presentation', () => {
  it('shows the already-public source card art as a decorative emblem', () => {
    renderModal(
      { kind: 'choose-target', targets: [{ targetId: OTHER_ID, name: 'Bruno' }] },
      { assetConfig: TABLETOP_ASSET_CONFIG },
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-decision', 'choose-target');
    const emblem = dialog.querySelector('.game-modal-emblem');
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    expect(emblem?.querySelector('img')?.getAttribute('src')).toBe(
      TABLETOP_ASSET_CONFIG.images['card/pecera-de-cristal'],
    );
  });

  it('renders private cards with the same canonical art as the table', () => {
    renderModal(
      { kind: 'choose-deck-position', card: { value: 10, type: 'REY_GATO' }, positions: [0, 1] },
      { assetConfig: TABLETOP_ASSET_CONFIG },
    );
    const card = screen.getByLabelText(/Rey Gato, valor 10/);
    expect(card).toHaveAttribute('data-art-kind', 'image');
  });
});
