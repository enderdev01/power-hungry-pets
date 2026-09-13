/**
 * Game table contract (WU6/WU7 slice): the table renders purely from
 * authoritative server projections — public view for the shared table and the
 * viewer's own private view for the face-up hand. Gameplay controls are
 * server-derived only: Draw renders exactly when the viewer's legalActions
 * carry DRAW_CARD; Play renders per exact targetless PLAY_CARD action; and
 * target-bearing plays arm inline target choices derived only from the
 * published target options. The table never invents state, never renders
 * another player's hidden information, and never mutates game state locally.
 * Final M8 art stays outside it.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTable } from '@/components/game/game-table';
import { createInitialRoomFlowState, type RoomFlowState } from '@/lib/room-flow/reducer';
import type { GameState } from '@/lib/game/game-reducer';
import type { RoomFlowController } from '@/lib/room-flow/controller';
import type { CardType, PrivateGameView, PublicGameView } from '@power-hungry-pets/protocol';
import {
  privateView,
  privateViewWithPending,
  publicView,
  roomSnapshotInMatch,
  SELF_ID,
  OTHER_ID,
  roundView,
} from './helpers/game-views';

/** Records every game command the table issues, like the real controller does. */
function controllerStub() {
  return {
    drawCard: jest.fn<ReturnType<RoomFlowController['drawCard']>, []>(),
    playCard: jest.fn<ReturnType<RoomFlowController['playCard']>, [string, string?]>(),
    chooseTarget: jest.fn<ReturnType<RoomFlowController['chooseTarget']>, [string]>(),
    submitGuess: jest.fn<ReturnType<RoomFlowController['submitGuess']>, [number]>(),
    chooseHiddenSwap: jest.fn<ReturnType<RoomFlowController['chooseHiddenSwap']>, [boolean]>(),
    chooseDeckPosition: jest.fn<ReturnType<RoomFlowController['chooseDeckPosition']>, [number]>(),
    retry: jest.fn<ReturnType<RoomFlowController['retry']>, []>(),
  } as unknown as Pick<
    RoomFlowController,
    | 'drawCard'
    | 'playCard'
    | 'chooseTarget'
    | 'submitGuess'
    | 'chooseHiddenSwap'
    | 'chooseDeckPosition'
    | 'retry'
  >;
}

function flowState(
  overrides: {
    publicView?: PublicGameView | null;
    privateView?: PrivateGameView | null;
    matchEnded?: boolean;
    matchWinners?: string[];
    roundResult?: GameState['roundResult'];
    busy?: RoomFlowState['busy'];
    error?: RoomFlowState['error'];
  } = {},
): RoomFlowState {
  return {
    ...createInitialRoomFlowState(),
    connection: 'connected',
    room: roomSnapshotInMatch(),
    roomCode: 'ABC12',
    self: { playerId: SELF_ID, seatNumber: 1 },
    busy: overrides.busy ?? null,
    error: overrides.error ?? null,
    game: {
      publicView: overrides.publicView !== undefined ? overrides.publicView : publicView(),
      privateView: overrides.privateView !== undefined ? overrides.privateView : privateView(),
      matchEnded: overrides.matchEnded ?? false,
      matchWinners: overrides.matchWinners ?? [],
      recentEvents: [],
      roundResult: overrides.roundResult ?? null,
    },
  };
}

function privateViewWithHand(
  hand: Array<{ instanceId: string; value: number; type: CardType }>,
  legalActions: PrivateGameView['legalActions'],
  publicViewOverride?: PublicGameView,
): PrivateGameView {
  return privateView(SELF_ID, hand, legalActions, publicViewOverride);
}

