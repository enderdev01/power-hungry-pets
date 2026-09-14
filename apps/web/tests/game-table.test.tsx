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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTable } from '@/components/game/game-table';
import { TABLETOP_ASSET_CONFIG } from '@/lib/game/card-assets';
import { createInitialRoomFlowState, type RoomFlowState } from '@/lib/room-flow/reducer';
import type { GameState } from '@/lib/game/game-reducer';
import {
  createInitialMotionCueState,
  deriveMotionCues,
  type MotionCueState,
} from '@/lib/game/motion-cues';
import type { RoomFlowController } from '@/lib/room-flow/controller';
import type {
  CardType,
  GamePublicEvent,
  PrivateGameView,
  PublicGameView,
  PublicPlayerView,
} from '@power-hungry-pets/protocol';
import {
  matchEndPublicView,
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
    returnToLobby: jest.fn<ReturnType<RoomFlowController['returnToLobby']>, []>(),
  } as unknown as Pick<
    RoomFlowController,
    | 'drawCard'
    | 'playCard'
    | 'chooseTarget'
    | 'submitGuess'
    | 'chooseHiddenSwap'
    | 'chooseDeckPosition'
    | 'retry'
    | 'returnToLobby'
  >;
}

function flowState(
  overrides: {
    publicView?: PublicGameView | null;
    privateView?: PrivateGameView | null;
    matchEnded?: boolean;
    matchWinners?: string[];
    roundResult?: GameState['roundResult'];
    motionCue?: MotionCueState;
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
      motionCue: overrides.motionCue ?? createInitialMotionCueState(),
    },
  };
}

/** Cue state exactly as the real reducer would hold it after one batch. */
function motionCueFrom(events: GamePublicEvent[]): MotionCueState {
  return deriveMotionCues(createInitialMotionCueState(), events);
}

/** Two-seat view with explicit public discard piles for motion evidence. */
function viewWithDiscards(
  selfDiscards: PublicPlayerView['discards'],
  otherDiscards: PublicPlayerView['discards'] = [],
): PublicGameView {
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
        discards: selfDiscards,
      },
      {
        id: OTHER_ID,
        name: 'Bruno',
        connected: true,
        eliminated: false,
        protected: false,
        victoryTokens: 0,
        handCount: 2,
        discards: otherDiscards,
      },
    ],
  });
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
    expect(screen.getByRole('status')).toHaveTextContent(/preparando la mesa/i);
    // No invented state: the roster's names must not be rendered as players.
    expect(screen.queryByText('Bruno')).toBeNull();
    expect(screen.queryByText(/your hand/i, { selector: '[data-hand-ready="true"]' })).toBeNull();
  });

  it('renders both seats from the public view with counts, tokens, and status', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    // Opponent hand is a face-down placeholder count, never a value.
    expect(screen.getByRole('group', { name: '2 cartas boca abajo' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '1 carta boca abajo' })).toBeInTheDocument();
    // Victory tokens, protection, and connection render as labeled text.
    expect(screen.getByText(/1 ficha de victoria/i)).toBeInTheDocument();
    expect(screen.getAllByText(/protegido/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/en la mesa/i).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/eliminado/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rey Gato/i)).toBeInTheDocument();
  });

  it('renders the current-turn text from the authoritative phase', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText(/Esperando a que Bruno juegue una carta/i)).toBeInTheDocument();
  });

  it('uses the authoritative phase in the current-turn prompt', () => {
    const playTurn = publicView({ round: roundView({ currentPlayerId: SELF_ID }) });
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: playTurn })}
      />,
    );
    expect(screen.getByText(/TU TURNO — jugá una carta/i)).toBeInTheDocument();

    const drawTurn = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: drawTurn })}
      />,
    );
    expect(screen.getByText(/TU TURNO — robá una carta/i)).toBeInTheDocument();
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
    expect(screen.getByText(/Bruno está resolviendo Ratón Trampero/i)).toBeInTheDocument();
  });

  it('renders draw-pile count and hidden-card presence without identity', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    expect(screen.getByText(/^18 cartas$/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 boca abajo$/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mazo boca abajo' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Carta oculta boca abajo' })).toBeInTheDocument();
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
    expect(screen.getByText(/tu mano todavía no llegó/i)).toBeInTheDocument();
    expect(screen.queryByText(/Malabarista de Ocho Patas/i)).toBeNull();
  });

  it('shows a truthful hand state while the private projection is missing', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: null })}
      />,
    );
    expect(screen.getByText(/tu mano todavía no llegó/i)).toBeInTheDocument();
  });

  it('renders no gameplay controls from an empty legalActions projection', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: privateView(SELF_ID) })}
      />,
    );
    // The pile close-up viewer sends no game command; only gameplay controls count.
    expect(container.querySelectorAll('button:not(.game-pile-zoom-trigger)')).toHaveLength(0);
  });

  it('renders no gameplay controls while the private projection is missing', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ privateView: null })}
      />,
    );
    // The pile close-up viewer sends no game command; only gameplay controls count.
    expect(container.querySelectorAll('button:not(.game-pile-zoom-trigger)')).toHaveLength(0);
  });

  it('never renders a match result from live broadcast flags alone', () => {
    // WU10: the live matchEnded/matchWinners state is supplemental evidence
    // only. The authoritative projection still says the match is live, so
    // the table renders the live game and never a match result.
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ matchEnded: true, matchWinners: [OTHER_ID] })}
      />,
    );
    expect(screen.queryByRole('status', { name: 'Resultado de la partida' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/Esperando a que Bruno/i);
  });
});