describe('game table shell', () => {
  it('shows a truthful waiting state while the initial projections are missing', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: null, privateView: null })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/table is being prepared/i);
    // No invented state: the roster's names must not be rendered as players.
    expect(screen.queryByText('Bruno')).toBeNull();
    expect(screen.queryByText(/your hand/i, { selector: '[data-hand-ready="true"]' })).toBeNull();
  });

  it('renders both seats from the public view with counts, tokens, and status', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    // Opponent hand is a face-down placeholder count, never a value.
    expect(screen.getByRole('group', { name: '2 face-down cards' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '1 face-down card' })).toBeInTheDocument();
    // Victory tokens, protection, and connection render as labeled text.
    expect(screen.getByText(/1 victory token/i)).toBeInTheDocument();
    expect(screen.getAllByText(/protected/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/at the table/i).length).toBeGreaterThan(0);
  });

  it('renders public discards with value and name, never an instance id', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/Rey Gato/i)).toBeInTheDocument();
    expect(screen.queryByText(/instance/i)).toBeNull();
  });

  it('marks eliminated players without removing their discard history', () => {
    const eliminated = publicView({
      players: [
        {
          id: SELF_ID,
          name: 'Ana',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 0,
          handCount: 1,
          discards: [],
        },
        {
          id: OTHER_ID,
          name: 'Bruno',
          connected: true,
          eliminated: true,
          protected: false,
          victoryTokens: 0,
          handCount: 0,
          discards: [{ card: { value: 10, type: 'REY_GATO' }, origin: 'PLAYED' }],
        },
      ],
      round: roundView(),
    });
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: eliminated })}
      />,
    );
    expect(screen.getAllByText(/eliminated/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rey Gato/i)).toBeInTheDocument();
  });

  it('renders the current-turn text from the authoritative phase', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText(/Waiting for Bruno to play a card/i)).toBeInTheDocument();
  });

  it('uses the authoritative phase in the current-turn prompt', () => {
    const playTurn = publicView({ round: roundView({ currentPlayerId: SELF_ID }) });
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: playTurn })}
      />,
    );
    expect(screen.getByText(/YOUR TURN — play a card/i)).toBeInTheDocument();

    const drawTurn = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: drawTurn })}
      />,
    );
    expect(screen.getByText(/YOUR TURN — draw a card/i)).toBeInTheDocument();
  });

  it('announces a public pending decision without revealing private data', () => {
    const pending = publicView({
      round: roundView({
        pendingInteraction: { type: 'RATON_INSERT_POSITION', actorId: OTHER_ID },
      }),
    });
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: pending })}
      />,
    );
    expect(screen.getByText(/Bruno is resolving Ratón Trampero/i)).toBeInTheDocument();
  });

  it('renders draw-pile count and hidden-card presence without identity', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText(/^18 cards$/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 face down$/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Draw pile, face down' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hidden card, face down' })).toBeInTheDocument();
  });

  it('renders the own face-up hand only from the viewer-matched private view', () => {
    const { container } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />,
    );
    expect(screen.getByText(/Malabarista de Ocho Patas/i)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    // Privacy hygiene: no instance identity is ever rendered.
    expect(screen.queryByText('own-instance-1', { exact: false })).toBeNull();
    // M7 exposes stable configuration hooks but ships no concrete image assets.
    const ownCard = container.querySelector('[data-art-key="card/malabarista-de-ocho-patas"]');
    expect(ownCard).toHaveAttribute('data-art-kind', 'none');
    expect(ownCard?.querySelector('img')).toBeNull();
  });

  it('accepts an injected asset map without changing game state or card metadata', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState()}
        assetConfig={{ images: { 'card/malabarista-de-ocho-patas': '/m8/card-7.webp' } }}
      />,
    );
    const ownCard = container.querySelector('[data-art-key="card/malabarista-de-ocho-patas"]');
    expect(ownCard).toHaveAttribute('data-art-kind', 'image');
    expect(ownCard?.querySelector('img')).toHaveAttribute('src', '/m8/card-7.webp');
  });

  it('never renders a private view addressed to a different viewer', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: privateView(OTHER_ID) })}
      />,
    );
    expect(screen.getByText(/hand has not arrived yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Malabarista de Ocho Patas/i)).toBeNull();
  });

  it('shows a truthful hand state while the private projection is missing', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: null })}
      />,
    );
    expect(screen.getByText(/hand has not arrived yet/i)).toBeInTheDocument();
  });

  it('renders no gameplay controls from an empty legalActions projection', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: privateView(SELF_ID) })}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders no gameplay controls while the private projection is missing', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: null })}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('announces a match end with the winners resolved by name', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ matchEnded: true, matchWinners: [OTHER_ID] })}
      />,
    );
    expect(screen.getByText(/The match is over — Bruno won/i)).toBeInTheDocument();
  });
});

describe('game table draw control (WU6)', () => {
  it('renders Draw exactly when the viewer’s own DRAW_CARD action is legal', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [{ type: 'DRAW_CARD', actorId: SELF_ID }],
          ),
        })}
      />,
    );
    const draw = screen.getByRole('button', { name: 'Draw a card' });
    expect(draw).toBeEnabled();
  });

  it('sends the draw command through the controller and never mutates state itself', async () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [{ type: 'DRAW_CARD', actorId: SELF_ID }],
          ),
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Draw a card' }));
    expect(controller.drawCard).toHaveBeenCalledTimes(1);
  });

  it('renders no Draw control without a legal DRAW_CARD action even on the draw phase', () => {
    // Phase says DRAW_REQUIRED, but the authoritative legalActions are empty:
    // legality must never be inferred from the public phase.
    const drawPhase = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: drawPhase,
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [],
          ),
        })}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders no Draw control when the legal DRAW_CARD belongs to another actor', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [{ type: 'DRAW_CARD', actorId: OTHER_ID }],
          ),
        })}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('disables and renames the draw control while a draw is in flight', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          busy: 'draw',
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [{ type: 'DRAW_CARD', actorId: SELF_ID }],
          ),
        })}
      />,
    );
    const draw = screen.getByRole('button', { name: 'Drawing…' });
    expect(draw).toBeDisabled();
  });
});

describe('game table play controls (WU6)', () => {
  const hand = [
    { instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' as CardType },
    { instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' as CardType },
  ];

  it('renders a labeled Play control for the exact targetless playable card', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(hand, [
            { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' },
          ]),
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Play Malabarista de Ocho Patas' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Play Pecera/i })).toBeNull();
  });

  it('sends the exact cardInstanceId through the controller on play', async () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(hand, [
            { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-2' },
          ]),
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    expect(controller.playCard).toHaveBeenCalledWith('own-instance-2');
    expect(controller.drawCard).not.toHaveBeenCalled();
  });

  it('arms, but never sends from, the play control of a target-only card (WU7)', async () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(hand, [
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: OTHER_ID,
            },
          ]),
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    // Arming alone sends nothing; the command fires only on a target choice.
    expect(controller.playCard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel target' })).toBeInTheDocument();
  });

  it('prefers the executable control when a card has both targetless and targeted actions', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(hand, [
            { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-2' },
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: OTHER_ID,
            },
          ]),
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal' })).toBeEnabled();
  });

  it('disables and renames play controls while a play is in flight', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          busy: 'play',
          privateView: privateViewWithHand(hand, [
            { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-1' },
          ]),
        })}
      />,
    );
    const playing = screen.getByRole('button', { name: 'Playing…' });
    expect(playing).toBeDisabled();
  });

  it('renders no play controls when the play actions belong to another actor', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(hand, [
            { type: 'PLAY_CARD', actorId: OTHER_ID, cardInstanceId: 'own-instance-1' },
          ]),
        })}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps play controls off cards whose instance ids the actions do not name', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(hand, [
            { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'not-in-hand' },
          ]),
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: /Play /i })).toBeNull();
  });
});