describe('game table match result (WU10)', () => {
  const matchEnd = matchEndPublicView();

  function matchEndState(
    overrides: {
      matchEnded?: boolean;
      matchWinners?: string[];
      publicViewOverride?: PublicGameView | null;
    } = {},
  ): RoomFlowState {
    const view =
      overrides.publicViewOverride !== undefined ? overrides.publicViewOverride : matchEnd;
    return flowState({
      publicView: view,
      privateView: view === null ? null : privateView(SELF_ID, [], [], view),
      matchEnded: overrides.matchEnded ?? false,
      matchWinners: overrides.matchWinners ?? [],
    });
  }

  it('renders the centered match result from the authoritative projection alone (reconnect-safe)', () => {
    // No live matchEnded flag and no broadcast winners: the MATCH_END
    // projection alone must drive the result, exactly as after a
    // post-finish reconnect.
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={matchEndState()} />,
    );
    const result = screen.getByRole('status', { name: 'Resultado de la partida' });
    expect(within(result).getByText(/la partida terminó/i)).toBeInTheDocument();
    expect(within(result).getByText('Ana gana la partida.')).toBeInTheDocument();
    // Final totals are visible, resolved by name.
    expect(within(result).getByText('Ana: 3 fichas de victoria')).toBeInTheDocument();
    expect(within(result).getByText('Bruno: 1 ficha de victoria')).toBeInTheDocument();
    // WU10 owns the whole end surface: no round-result slip coexists with it.
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
  });

  it('replaces the playable table: no gameplay controls, only the return to the lobby', async () => {
    const controller = controllerStub();
    const { container } = render(
      <GameTable controller={controller as RoomFlowController} state={matchEndState()} />,
    );
    expect(container.querySelector('.game-table')).toBeNull();
    // The single supported next action: bring the whole room back to its lobby.
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Volver al lobby' }));
    expect(controller.returnToLobby).toHaveBeenCalledTimes(1);
  });

  it('shows each viewer their own victory or defeat preset', () => {
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={matchEndState()}
        assetConfig={TABLETOP_ASSET_CONFIG}
      />,
    );
    const outcome = () =>
      document.querySelector('.game-result-preset')?.getAttribute('data-outcome');
    const viewerWon = matchEndState().game.publicView?.match.winners.includes(SELF_ID) ?? false;
    expect(outcome()).toBe(viewerWon ? 'victory' : 'defeat');
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={{ ...matchEndState(), self: { playerId: OTHER_ID, seatNumber: 2 } }}
        assetConfig={TABLETOP_ASSET_CONFIG}
      />,
    );
    expect(outcome()).toBe(viewerWon ? 'defeat' : 'victory');
  });

  it('uses the supplemental broadcast winners only when the projection names none', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={matchEndState({
          matchWinners: [OTHER_ID],
          publicViewOverride: matchEndPublicView({ winners: [] }),
        })}
      />,
    );
    expect(screen.getByText('Bruno gana la partida.')).toBeInTheDocument();
  });

  it('never renders a raw winner id or an unresolvable winner', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={matchEndState({
          publicViewOverride: matchEndPublicView({ winners: [OTHER_ID, 'p-ghost'] }),
        })}
      />,
    );
    expect(screen.getByText('Bruno gana la partida.')).toBeInTheDocument();
    expect(screen.queryByText(/p-ghost/)).toBeNull();
  });

  it('announces a shared match win', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={matchEndState({
          publicViewOverride: matchEndPublicView({ winners: [SELF_ID, OTHER_ID] }),
        })}
      />,
    );
    expect(
      screen.getByText('Ana y Bruno comparten la victoria de la partida.'),
    ).toBeInTheDocument();
  });

  it('stays honest when no winner can be resolved', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={matchEndState({
          publicViewOverride: matchEndPublicView({ winners: ['p-ghost'] }),
        })}
      />,
    );
    const result = screen.getByRole('status', { name: 'Resultado de la partida' });
    expect(within(result).getByText(/no se anunció un ganador/i)).toBeInTheDocument();
    expect(within(result).queryByText(/gana la partida/i)).toBeNull();
    // The honest fallback still shows the authoritative final totals.
    expect(within(result).getByText('Ana: 3 fichas de victoria')).toBeInTheDocument();
  });

  it('shows the waiting state while the match is over but projections are missing', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={matchEndState({
          publicViewOverride: null,
          matchEnded: true,
          matchWinners: [OTHER_ID],
        })}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/preparando la mesa/i);
    expect(screen.queryByRole('status', { name: 'Resultado de la partida' })).toBeNull();
  });
});