describe('game table error state (WU6)', () => {
  it('surfaces a failed game command as an alert with a retry path', () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({
          error: {
            action: 'draw',
            code: 'ENGINE_REJECTED',
            message: 'The game rules rejected that move.',
            sentence: 'The game rules rejected that move.',
            recovery: 'retry',
          },
        })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/The game rules rejected that move/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the rejected command’s sentence without a retry path when none exists', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          error: {
            action: 'play',
            code: 'ENGINE_REJECTED',
            message: 'The game rules rejected that move.',
            sentence: 'The game rules rejected that move.',
            recovery: 'none',
          },
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/The game rules rejected that move/i);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('game table target selection (WU7)', () => {
  const hand = [
    { instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' as CardType },
    { instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' as CardType },
  ];

  const THREE_ID = 'p-third';

  /** Three-seat public view: Ana (self), Bruno (protected), Caro. */
  function threePlayerView(): PublicGameView {
    return publicView({
      players: [
        {
          id: SELF_ID,
          name: 'Ana',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 1,
          handCount: 1,
          discards: [],
        },
        {
          id: OTHER_ID,
          name: 'Bruno',
          connected: true,
          eliminated: false,
          protected: true,
          victoryTokens: 0,
          handCount: 2,
          discards: [],
        },
        {
          id: THREE_ID,
          name: 'Caro',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 0,
          handCount: 2,
          discards: [],
        },
      ],
    });
  }

  const TARGETED_ONLY = [
    {
      type: 'PLAY_CARD' as const,
      actorId: SELF_ID,
      cardInstanceId: 'own-instance-2',
      targetId: OTHER_ID,
    },
  ];

  function targetedState(
    overrides: {
      legalActions?: PrivateGameView['legalActions'];
      publicView?: PublicGameView;
      busy?: RoomFlowState['busy'];
    } = {},
  ): RoomFlowState {
    const view = overrides.publicView ?? threePlayerView();
    return flowState({
      publicView: view,
      privateView: privateViewWithHand(hand, overrides.legalActions ?? TARGETED_ONLY, view),
      busy: overrides.busy,
    });
  }

  it('arms a target-bearing card with inline, name-labeled target choices', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    // Choices render inside the opponent's own public zone, by display name.
    const brunoZone = screen.getByRole('group', { name: 'Bruno status' }).closest('li');
    expect(brunoZone).not.toBeNull();
    const brunoChoice = within(brunoZone as HTMLElement).getByRole('button', {
      name: 'Play Pecera de Cristal on Bruno',
    });
    expect(brunoChoice).toBeEnabled();
  });

  it('sends exactly {type, actorId, cardInstanceId, targetId} when a target is clicked', async () => {
    const controller = controllerStub();
    render(<GameTable controller={controller as RoomFlowController} state={targetedState()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    const brunoZone = screen.getByRole('group', { name: 'Bruno status' }).closest('li');
    await userEvent.click(
      within(brunoZone as HTMLElement).getByRole('button', {
        name: 'Play Pecera de Cristal on Bruno',
      }),
    );
    expect(controller.playCard).toHaveBeenCalledTimes(1);
    expect(controller.playCard).toHaveBeenCalledWith('own-instance-2', OTHER_ID);
  });

  it('keeps exactly one armed selection at a time', async () => {
    const threeCardHand = [
      ...hand,
      { instanceId: 'own-instance-3', value: 3, type: 'RATON_TRAMPERO' as CardType },
    ];
    const bothTargeted = [
      {
        type: 'PLAY_CARD' as const,
        actorId: SELF_ID,
        cardInstanceId: 'own-instance-2',
        targetId: OTHER_ID,
      },
      {
        type: 'PLAY_CARD' as const,
        actorId: SELF_ID,
        cardInstanceId: 'own-instance-3',
        targetId: OTHER_ID,
      },
    ];
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: threePlayerView(),
          privateView: privateViewWithHand(threeCardHand, bothTargeted),
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    expect(
      screen.getByRole('button', { name: 'Play Pecera de Cristal on Bruno' }),
    ).toBeInTheDocument();

    // Arming the other card replaces the armed selection: one at a time.
    await userEvent.click(screen.getByRole('button', { name: 'Play Ratón Trampero' }));
    expect(screen.queryByRole('button', { name: 'Play Pecera de Cristal on Bruno' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Play Ratón Trampero on Bruno' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal' })).toBeEnabled();
  });

  it('disarms when Cancel is clicked and sends nothing', async () => {
    const controller = controllerStub();
    render(<GameTable controller={controller as RoomFlowController} state={targetedState()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    const cancel = screen.getByRole('button', { name: 'Cancel target' });
    await userEvent.click(cancel);
    expect(screen.queryByRole('button', { name: 'Cancel target' })).toBeNull();
    expect(controller.playCard).not.toHaveBeenCalled();
  });

  it('renders no target choices when a published targetId has no public counterpart', () => {
    const ghostView = threePlayerView();
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({
          legalActions: [
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: 'p-ghost',
            },
          ],
          publicView: ghostView,
        })}
      />,
    );
    // Fail closed: an empty option group is a dead-end arm, so the card renders
    // no arm control at all, no target choices, and no raw id. The table itself
    // still renders normally (positive anchor), so these absences are meaningful.
    expect(screen.getByText('Pecera de Cristal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play Pecera de Cristal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /on /i })).toBeNull();
    expect(screen.queryByText(/p-ghost/)).toBeNull();
  });

  it('keeps an armed selection dead-end free when target options exist', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    // A resolvable group always leaves the armed state escapable.
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal on Bruno' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel target' })).toBeEnabled();
  });

  it('answers an in-flight play textually and disarms the selection', async () => {
    const controller = controllerStub();
    const { rerender } = render(
      <GameTable controller={controller as RoomFlowController} state={targetedState()} />,
    );
    // Sending a target disarms the selection; the arm control then answers the
    // in-flight play textually.
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal on Bruno' }));
    rerender(
      <GameTable
        controller={controller as RoomFlowController}
        state={targetedState({ busy: 'play' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Playing…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel target' })).toBeNull();
  });

  it('disables armed target controls while any play is busy', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({ busy: 'draw' })}
      />,
    );
    const brunoZone = screen.getByRole('group', { name: 'Bruno status' }).closest('li');
    expect(
      within(brunoZone as HTMLElement).getByRole('button', {
        name: 'Play Pecera de Cristal on Bruno',
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel target' })).toBeDisabled();
  });

  it('self-heals a stale armed selection when the next projection drops the card', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    expect(screen.getByRole('button', { name: 'Cancel target' })).toBeInTheDocument();

    // New projection: the targeted action now belongs to someone else; the
    // armed selection must vanish without any local click.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({
          legalActions: [
            {
              type: 'PLAY_CARD',
              actorId: OTHER_ID,
              cardInstanceId: 'own-instance-2',
              targetId: SELF_ID,
            },
          ],
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel target' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Play Pecera de Cristal on/ })).toBeNull();
  });

  it('self-heals an armed selection whose options resolve to an empty list', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    expect(screen.getByRole('button', { name: 'Cancel target' })).toBeInTheDocument();

    // New projection: the action still names the card, but its only target id
    // now lacks a public counterpart — the empty group must disarm the
    // selection instead of stranding it in a dead-end armed state.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({
          legalActions: [
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: 'p-ghost',
            },
          ],
          publicView: threePlayerView(),
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel target' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play Pecera de Cristal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /on /i })).toBeNull();
  });

  it('prefers the ordinary executable Play when targetless and targeted variants coexist', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({
          legalActions: [
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: OTHER_ID,
            },
            { type: 'PLAY_CARD', actorId: SELF_ID, cardInstanceId: 'own-instance-2' },
          ],
        })}
      />,
    );
    const play = screen.getByRole('button', { name: 'Play Pecera de Cristal' });
    expect(play).toBeEnabled();
    // No target choices are armed or offered: the targetless play wins.
    expect(screen.queryByRole('button', { name: 'Cancel target' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Play Pecera de Cristal on/ })).toBeNull();
  });

  it('renders exactly one choice per published option across a 3-player table', async () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({
          legalActions: [
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: OTHER_ID,
            },
            {
              type: 'PLAY_CARD',
              actorId: SELF_ID,
              cardInstanceId: 'own-instance-2',
              targetId: THREE_ID,
            },
          ],
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal on Bruno' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal on Caro' })).toBeEnabled();
  });

  it('leaks no private hand data into the public player zones, even while armed', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    // Arm for real so the target choice actually renders: privacy must hold
    // during the armed flow, not only in the idle layout.
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    const publicZones = screen.getByRole('region', { name: 'Players at the table' });
    // The choice itself is public and name-labeled inside Bruno's zone.
    expect(
      within(publicZones).getAllByRole('button', { name: 'Play Pecera de Cristal on Bruno' }),
    ).toHaveLength(1);
    // No raw instance ids, raw target ids, or private hand identities ever
    // cross into the public player zones.
    expect(within(publicZones).queryAllByText(/own-instance/)).toHaveLength(0);
    expect(within(publicZones).queryAllByText(OTHER_ID)).toHaveLength(0);
    expect(within(publicZones).queryAllByText(/Malabarista de Ocho Patas/)).toHaveLength(0);
    expect(within(publicZones).queryAllByText('7')).toHaveLength(0);
  });

  it('moves keyboard focus to the cancel control when arming target selection', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    // The arm button unmounts on arming; focus must land on a live control.
    expect(screen.getByRole('button', { name: 'Cancel target' })).toHaveFocus();
  });

  it('returns keyboard focus to the arm control when target selection is canceled', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Pecera de Cristal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel target' }));
    // The armed controls unmount on cancel; focus returns to the arm button.
    expect(screen.getByRole('button', { name: 'Play Pecera de Cristal' })).toHaveFocus();
  });
});