describe('game table draw control (WU6)', () => {
  it('auto-draws once per published draw opportunity and hides the manual button', () => {
    const controller = controllerStub();
    const drawState = flowState({
      privateView: privateViewWithHand(
        [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
        [{ type: 'DRAW_CARD', actorId: SELF_ID }],
      ),
    });
    const { rerender } = render(
      <GameTable controller={controller as RoomFlowController} state={drawState} autoDraw />,
    );
    expect(controller.drawCard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Robar una carta' })).toBeNull();
    rerender(
      <GameTable controller={controller as RoomFlowController} state={{ ...drawState }} autoDraw />,
    );
    expect(controller.drawCard).toHaveBeenCalledTimes(1);
  });

  it('holds the automatic draw while a round result is on screen, then draws after Continue', async () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [{ type: 'DRAW_CARD', actorId: SELF_ID }],
          ),
          roundResult: {
            roundNumber: 1,
            winnerIds: [OTHER_ID],
            awards: [{ playerId: OTHER_ID, amount: 1 }],
            reason: 'last-survivor',
            revealedHands: [],
          },
        })}
        autoDraw
      />,
    );
    expect(controller.drawCard).not.toHaveBeenCalled();
    // A last-survivor round reveals no hand at any seat (rules: no reveal).
    expect(document.querySelector('.game-seat-reveal')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continuar' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(controller.drawCard).toHaveBeenCalledTimes(1);
  });

  it('flips publicly revealed exhaustion hands face up at their seats', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          roundResult: {
            roundNumber: 1,
            winnerIds: [SELF_ID],
            awards: [],
            reason: 'exhaustion',
            revealedHands: [
              { playerId: OTHER_ID, card: { value: 5, type: 'SERPIENTE_ENCANTADORA' } },
            ],
          },
        })}
      />,
    );
    const bruno = screen
      .getByRole('group', { name: 'Estado de Bruno' })
      .closest('li') as HTMLElement;
    expect(bruno).toHaveAttribute('data-revealed', 'true');
    expect(
      within(bruno).getByLabelText('Carta revelada de Bruno: Serpiente Encantadora'),
    ).toBeInTheDocument();
  });

  it('never auto-draws without a published DRAW_CARD action', () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({
          privateView: privateViewWithHand(
            [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
            [],
          ),
        })}
        autoDraw
      />,
    );
    expect(controller.drawCard).not.toHaveBeenCalled();
  });

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
    const draw = screen.getByRole('button', { name: 'Robar una carta' });
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
    await userEvent.click(screen.getByRole('button', { name: 'Robar una carta' }));
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
    // The pile close-up viewer sends no game command; only gameplay controls count.
    expect(container.querySelectorAll('button:not(.game-pile-zoom-trigger)')).toHaveLength(0);
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
    // The pile close-up viewer sends no game command; only gameplay controls count.
    expect(container.querySelectorAll('button:not(.game-pile-zoom-trigger)')).toHaveLength(0);
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
    const draw = screen.getByRole('button', { name: 'Robando…' });
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
    expect(screen.getByRole('button', { name: 'Jugar Malabarista de Ocho Patas' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Jugar Pecera/i })).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    // Arming alone sends nothing; the command fires only on a target choice.
    expect(controller.playCard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancelar objetivo' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' })).toBeEnabled();
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
    const playing = screen.getByRole('button', { name: 'Jugando…' });
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
    // The pile close-up viewer sends no game command; only gameplay controls count.
    expect(container.querySelectorAll('button:not(.game-pile-zoom-trigger)')).toHaveLength(0);
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
    expect(screen.queryByRole('button', { name: /Jugar /i })).toBeNull();
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
            message: 'Las reglas del juego rechazaron ese movimiento.',
            sentence: 'Las reglas del juego rechazaron ese movimiento.',
            recovery: 'retry',
          },
        })}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Las reglas del juego rechazaron ese movimiento/i);
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeInTheDocument();
  });

  it('shows the rejected command’s sentence without a retry path when none exists', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          error: {
            action: 'play',
            code: 'ENGINE_REJECTED',
            message: 'Las reglas del juego rechazaron ese movimiento.',
            sentence: 'Las reglas del juego rechazaron ese movimiento.',
            recovery: 'none',
          },
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Las reglas del juego rechazaron ese movimiento/i,
    );
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).toBeNull();
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
      motionCue?: MotionCueState;
    } = {},
  ): RoomFlowState {
    const view = overrides.publicView ?? threePlayerView();
    return flowState({
      publicView: view,
      privateView: privateViewWithHand(hand, overrides.legalActions ?? TARGETED_ONLY, view),
      busy: overrides.busy,
      motionCue: overrides.motionCue,
    });
  }

  it('arms a target-bearing card with a target picker of name-labeled choices', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    expect(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    // Choices render in a target picker dialog, by display name, while the
    // legal seat stays highlighted on the table.
    const picker = screen.getByRole('dialog', {
      name: 'Elegí un objetivo para Pecera de Cristal.',
    });
    const brunoChoice = within(picker).getByRole('button', {
      name: 'Jugar Pecera de Cristal contra Bruno',
    });
    expect(brunoChoice).toBeEnabled();
    const brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    expect(brunoZone).toHaveAttribute('data-legal-target', 'true');
  });

  it('sends exactly {type, actorId, cardInstanceId, targetId} when a target is clicked', async () => {
    const controller = controllerStub();
    render(<GameTable controller={controller as RoomFlowController} state={targetedState()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Jugar Pecera de Cristal contra Bruno',
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
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    expect(
      screen.getByRole('button', { name: 'Jugar Pecera de Cristal contra Bruno' }),
    ).toBeInTheDocument();

    // Arming the other card replaces the armed selection: one at a time.
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Ratón Trampero' }));
    expect(
      screen.queryByRole('button', { name: 'Jugar Pecera de Cristal contra Bruno' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Jugar Ratón Trampero contra Bruno' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' })).toBeEnabled();
  });

  it('disarms when Cancel is clicked and sends nothing', async () => {
    const controller = controllerStub();
    render(<GameTable controller={controller as RoomFlowController} state={targetedState()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    const cancel = screen.getByRole('button', { name: 'Cancelar objetivo' });
    await userEvent.click(cancel);
    expect(screen.queryByRole('button', { name: 'Cancelar objetivo' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Jugar Pecera de Cristal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /on /i })).toBeNull();
    expect(screen.queryByText(/p-ghost/)).toBeNull();
  });

  it('keeps an armed selection dead-end free when target options exist', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    // A resolvable group always leaves the armed state escapable.
    expect(
      screen.getByRole('button', { name: 'Jugar Pecera de Cristal contra Bruno' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancelar objetivo' })).toBeEnabled();
  });

  it('answers an in-flight play textually and disarms the selection', async () => {
    const controller = controllerStub();
    const { rerender } = render(
      <GameTable controller={controller as RoomFlowController} state={targetedState()} />,
    );
    // Sending a target disarms the selection; the arm control then answers the
    // in-flight play textually.
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Jugar Pecera de Cristal contra Bruno' }),
    );
    rerender(
      <GameTable
        controller={controller as RoomFlowController}
        state={targetedState({ busy: 'play' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Jugando…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancelar objetivo' })).toBeNull();
  });

  it('disables armed target controls while any play is busy', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({ busy: 'draw' })}
      />,
    );
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Jugar Pecera de Cristal contra Bruno',
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar objetivo' })).toBeDisabled();
  });

  it('self-heals a stale armed selection when the next projection drops the card', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    expect(screen.getByRole('button', { name: 'Cancelar objetivo' })).toBeInTheDocument();

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
    expect(screen.queryByRole('button', { name: 'Cancelar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Jugar Pecera de Cristal on/ })).toBeNull();
  });

  it('self-heals an armed selection whose options resolve to an empty list', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    expect(screen.getByRole('button', { name: 'Cancelar objetivo' })).toBeInTheDocument();

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
    expect(screen.queryByRole('button', { name: 'Cancelar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Jugar Pecera de Cristal' })).toBeNull();
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
    const play = screen.getByRole('button', { name: 'Jugar Pecera de Cristal' });
    expect(play).toBeEnabled();
    // No target choices are armed or offered: the targetless play wins.
    expect(screen.queryByRole('button', { name: 'Cancelar objetivo' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Jugar Pecera de Cristal on/ })).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    expect(
      screen.getByRole('button', { name: 'Jugar Pecera de Cristal contra Bruno' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Jugar Pecera de Cristal contra Caro' }),
    ).toBeEnabled();
  });

  it('leaks no private hand data into the public player zones, even while armed', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    // Arm for real so the target choice actually renders: privacy must hold
    // during the armed flow, not only in the idle layout.
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    const publicZones = screen.getByRole('region', { name: 'Jugadores en la mesa' });
    // The choice itself is public and name-labeled in the picker.
    expect(
      within(screen.getByRole('dialog')).getAllByRole('button', {
        name: 'Jugar Pecera de Cristal contra Bruno',
      }),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole('dialog')).queryAllByText(/own-instance|Malabarista/),
    ).toHaveLength(0);
    // No raw instance ids, raw target ids, or private hand identities ever
    // cross into the public player zones.
    expect(within(publicZones).queryAllByText(/own-instance/)).toHaveLength(0);
    expect(within(publicZones).queryAllByText(OTHER_ID)).toHaveLength(0);
    expect(within(publicZones).queryAllByText(/Malabarista de Ocho Patas/)).toHaveLength(0);
    expect(within(publicZones).queryAllByText('7')).toHaveLength(0);
  });

  it('cancels the target picker with Escape without playing anything', async () => {
    const controller = controllerStub();
    render(<GameTable controller={controller as RoomFlowController} state={targetedState()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(controller.playCard).not.toHaveBeenCalled();
  });

  it('moves keyboard focus to the cancel control when arming target selection', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    // The arm button unmounts on arming; focus must land on a live control.
    expect(screen.getByRole('button', { name: 'Cancelar objetivo' })).toHaveFocus();
  });

  it('returns keyboard focus to the arm control when target selection is canceled', async () => {
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar objetivo' }));
    // The armed controls unmount on cancel; focus returns to the arm button.
    expect(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' })).toHaveFocus();
  });
  it('keeps keyboard focus on a live target control while a zone cue changes', async () => {
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={targetedState()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    const targetButton = screen.getByRole('button', {
      name: 'Jugar Pecera de Cristal contra Bruno',
    });
    targetButton.focus();
    expect(document.activeElement).toBe(targetButton);

    // A zone cue addressed to the target's own zone re-renders that zone —
    // without remounting the subtree that hosts the target control.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={targetedState({
          motionCue: motionCueFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: OTHER_ID }]),
        })}
      />,
    );
    const stillLive = screen.getByRole('button', { name: 'Jugar Pecera de Cristal contra Bruno' });
    expect(stillLive).toBe(targetButton);
    expect(document.activeElement).toBe(targetButton);
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
    expect(screen.getByLabelText(/Saqueadog de Tumbas, valor 6/i)).toBeInTheDocument();
  });

  it('suppresses the actor-facing third-person pending copy while the modal is open', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={swapState()} />);
    expect(screen.queryByText(/Ana está tomando una decisión privada de intercambio/i)).toBeNull();
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
    expect(
      screen.getByText(/Bruno está tomando una decisión privada de intercambio/i),
    ).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar por la carta oculta' }));
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
    const drawButton = screen.getByRole('button', { name: 'Robar una carta' });
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
    expect(screen.getByRole('button', { name: 'Robar una carta' })).toHaveFocus();
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
            message: 'Las reglas del juego rechazaron ese movimiento.',
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Intentar de nuevo' }));
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
            message: 'Las reglas del juego rechazaron ese movimiento.',
            sentence: 'The swap could not be sent.',
            recovery: 'none',
          },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /Saqueadog de Tumbas/i });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/The swap could not be sent/i);
    expect(screen.queryByRole('button', { name: 'Intentar de nuevo' })).toBeNull();
  });
});

describe('game table motion cues (M8)', () => {
  /** Two-seat public view with explicit face-down hand counts. */
  function handCountView(self: number, other: number): PublicGameView {
    return publicView({
      players: [
        {
          id: SELF_ID,
          name: 'Ana',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 1,
          handCount: self,
          discards: [],
        },
        {
          id: OTHER_ID,
          name: 'Bruno',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 0,
          handCount: other,
          discards: [],
        },
      ],
    });
  }

  const DRAW_BATCH = motionCueFrom([{ type: 'CARD_DRAWN', playerId: SELF_ID }]);
  it('marks only the addressed player’s hand zone with the draw-settle cue once the projection confirms the hand change', () => {
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: DRAW_BATCH, publicView: handCountView(1, 2) })}
      />,
    );
    // Event-before-projection: the batch waits; no zone carries motion yet.
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
    // A draw cue never reveals or names a card.
    expect(screen.queryByText(/instance/i)).toBeNull();

    // The confirming projection: the addressed player's public handCount changed.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: DRAW_BATCH, publicView: handCountView(2, 1) })}
      />,
    );
    const anaHand = screen.getByRole('group', { name: '2 cartas boca abajo' });
    expect(anaHand).toHaveAttribute('data-motion', 'draw-settle');
    expect(anaHand).toHaveAttribute('data-motion-sequence', '1');
    // The other seat stays motionless: no invented attribution.
    expect(screen.getByRole('group', { name: '1 carta boca abajo' })).not.toHaveAttribute(
      'data-motion',
    );
    // A draw cue never reveals or names a card.
    expect(screen.queryByText(/instance/i)).toBeNull();
  });

  it('marks the matching player’s discard destination and pile count with the landing cue', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: viewWithDiscards([
            { card: { value: 4, type: 'CAPARAZON_ARMAZON' }, origin: 'PLAYED' },
          ]),
          motionCue: motionCueFrom([
            {
              type: 'CARD_PLAYED',
              playerId: SELF_ID,
              card: { value: 4, type: 'CAPARAZON_ARMAZON' },
            },
          ]),
        })}
      />,
    );
    const pile = screen.getByRole('group', { name: 'Pila de descartes' });
    expect(pile).toHaveAttribute('data-motion', 'card-landing');
    expect(pile).toHaveAttribute('data-motion-sequence', '1');
    // The pile count is part of the marked surface; the displayed card is the
    // projection's own public card, not one invented by the cue.
    expect(pile).toHaveTextContent('1 carta en la pila');
    // The resting pile card (not the decorative thrown overlay) is the
    // projection's own public card.
    const slot = pile.querySelector('.game-discard-slot') as HTMLElement;
    expect(within(slot).getByText('4')).toBeInTheDocument();
    expect(within(slot).getByText(/Caparazón Armazón/i)).toBeInTheDocument();
  });

  it('fires no landing cue when the projection does not confirm the newest discard', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: viewWithDiscards([]),
          motionCue: motionCueFrom([
            { type: 'CARD_PLAYED', playerId: SELF_ID, card: { value: 10, type: 'REY_GATO' } },
          ]),
        })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('applies the one-shot flip to the forced public shell with its origin label', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: viewWithDiscards([
            { card: { value: 5, type: 'SERPIENTE_ENCANTADORA' }, origin: 'FORCED_PLAY' },
          ]),
          motionCue: motionCueFrom([
            {
              type: 'CARD_FORCED_FACE_UP',
              playerId: SELF_ID,
              card: { value: 5, type: 'SERPIENTE_ENCANTADORA' },
            },
          ]),
        })}
      />,
    );
    const pile = screen.getByRole('group', { name: 'Pila de descartes' });
    expect(pile).toHaveAttribute('data-motion', 'card-flip');
    expect(within(pile).getByText('Forzada boca arriba')).toBeInTheDocument();
    // Private own-hand cards never receive the public flip treatment.
    const ownHand = screen.getByRole('region', { name: 'Tu mano' });
    expect(ownHand.querySelectorAll('[data-motion]')).toHaveLength(0);
    expect(ownHand.querySelectorAll('.game-card-origin')).toHaveLength(0);
    // One flip, on the shared pile that holds the forced card.
    expect(container.querySelectorAll('[data-motion="card-flip"]')).toHaveLength(1);
  });

  it('applies the flip to an elimination-reveal shell with its origin label', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: viewWithDiscards(
            [],
            [{ card: { value: 3, type: 'CONEJITO_GUERRILLERO' }, origin: 'ELIMINATION_REVEAL' }],
          ),
          motionCue: motionCueFrom([{ type: 'PLAYER_ELIMINATED', playerId: OTHER_ID }]),
        })}
      />,
    );
    const pile = screen.getByRole('group', { name: 'Pila de descartes' });
    expect(pile).toHaveAttribute('data-motion', 'card-flip');
    expect(within(pile).getByText('Revelada por eliminación')).toBeInTheDocument();
  });

  it('keeps origin labels visible without any motion when no cue addresses them', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: viewWithDiscards(
            [],
            [
              { card: { value: 5, type: 'SERPIENTE_ENCANTADORA' }, origin: 'FORCED_PLAY' },
              { card: { value: 3, type: 'CONEJITO_GUERRILLERO' }, origin: 'ELIMINATION_REVEAL' },
            ],
          ),
        })}
      />,
    );
    expect(screen.getByText('Forzada boca arriba')).toBeInTheDocument();
    expect(screen.getByText('Revelada por eliminación')).toBeInTheDocument();
    // Projection-only state: labels persist, motion never starts.
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('exchanges hands on exactly the published pair of player zones', () => {
    const third: PublicPlayerView = {
      id: 'p-third',
      name: 'Caro',
      connected: true,
      eliminated: false,
      protected: false,
      victoryTokens: 0,
      handCount: 1,
      discards: [],
    };
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: publicView({
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
                protected: false,
                victoryTokens: 0,
                handCount: 2,
                discards: [{ card: { value: 10, type: 'REY_GATO' }, origin: 'PLAYED' }],
              },
              third,
            ],
          }),
          motionCue: motionCueFrom([{ type: 'HANDS_SWAPPED', playerIds: [SELF_ID, OTHER_ID] }]),
        })}
      />,
    );
    const anaZone = screen.getByRole('group', { name: 'Estado de Ana' }).closest('li');
    const brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    const caroZone = screen.getByRole('group', { name: 'Estado de Caro' }).closest('li');
    expect(anaZone).toHaveAttribute('data-motion', 'hand-exchange');
    expect(brunoZone).toHaveAttribute('data-motion', 'hand-exchange');
    expect(caroZone).not.toHaveAttribute('data-motion');
  });

  it('uses an honest table-level shuffle cue with no seat attribution for HANDS_REDEALT', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: motionCueFrom([{ type: 'HANDS_REDEALT', playerIds: [SELF_ID, OTHER_ID] }]),
        })}
      />,
    );
    const section = screen.getByRole('region', { name: 'Jugadores en la mesa' });
    expect(section).toHaveAttribute('data-motion', 'hand-shuffle');
    expect(section).toHaveAttribute('data-motion-sequence', '1');
    // No seat and no hand zone is singled out.
    expect(container.querySelector('.game-player-zone')).not.toHaveAttribute('data-motion');
    expect(container.querySelector('.game-opponent-hand')).not.toHaveAttribute('data-motion');
  });

  it('settles private-effect resolution on the actor zone only', () => {
    const saqueadogBatch = motionCueFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]);
    // Batches always advance the reducer's sequence; the second cue derives
    // from the first exactly as the game reducer would hold it.
    const ratonBatch = deriveMotionCues(saqueadogBatch, [
      { type: 'RATON_RESOLVED', playerId: OTHER_ID },
    ]);
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: saqueadogBatch })}
      />,
    );
    let anaZone = screen.getByRole('group', { name: 'Estado de Ana' }).closest('li');
    let brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    expect(anaZone).toHaveAttribute('data-motion', 'effect-settle');
    expect(brunoZone).not.toHaveAttribute('data-motion');

    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: ratonBatch })}
      />,
    );
    anaZone = screen.getByRole('group', { name: 'Estado de Ana' }).closest('li');
    brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    expect(anaZone).not.toHaveAttribute('data-motion');
    expect(brunoZone).toHaveAttribute('data-motion', 'effect-settle');
  });

  it('clears every cue attribute when a batch resolves to no motion', () => {
    const settleBatch = motionCueFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]);
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: settleBatch })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(1);

    // A genuinely unsupportable batch (a status cue whose seat the roster
    // never resolves): no motion attribute is attributed, and the cue clears
    // honestly on both channels.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: deriveMotionCues(settleBatch, [
            { type: 'PLAYER_PROTECTED', playerId: 'p-ghost' },
          ]),
        })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('stays motionless across a projection-only reconnect-style reset', () => {
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: motionCueFrom([{ type: 'SAQUEADOG_RESOLVED', playerId: SELF_ID }]),
        })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(1);

    // The game state was cleared and re-projected: motion cues reset with it.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: createInitialMotionCueState() })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('keeps server-gated controls enabled while motion is active', () => {
    const withDrawControl = {
      privateView: privateViewWithHand(
        [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
        [{ type: 'DRAW_CARD', actorId: SELF_ID }],
      ),
    };
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          ...withDrawControl,
          motionCue: DRAW_BATCH,
          publicView: handCountView(1, 2),
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Robar una carta' })).toBeEnabled();

    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          ...withDrawControl,
          motionCue: DRAW_BATCH,
          publicView: handCountView(2, 1),
        })}
      />,
    );
    expect(screen.getByRole('group', { name: '2 cartas boca abajo' })).toHaveAttribute(
      'data-motion',
      'draw-settle',
    );
    expect(screen.getByRole('button', { name: 'Robar una carta' })).toBeEnabled();
  });

  it('retriggers one-shot motion by batch identity and holds still otherwise', () => {
    const secondBatch = deriveMotionCues(DRAW_BATCH, [{ type: 'CARD_DRAWN', playerId: SELF_ID }]);
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: DRAW_BATCH, publicView: handCountView(1, 2) })}
      />,
    );
    // Event-before-projection: the first draw batch waits for confirmation.
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);

    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: DRAW_BATCH, publicView: handCountView(2, 1) })}
      />,
    );
    const firstNode = container.querySelector('[data-motion="draw-settle"]');
    expect(firstNode).toHaveAttribute('data-motion-sequence', '1');

    // A second draw batch is captured against the current projection and waits
    // for its own confirming hand change.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: secondBatch, publicView: handCountView(2, 1) })}
      />,
    );
    expect(container.querySelector('[data-motion="draw-settle"]')).toBe(firstNode);

    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: secondBatch, publicView: handCountView(3, 1) })}
      />,
    );
    const secondNode = container.querySelector('[data-motion="draw-settle"]');
    expect(secondNode).not.toBe(firstNode);
    expect(secondNode).toHaveAttribute('data-motion-sequence', '2');

    // Re-rendering the same batch identity and projection-only updates never
    // remount the animated surface.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: secondBatch,
          publicView: publicView({
            round: roundView({ roundNumber: 1 }),
            players: [
              {
                id: SELF_ID,
                name: 'Ana',
                connected: true,
                eliminated: false,
                protected: false,
                victoryTokens: 2,
                handCount: 3,
                discards: [],
              },
              {
                id: OTHER_ID,
                name: 'Bruno',
                connected: true,
                eliminated: false,
                protected: false,
                victoryTokens: 0,
                handCount: 1,
                discards: [],
              },
            ],
          }),
        })}
      />,
    );
    expect(container.querySelector('[data-motion="draw-settle"]')).toBe(secondNode);
  });
});