describe('game table private decision modal (WU8)', () => {
  const HIDDEN_CARD = {
    instanceId: 'hidden-instance-1',
    value: 6,
    type: 'SAQUEADOG_DE_TUMBAS' as CardType,
  };

  const SWAP_ACTIONS: PrivateGameView['legalActions'] = [
    { type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: false },
    { type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: true },
  ];

  function swapState(
    overrides: {
      publicViewOverride?: PublicGameView;
      privateViewOverride?: PrivateGameView | null;
      busy?: RoomFlowState['busy'];
      error?: RoomFlowState['error'];
    } = {},
  ): RoomFlowState {
    const publicViewValue =
      overrides.publicViewOverride ??
      publicView({
        round: roundView({
          pendingInteraction: { type: 'SAQUEADOG_SWAP', actorId: SELF_ID },
        }),
      });
    return flowState({
      publicView: publicViewValue,
      privateView:
        overrides.privateViewOverride !== undefined
          ? overrides.privateViewOverride
          : privateViewWithPending(
              SELF_ID,
              { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
              SWAP_ACTIONS,
              [],
              publicViewValue,
            ),
      busy: overrides.busy,
      error: overrides.error,
    });
  }

  it('opens the mandatory modal for the viewer-matching pending decision', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={swapState()} />);
    const dialog = screen.getByRole('dialog', { name: /Saqueadog de Tumbas/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The private hidden card is visible to the addressed actor only.
    expect(screen.getByLabelText(/Saqueadog de Tumbas, value 6/i)).toBeInTheDocument();
  });

  it('suppresses the actor-facing third-person pending copy while the modal is open', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={swapState()} />);
    expect(screen.queryByText(/Ana is making a private swap decision/i)).toBeNull();
  });

  it('keeps the public waiting copy for a non-actor and renders no modal', () => {
    const otherPending = publicView({
      round: roundView({
        pendingInteraction: { type: 'SAQUEADOG_SWAP', actorId: OTHER_ID },
      }),
    });
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={swapState({
          publicViewOverride: otherPending,
          privateViewOverride: privateView(SELF_ID, [], [], otherPending),
        })}
      />,
    );
    expect(screen.getByText(/Bruno is making a private swap decision/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders no modal from a stale public pending without private confirmation', () => {
    // The public projection claims this viewer decides, but the private view
    // carries no pendingDecision: fail closed with no invented controls.
    const stalePublic = publicView({
      round: roundView({
        pendingInteraction: { type: 'SAQUEADOG_SWAP', actorId: SELF_ID },
      }),
    });
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={swapState({
          publicViewOverride: stalePublic,
          privateViewOverride: privateView(SELF_ID, [], [], stalePublic),
        })}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes the table inert while the modal is open and interactive again after resolution', () => {
    const controller = controllerStub();
    const { container, rerender } = render(
      <GameTable controller={controller as RoomFlowController} state={swapState()} />,
    );
    const table = container.querySelector('.game-table');
    expect(table).toHaveAttribute('inert');

    rerender(
      <GameTable
        controller={controller as RoomFlowController}
        state={swapState({
          publicViewOverride: publicView(),
          privateViewOverride: privateView(SELF_ID),
        })}
      />,
    );
    expect(container.querySelector('.game-table')).not.toHaveAttribute('inert');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends the exact swap choice through the controller from the modal', async () => {
    const controller = controllerStub();
    render(<GameTable controller={controller as RoomFlowController} state={swapState()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Swap with the hidden card' }));
    expect(controller.chooseHiddenSwap).toHaveBeenCalledTimes(1);
    expect(controller.chooseHiddenSwap).toHaveBeenCalledWith(true);
  });

  it('restores focus to the gameplay element the viewer held before the modal', async () => {
    const drawTurn = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    const controller = controllerStub();
    const { rerender } = render(
      <GameTable
        controller={controller as RoomFlowController}
        state={swapState({
          publicViewOverride: drawTurn,
          privateViewOverride: privateView(
            SELF_ID,
            [],
            [{ type: 'DRAW_CARD', actorId: SELF_ID }],
            drawTurn,
          ),
        })}
      />,
    );
    const drawButton = screen.getByRole('button', { name: 'Draw a card' });
    drawButton.focus();
    expect(drawButton).toHaveFocus();

    // The pending decision opens the modal, then resolves.
    rerender(<GameTable controller={controller as RoomFlowController} state={swapState()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(
      <GameTable
        controller={controller as RoomFlowController}
        state={swapState({
          publicViewOverride: drawTurn,
          privateViewOverride: privateView(
            SELF_ID,
            [],
            [{ type: 'DRAW_CARD', actorId: SELF_ID }],
            drawTurn,
          ),
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Draw a card' })).toHaveFocus();
  });

  it('surfaces a pending-decision failure as an alert inside the modal with retry', async () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={swapState({
          error: {
            action: 'choose-hidden-swap',
            code: 'ENGINE_REJECTED',
            message: 'The game rules rejected that move.',
            sentence: 'The swap could not be sent.',
            recovery: 'retry',
          },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /Saqueadog de Tumbas/i });
    // Exactly one live alert: the inert table must not duplicate it.
    const alerts = within(dialog).getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/The swap could not be sent/i);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    // The retry action lives inside the active modal, not the inert subtree.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(controller.retry).toHaveBeenCalledTimes(1);
    // The decision is still pending: the modal stays open over the inert table.
    expect(dialog).toBeInTheDocument();
  });

  it('makes a no-recovery pending-decision failure perceivable without a retry path', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={swapState({
          error: {
            action: 'choose-hidden-swap',
            code: 'ENGINE_REJECTED',
            message: 'The game rules rejected that move.',
            sentence: 'The swap could not be sent.',
            recovery: 'none',
          },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /Saqueadog de Tumbas/i });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/The swap could not be sent/i);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