const motionCss = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

/**
 * Selector-reach contract helper (M8): a CSS rule carrying `needle` counts as
 * reaching this render only when its selector matches at least one node
 * accepted by `matches`. Attribute presence alone never proves the animation
 * starts — a rule scoped to a surface the table never renders would be dead
 * CSS.
 */
function reachingRules(
  container: HTMLElement,
  needle: string,
  matches: (node: Element) => boolean,
): number {
  const source = motionCss.replace(/\/[*][\s\S]*?[*]\//g, '');
  const rules = [...source.matchAll(/([^{}]+)[{]([^{}]*)[}]/g)]
    .map((match) => ({ selector: match[1].trim(), body: match[2] }))
    .filter((rule) => rule.selector.includes(needle) && rule.body.includes(needle));
  return rules.filter((rule) => [...container.querySelectorAll(rule.selector)].some(matches))
    .length;
}

describe('game table center-action stage (M8 finish)', () => {
  const LANDING_VIEW = viewWithDiscards([
    { card: { value: 10, type: 'REY_GATO' }, origin: 'PLAYED' },
  ]);
  const LANDING_BATCH = motionCueFrom([
    { type: 'CARD_PLAYED', playerId: SELF_ID, card: { value: 10, type: 'REY_GATO' } },
  ]);

  it('marks the shared pile with the confirmed cue and renders no overlay copy of the card', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: LANDING_VIEW, motionCue: LANDING_BATCH })}
      />,
    );
    const pile = screen.getByRole('group', { name: 'Pila de descartes' });
    expect(pile).toHaveAttribute('data-motion', 'card-landing');
    expect(pile).toHaveAttribute('data-motion-sequence', '1');
    // The thrown card is the real top pile card, animated in place: no second
    // decorative card is mounted anywhere.
    expect(container.querySelector('.game-center-stage')).toBeNull();
    expect(pile.querySelectorAll('.game-discard-slot')).toHaveLength(1);
  });

  it('never replays a pile cue across a projection-only reconnect-style reset', () => {
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: LANDING_VIEW, motionCue: LANDING_BATCH })}
      />,
    );
    expect(container.querySelector('[data-motion="card-landing"]')).not.toBeNull();
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: LANDING_VIEW, motionCue: createInitialMotionCueState() })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('keeps draw pile left, shared discard pile center, and hidden card right', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: LANDING_VIEW, motionCue: LANDING_BATCH })}
      />,
    );
    const center = container.querySelector('.game-center');
    const piles = center?.querySelectorAll(':scope > .game-pile');
    expect(piles).toHaveLength(3);
    expect(piles?.[0]).toHaveTextContent('Mazo');
    expect(piles?.[1]).toHaveAttribute('aria-label', 'Pila de descartes');
    expect(piles?.[2]).toHaveTextContent('Carta oculta');
    expect(screen.getByText(/^18 cartas$/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 boca abajo$/i)).toBeInTheDocument();
  });
});

describe('top pile card close-up', () => {
  const PILE_VIEW = viewWithDiscards(
    [{ card: { value: 4, type: 'CAPARAZON_ARMAZON' }, origin: 'PLAYED' }],
    [{ card: { value: 5, type: 'SERPIENTE_ENCANTADORA' }, origin: 'FORCED_PLAY' }],
  );

  it('opens the last played card with its name, player, and effect, then closes', async () => {
    const controller = controllerStub();
    render(
      <GameTable
        controller={controller as RoomFlowController}
        state={flowState({ publicView: PILE_VIEW })}
      />,
    );
    const triggers = document.querySelectorAll('.game-pile-zoom-trigger');
    // Only the top card of the pile can be opened.
    expect(triggers).toHaveLength(1);
    await userEvent.click(triggers[0] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: 'Serpiente Encantadora' });
    expect(within(dialog).getByText(/Valor 5 · forzada boca arriba de Bruno/)).toBeInTheDocument();
    expect(
      within(dialog).getByText('Obligá a otro jugador a revelar su carta y robar una nueva.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Reading a card never sends a game command.
    expect(controller.playCard).not.toHaveBeenCalled();
    expect(controller.drawCard).not.toHaveBeenCalled();
  });
});

describe('Conejito duel overlay', () => {
  const DUEL_VIEW = viewWithDiscards(
    [{ card: { value: 3, type: 'CONEJITO_GUERRILLERO' }, origin: 'PLAYED' }],
    [{ card: { value: 2, type: 'RATON_TRAMPERO' }, origin: 'ELIMINATION_REVEAL' }],
  );
  const DUEL_EVENTS: GamePublicEvent[] = [
    { type: 'CARD_PLAYED', playerId: SELF_ID, card: { value: 3, type: 'CONEJITO_GUERRILLERO' } },
    { type: 'DUEL_RESOLVED', actorId: SELF_ID, targetId: OTHER_ID, loserId: OTHER_ID },
    { type: 'PLAYER_ELIMINATED', playerId: OTHER_ID },
  ];

  it('shows both duelists, the winner, and only the loser’s public card', () => {
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: DUEL_VIEW })}
      />,
    );
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: DUEL_VIEW, motionCue: motionCueFrom(DUEL_EVENTS) })}
      />,
    );
    const duel = document.querySelector('.game-duel') as HTMLElement;
    expect(duel).not.toBeNull();
    expect(within(duel).getByText('Ana retó a Bruno: Bruno quedó eliminado.')).toBeInTheDocument();
    const [actorSide, targetSide] = [...duel.querySelectorAll('.game-duel-side')] as HTMLElement[];
    expect(actorSide).toHaveAttribute('data-result', 'won');
    expect(targetSide).toHaveAttribute('data-result', 'lost');
    // The loser's elimination-revealed card is public and shown face up.
    expect(targetSide.querySelector('[data-art-key="card/raton-trampero"]')).not.toBeNull();
    // No compared value is announced anywhere in the caption.
    expect(within(duel).queryByText(/valor/)).toBeNull();
  });

  it('never shows a card from a round that already advanced', () => {
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: DUEL_VIEW })}
      />,
    );
    // The duel batch arrives while the table still shows the duel's round...
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: DUEL_VIEW, motionCue: motionCueFrom(DUEL_EVENTS) })}
      />,
    );
    // ...then the next round's projection lands (new round number).
    const nextRound = { ...DUEL_VIEW, round: { ...DUEL_VIEW.round!, roundNumber: 2 } };
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: nextRound, motionCue: motionCueFrom(DUEL_EVENTS) })}
      />,
    );
    const targetSide = document.querySelectorAll('.game-duel-side')[1] as HTMLElement;
    expect(targetSide.querySelector('.game-card-placeholder-back')).not.toBeNull();
    expect(targetSide.querySelector('[data-art-key]')).toBeNull();
  });

  it('never replays a duel that was already resolved before the table mounted', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: DUEL_VIEW, motionCue: motionCueFrom(DUEL_EVENTS) })}
      />,
    );
    expect(document.querySelector('.game-duel')).toBeNull();
  });

  it('holds the round result until the duel has been shown', () => {
    jest.useFakeTimers();
    try {
      const evidence = {
        roundNumber: 1,
        winnerIds: [SELF_ID],
        awards: [],
        reason: 'last-survivor' as const,
        revealedHands: [],
      };
      const { rerender } = render(
        <GameTable
          controller={controllerStub() as RoomFlowController}
          state={flowState({ publicView: DUEL_VIEW })}
        />,
      );
      rerender(
        <GameTable
          controller={controllerStub() as RoomFlowController}
          state={flowState({
            publicView: DUEL_VIEW,
            motionCue: motionCueFrom(DUEL_EVENTS),
            roundResult: evidence,
          })}
        />,
      );
      expect(document.querySelector('.game-duel')).not.toBeNull();
      expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
      act(() => {
        jest.advanceTimersByTime(3100);
      });
      expect(document.querySelector('.game-duel')).toBeNull();
      expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('game table persistent player states (M8)', () => {
  it('renders the protection pin badge from the projection alone, with no cue', () => {
    const { container } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />,
    );
    // The default projection seats Bruno as protected.
    const brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    expect(brunoZone).toHaveAttribute('data-protected', 'true');
    const badge = within(brunoZone as HTMLElement).getByText('protegido');
    expect(badge).toHaveClass('game-status-badge');
    expect(badge.querySelector('.game-status-pin')).not.toBeNull();
    // Projection-only persistent state: no motion attribute anywhere.
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('marks the forced discard shell so it is distinguishable without motion or color alone', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: viewWithDiscards([
            { card: { value: 5, type: 'SERPIENTE_ENCANTADORA' }, origin: 'FORCED_PLAY' },
          ]),
        })}
      />,
    );
    const pile = screen.getByRole('group', { name: 'Pila de descartes' });
    // The textual origin stamp persists, and the shell carries a non-color
    // structural marker.
    expect(within(pile).getByText('Forzada boca arriba')).toBeInTheDocument();
    const slot = pile.querySelector('.game-discard-slot[data-forced="true"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('.game-card-placeholder')).not.toBeNull();
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('keeps the eliminated seat state and its public discard history without any cue', () => {
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
          discards: [
            { card: { value: 10, type: 'REY_GATO' }, origin: 'PLAYED' },
            {
              card: { value: 3, type: 'CONEJITO_GUERRILLERO' },
              origin: 'ELIMINATION_REVEAL',
            },
          ],
        },
      ],
      round: roundView(),
    });
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ publicView: eliminated })}
      />,
    );
    const brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    expect(brunoZone).toHaveAttribute('data-eliminated', 'true');
    expect(within(brunoZone as HTMLElement).getByText('eliminado')).toBeInTheDocument();
    // Public discard history is retained, with explicit origin labels.
    const pile = screen.getByRole('group', { name: 'Pila de descartes' });
    expect(within(pile).getByText(/Rey Gato/i)).toBeInTheDocument();
    expect(within(pile).getByText('Revelada por eliminación')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it('renders victory tokens as a semantic text-readable rack from the committed projection', () => {
    render(<GameTable controller={controllerStub() as RoomFlowController} state={flowState()} />);
    const rack = screen.getByRole('group', { name: 'Bruno: 0 fichas de victoria' });
    expect(rack).toHaveClass('game-token-rack');
    expect(within(rack).getByText('0 fichas de victoria')).toBeInTheDocument();
    const anaRack = screen.getByRole('group', { name: 'Ana: 1 ficha de victoria' });
    expect(within(anaRack).getByText('1 ficha de victoria')).toBeInTheDocument();
    expect(within(anaRack).getByRole('listitem', { hidden: true })).toBeInTheDocument();
  });
});

describe('game table protection & token status cues (M8)', () => {
  it('marks only the addressed seat with the protection-settle cue once the projection confirms it', () => {
    const batch = motionCueFrom([{ type: 'PLAYER_PROTECTED', playerId: OTHER_ID }]);
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: batch,
          publicView: publicView({
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
                protected: false,
                victoryTokens: 0,
                handCount: 2,
                discards: [],
              },
            ],
          }),
        })}
      />,
    );
    // Event-before-projection: the activation cue waits for the persistent
    // projection state, never animating on a stale view.
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);

    const confirmedView = publicView({
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
      ],
    });
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: confirmedView })}
      />,
    );
    const brunoStatus = screen.getByRole('group', { name: 'Estado de Bruno' });
    // The cue mounts the keyed non-interactive pulse layer inside the
    // always-rendered status surface; the surface itself stays unmarked.
    const settlePulse = brunoStatus.querySelector('.game-status-pulse[data-motion]');
    expect(settlePulse).toHaveAttribute('data-motion', 'protection-settle');
    expect(settlePulse).toHaveAttribute('data-motion-sequence', '1');
    expect(brunoStatus).not.toHaveAttribute('data-motion');
    expect(
      screen.getByRole('group', { name: 'Estado de Ana' }).querySelector('[data-motion]'),
    ).toBeNull();
    // The persistent badge is present from the projection; the cue never
    // reveals hidden-card information.
    expect(within(brunoStatus as HTMLElement).getByText('protegido')).toBeInTheDocument();
    expect(container.textContent).not.toContain('instance');
  });

  it('fires the one-shot expiry cue from the projection and leaves no false persistent marker', () => {
    const batch = motionCueFrom([{ type: 'PROTECTION_EXPIRED', playerId: OTHER_ID }]);
    const clearedView = publicView({
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
          protected: false,
          victoryTokens: 0,
          handCount: 2,
          discards: [],
        },
      ],
    });
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: clearedView })}
      />,
    );
    const brunoStatus = screen.getByRole('group', { name: 'Estado de Bruno' });
    // The expiry cue mounts the keyed pulse layer on the stable, always-rendered
    // status surface — perceivable even though the badge is now gone.
    const expirePulse = brunoStatus.querySelector('.game-status-pulse[data-motion]');
    expect(expirePulse).toHaveAttribute('data-motion', 'protection-expire');
    expect(expirePulse).toHaveAttribute('data-motion-sequence', '1');
    expect(brunoStatus).not.toHaveAttribute('data-motion');
    // The persistent marker is gone with the projection: no stale badge.
    expect(screen.queryByText(/protegido/i)).toBeNull();
    expect(brunoStatus.closest('li')).toHaveAttribute('data-protected', 'false');
  });

  it('holds the expiry cue while the projection still shows the protected state', () => {
    const batch = motionCueFrom([{ type: 'PROTECTION_EXPIRED', playerId: OTHER_ID }]);
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: publicView() })}
      />,
    );
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);
  });

  it("marks only the addressed player's token rack with the committed-award cue once the projected count changes", () => {
    const batch = motionCueFrom([{ type: 'TOKEN_AWARDED', playerId: OTHER_ID }]);
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: viewWithDiscards([], []) })}
      />,
    );
    // Event-before-projection: the batch is captured against the stale pre-award
    // count, so no cue is confirmed yet — a stale count has no cue.
    expect(container.querySelector('.game-token-pulse[data-motion]')).toBeNull();

    // The confirming projection: the addressed seat's committed count changed.
    const confirmingView = viewWithDiscards([], []);
    confirmingView.players = confirmingView.players.map((player) =>
      player.id === OTHER_ID ? { ...player, victoryTokens: 2 } : player,
    );
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: confirmingView })}
      />,
    );
    const brunoRack = screen.getByRole('group', { name: 'Bruno: 2 fichas de victoria' });
    // The cue lives on the keyed non-interactive pulse layer inside the rack.
    const rackPulse = brunoRack.querySelector('.game-token-pulse[data-motion]');
    expect(rackPulse).toHaveAttribute('data-motion', 'token-settle');
    expect(rackPulse).toHaveAttribute('data-motion-sequence', '1');
    expect(brunoRack).not.toHaveAttribute('data-motion');
    // The displayed count is the committed projection value, never an
    // optimistic increment beyond what the projection carries.
    expect(within(brunoRack).getByText('2 fichas de victoria')).toBeInTheDocument();
    expect(
      screen
        .getByRole('group', { name: 'Ana: 1 ficha de victoria' })
        .querySelector('[data-motion]'),
    ).toBeNull();
  });

  it('keeps keyboard focus and control identity while a protection cue lands on that zone', async () => {
    const hand = [
      { instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' as CardType },
    ];
    const targeted: PrivateGameView['legalActions'] = [
      {
        type: 'PLAY_CARD',
        actorId: SELF_ID,
        cardInstanceId: 'own-instance-2',
        targetId: OTHER_ID,
      },
    ];
    const baseView = publicView();
    const { rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: baseView,
          privateView: privateView(SELF_ID, hand, targeted, baseView),
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    const targetButton = screen.getByRole('button', {
      name: 'Jugar Pecera de Cristal contra Bruno',
    });
    targetButton.focus();
    expect(document.activeElement).toBe(targetButton);

    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: publicView(),
          privateView: privateView(SELF_ID, hand, targeted, publicView()),
          motionCue: motionCueFrom([{ type: 'PLAYER_PROTECTED', playerId: OTHER_ID }]),
        })}
      />,
    );
    const stillLive = screen.getByRole('button', {
      name: 'Jugar Pecera de Cristal contra Bruno',
    });
    expect(stillLive).toBe(targetButton);
    expect(document.activeElement).toBe(targetButton);
  });

  it('keeps keyboard focus and rack identity while consecutive token cues retrigger the keyed pulse', () => {
    const batch = motionCueFrom([{ type: 'TOKEN_AWARDED', playerId: OTHER_ID }]);
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: viewWithDiscards([], []) })}
      />,
    );
    // Event-before-projection: the stale pre-award count cannot confirm yet.
    expect(container.querySelector('.game-token-pulse[data-motion]')).toBeNull();

    // The confirming projection: the addressed seat's committed count changed.
    const confirmingView = viewWithDiscards([], []);
    confirmingView.players = confirmingView.players.map((player) =>
      player.id === OTHER_ID ? { ...player, victoryTokens: 2 } : player,
    );
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: confirmingView })}
      />,
    );
    const rackNode = container.querySelector('.game-token-rack');
    expect(rackNode).not.toBeNull();
    let pulseNode = container.querySelector('.game-token-pulse[data-motion="token-settle"]');
    expect(pulseNode).toHaveAttribute('data-motion-sequence', '1');
    rackNode?.setAttribute('tabindex', '-1');
    (rackNode as HTMLElement).focus();
    expect(document.activeElement).toBe(rackNode);

    // Re-rendering the same batch never remounts the rack subtree and never
    // replays the pulse: one batch is exactly one animation.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: batch, publicView: confirmingView })}
      />,
    );
    expect(container.querySelector('.game-token-pulse[data-motion="token-settle"]')).toBe(
      pulseNode,
    );
    expect(container.querySelector('.game-token-rack')).toBe(rackNode);
    expect(document.activeElement).toBe(rackNode);

    // A consecutive same-kind batch retriggers by remounting only the keyed
    // pulse layer — the rack (and the interactive zone subtree) stays live.
    // The second batch is captured against the still-committed count (2) and
    // waits for its own confirming projection (3).
    const secondBatch = deriveMotionCues(batch, [{ type: 'TOKEN_AWARDED', playerId: OTHER_ID }]);
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: secondBatch, publicView: confirmingView })}
      />,
    );
    expect(container.querySelector('.game-token-pulse[data-motion-sequence="2"]')).toBeNull();

    const advancedView = viewWithDiscards([], []);
    advancedView.players = advancedView.players.map((player) =>
      player.id === OTHER_ID ? { ...player, victoryTokens: 3 } : player,
    );
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({ motionCue: secondBatch, publicView: advancedView })}
      />,
    );
    pulseNode = container.querySelector('.game-token-pulse[data-motion="token-settle"]');
    expect(pulseNode).toHaveAttribute('data-motion-sequence', '2');
    expect(container.querySelector('.game-token-rack')).toBe(rackNode);
    expect(document.activeElement).toBe(rackNode);
  });

  it('retriggers consecutive same-kind protection cues without remounting the interactive zone subtree', async () => {
    const hand = [
      { instanceId: 'own-instance-2', value: 1, type: 'PECERA_DE_CRISTAL' as CardType },
    ];
    const targeted: PrivateGameView['legalActions'] = [
      {
        type: 'PLAY_CARD',
        actorId: SELF_ID,
        cardInstanceId: 'own-instance-2',
        targetId: OTHER_ID,
      },
    ];
    const firstBatch = motionCueFrom([{ type: 'PLAYER_PROTECTED', playerId: OTHER_ID }]);
    const baseView = publicView();
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: baseView,
          privateView: privateView(SELF_ID, hand, targeted, baseView),
          motionCue: firstBatch,
        })}
      />,
    );
    // The first activation lands on Bruno's already-protected projection.
    const brunoZone = screen.getByRole('group', { name: 'Estado de Bruno' }).closest('li');
    expect(
      brunoZone?.querySelector('.game-status-pulse[data-motion="protection-settle"]'),
    ).toHaveAttribute('data-motion-sequence', '1');
    // Arm the target selection so the zone hosts a live, focused control.
    await userEvent.click(screen.getByRole('button', { name: 'Jugar Pecera de Cristal' }));
    const targetButton = screen.getByRole('button', {
      name: 'Jugar Pecera de Cristal contra Bruno',
    });
    targetButton.focus();
    expect(document.activeElement).toBe(targetButton);

    // A consecutive same-kind activation batch remounts only the keyed status
    // pulse: the zone subtree — and the live, focused target control — stays.
    const secondBatch = deriveMotionCues(firstBatch, [
      { type: 'PLAYER_PROTECTED', playerId: OTHER_ID },
    ]);
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          publicView: publicView(),
          privateView: privateView(SELF_ID, hand, targeted, publicView()),
          motionCue: secondBatch,
        })}
      />,
    );
    expect(
      container
        .querySelector('.game-status-pulse[data-motion="protection-settle"]')
        ?.getAttribute('data-motion-sequence'),
    ).toBe('2');
    const stillLive = screen.getByRole('button', {
      name: 'Jugar Pecera de Cristal contra Bruno',
    });
    expect(stillLive).toBe(targetButton);
    expect(document.activeElement).toBe(targetButton);
    expect(container.querySelector('.game-player-zone[data-player-id="p-other"]')).toBe(brunoZone);
  });

  it('reaches the rendered pulse layers through stylesheet rules, including the badge-less expiry', () => {
    // The token-settle rule must actually reach the rendered rack pulse —
    // attribute presence alone never proves the animation starts.
    const staleView = viewWithDiscards([], []);
    const { container: rackContainer, rerender: rerenderRack } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: motionCueFrom([{ type: 'TOKEN_AWARDED', playerId: OTHER_ID }]),
          publicView: staleView,
        })}
      />,
    );
    const confirmingView = viewWithDiscards([], []);
    confirmingView.players = confirmingView.players.map((player) =>
      player.id === OTHER_ID ? { ...player, victoryTokens: 2 } : player,
    );
    rerenderRack(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: motionCueFrom([{ type: 'TOKEN_AWARDED', playerId: OTHER_ID }]),
          publicView: confirmingView,
        })}
      />,
    );
    const rackPulse = rackContainer.querySelector('.game-token-pulse[data-motion="token-settle"]');
    expect(rackPulse).not.toBeNull();
    expect(
      reachingRules(rackContainer, 'token-settle', (node) =>
        node.classList.contains('game-token-pulse'),
      ),
    ).toBeGreaterThan(0);

    // The protection-settle rule must actually reach the rendered status pulse.
    const { container: settleContainer } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: motionCueFrom([{ type: 'PLAYER_PROTECTED', playerId: OTHER_ID }]),
        })}
      />,
    );
    expect(
      settleContainer.querySelector('.game-status-pulse[data-motion="protection-settle"]'),
    ).not.toBeNull();
    expect(
      reachingRules(settleContainer, 'protection-settle', (node) =>
        node.classList.contains('game-status-pulse'),
      ),
    ).toBeGreaterThan(0);

    // The protection-expire rule must reach the keyed pulse on the stable
    // always-rendered status surface, even after the badge is gone.
    const clearedView = publicView({
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
          protected: false,
          victoryTokens: 0,
          handCount: 2,
          discards: [],
        },
      ],
    });
    const { container: expireContainer } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={flowState({
          motionCue: motionCueFrom([{ type: 'PROTECTION_EXPIRED', playerId: OTHER_ID }]),
          publicView: clearedView,
        })}
      />,
    );
    const expirePulse = expireContainer.querySelector(
      '.game-status-list .game-status-pulse[data-motion="protection-expire"]',
    );
    expect(expirePulse).not.toBeNull();
    expect(expirePulse?.parentElement).toHaveClass('game-status-list');
    expect(
      reachingRules(expireContainer, 'protection-expire', (node) =>
        node.classList.contains('game-status-pulse'),
      ),
    ).toBeGreaterThan(0);
  });
});
