/**
 * Round-result slip contract (WU9): the result renders as a centered
 * pinned-paper slip inside the table — information, not a mandatory decision.
 * It is not a modal: no inert, no focus trap, no dialog semantics, and the
 * next round stays playable around it. Continue dismisses locally and sends
 * no game command; a later ROUND_ENDED batch re-arms it; room/game clear
 * resets it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTable } from '@/components/game/game-table';
import { createInitialGameState, gameReducer, type GameState } from '@/lib/game/game-reducer';
import type { RoomFlowController } from '@/lib/room-flow/controller';
import { createInitialRoomFlowState, type RoomFlowState } from '@/lib/room-flow/reducer';
import type { GamePublicEvent, PublicGameView } from '@power-hungry-pets/protocol';
import {
  OTHER_ID,
  THIRD_ID,
  privateView,
  privateViewWithPending,
  publicView,
  roomSnapshotInMatch,
  roundView,
  SELF_ID,
} from './helpers/game-views';

/** Records every game command; the slip must never send any of them. */
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

function stateWithGame(game: GameState): RoomFlowState {
  return {
    ...createInitialRoomFlowState(),
    connection: 'connected',
    room: roomSnapshotInMatch(),
    roomCode: 'ABC12',
    self: { playerId: SELF_ID, seatNumber: 1 },
    busy: null,
    error: null,
    game,
  };
}

/** Game state with an authoritative live table and the viewer's private hand. */
function liveGame(publicViewOverride?: PublicGameView): GameState {
  const view = publicViewOverride ?? publicView();
  let game = createInitialGameState();
  game = gameReducer(game, { type: 'game/public-state', publicView: view });
  game = gameReducer(game, {
    type: 'game/private-state',
    privateView: privateView(SELF_ID, [], [], view),
  });
  return game;
}

/** Captures a ROUND_ENDED batch through the real reducer, as the gateway would. */
function gameAfterEvents(events: GamePublicEvent[], base: GameState): GameState {
  return gameReducer(base, { type: 'game/events', events });
}

function capturedState(events: GamePublicEvent[], liveView?: PublicGameView): RoomFlowState {
  return stateWithGame(gameAfterEvents(events, liveGame(liveView)));
}

const SINGLE_WIN: GamePublicEvent[] = [{ type: 'ROUND_ENDED', winnerIds: [SELF_ID] }];
const SHARED_WIN: GamePublicEvent[] = [{ type: 'ROUND_ENDED', winnerIds: [SELF_ID, OTHER_ID] }];

function laterRoundView(): PublicGameView {
  return publicView({ round: roundView({ roundNumber: 2 }) });
}

describe('round result slip presentation (WU9)', () => {
  it('renders the ended round as a pinned result slip with the winner resolved by name', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(SINGLE_WIN)}
      />,
    );
    const slip = screen.getByRole('status', { name: 'Round result' });
    expect(slip).toHaveTextContent(/Round 1 is over/i);
    expect(slip).toHaveTextContent(/Ana wins the round\./i);
    // Honest exhaustion copy: no winning-hand promise for a last-survivor round.
    expect(slip).toHaveTextContent(/last survivor/i);
  });

  it('uses honest copy when the ended round number is unknown', () => {
    // A live table whose round projection is absent: the evidence still
    // carries no round number, so the copy stays honest.
    const state = stateWithGame(gameAfterEvents(SINGLE_WIN, liveGame(publicView({ round: null }))));
    render(<GameTable controller={controllerStub() as RoomFlowController} state={state} />);
    const slip = screen.getByRole('status', { name: 'Round result' });
    expect(slip).toHaveTextContent(/The round is over/i);
    expect(slip).not.toHaveTextContent(/Round \d+ is over/i);
  });

  it('uses shared-win wording when the server announced several winners', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(SHARED_WIN)}
      />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toHaveTextContent(
      /Ana and Bruno share the round\./i,
    );
  });

  it('shows token awards with authoritative totals once the current view is demonstrably post-result', () => {
    // The captured batch happens against the pre-award view (round 1, tokens 0);
    // the slip only claims "now N" after the post-result/new-round projection
    // (round 2) has actually arrived carrying the authoritative totals.
    const preAward = publicView({
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
          eliminated: false,
          protected: false,
          victoryTokens: 0,
          handCount: 1,
          discards: [],
        },
      ],
    });
    const postResult = publicView({
      round: roundView({ roundNumber: 2 }),
      players: [
        {
          id: SELF_ID,
          name: 'Ana',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 3,
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
          handCount: 1,
          discards: [],
        },
      ],
    });
    const events: GamePublicEvent[] = [
      { type: 'TOKEN_AWARDED', playerId: SELF_ID },
      { type: 'TOKEN_AWARDED', playerId: SELF_ID },
      { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
    ];
    let game = liveGame(preAward);
    game = gameAfterEvents(events, game);
    game = gameReducer(game, { type: 'game/public-state', publicView: postResult });
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={stateWithGame(game)} />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toHaveTextContent(
      /Ana earned 2 victory tokens \u2014 now 3\./i,
    );
  });

  it('stays award-only while the current view could still be the stale pre-award projection', () => {
    // The round number has not advanced yet: the roster tokens may predate the
    // award, so the slip must not claim "now N" from a possibly stale balance.
    const preAward = publicView({
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
      ],
    });
    const events: GamePublicEvent[] = [
      { type: 'TOKEN_AWARDED', playerId: SELF_ID },
      { type: 'TOKEN_AWARDED', playerId: SELF_ID },
      { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
    ];
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(events, preAward)}
      />,
    );
    const slip = screen.getByRole('status', { name: 'Round result' });
    expect(slip).toHaveTextContent(/Ana earned 2 victory tokens\./i);
    expect(slip).not.toHaveTextContent(/now \d/i);
  });

  it('reads the exhaustion reason and reveal cards only from HANDS_REVEALED', () => {
    const events: GamePublicEvent[] = [
      {
        type: 'HANDS_REVEALED',
        hands: [
          { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
          { playerId: 'p-ghost', card: { value: 5, type: 'SERPIENTE_ENCANTADORA' } },
        ],
      },
      { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
    ];
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(events)}
      />,
    );
    const slip = screen.getByRole('status', { name: 'Round result' });
    expect(slip).toHaveTextContent(/The draw pile ran out/i);
    expect(slip).toHaveTextContent(/Robot Aspirador Real/i);
    expect(slip).toHaveTextContent(/Ana/i);
    // Fail-closed: an unknown reveal player is dropped, never rendered as a raw id.
    expect(slip).not.toHaveTextContent('p-ghost');
  });

  it('never renders raw ids or instance ids anywhere in the slip', () => {
    const events: GamePublicEvent[] = [
      {
        type: 'HANDS_REVEALED',
        hands: [{ playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } }],
      },
      { type: 'ROUND_ENDED', winnerIds: ['p-ghost'] },
    ];
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(events)}
      />,
    );
    // Positive anchor: the slip is actually present and rendering, so the
    // raw-id absences below are meaningful and not vacuous.
    const slip = screen.getByRole('status', { name: 'Round result' });
    expect(slip).toHaveTextContent(/Round 1 is over/i);
    expect(container.textContent).not.toContain('p-ghost');
    expect(container.textContent).not.toContain('instance');
  });

  it('joins three or more shared winners with the serial-and wording', () => {
    const threeSeat = publicView({
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
          eliminated: false,
          protected: false,
          victoryTokens: 0,
          handCount: 1,
          discards: [],
        },
        {
          id: THIRD_ID,
          name: 'Caro',
          connected: true,
          eliminated: false,
          protected: false,
          victoryTokens: 0,
          handCount: 1,
          discards: [],
        },
      ],
    });
    const events: GamePublicEvent[] = [
      { type: 'ROUND_ENDED', winnerIds: [SELF_ID, OTHER_ID, THIRD_ID] },
    ];
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(events, threeSeat)}
      />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toHaveTextContent(
      /Ana, Bruno and Caro share the round\./i,
    );
  });

  it('is not a modal: the table stays interactive and carries no dialog or inert', () => {
    const drawView = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    const withDraw = gameReducer(liveGame(drawView), {
      type: 'game/private-state',
      privateView: privateView(SELF_ID, [], [{ type: 'DRAW_CARD', actorId: SELF_ID }], drawView),
    });
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, withDraw))}
      />,
    );
    expect(container.querySelector('.game-table')).not.toHaveAttribute('inert');
    const slip = screen.getByRole('status', { name: 'Round result' });
    expect(slip).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog')).toBeNull();
    // The next round remains playable while the slip is visible.
    expect(screen.getByRole('button', { name: 'Draw a card' })).toBeEnabled();
  });

  it('dismisses on Continue locally and sends no game command', async () => {
    const controller = controllerStub();
    const state = capturedState(SINGLE_WIN);
    const { rerender } = render(
      <GameTable controller={controller as RoomFlowController} state={state} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();
    Object.values(controller as unknown as Record<string, jest.Mock>).forEach((spy) =>
      expect(spy).not.toHaveBeenCalled(),
    );
    // Dismissal is local state: re-rendering the same captured state must not
    // resurrect the dismissed slip.
    rerender(<GameTable controller={controller as RoomFlowController} state={state} />);
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();
  });

  it('re-arms a later ROUND_ENDED batch after an explicit dismissal', async () => {
    const controller = controllerStub() as RoomFlowController;
    const { rerender } = render(
      <GameTable controller={controller} state={capturedState(SINGLE_WIN)} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();

    rerender(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SHARED_WIN, liveGame(laterRoundView())))}
      />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toHaveTextContent(
      /Ana and Bruno share the round\./i,
    );
  });

  it('shows a fresh capture after a dismissal and a full game-state reset (room rejoin)', async () => {
    const controller = controllerStub() as RoomFlowController;
    const { rerender } = render(
      <GameTable controller={controller} state={capturedState(SINGLE_WIN)} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();

    // Room cleared and a later round ended again: a fresh evidence object
    // re-arms the slip even after the earlier dismissal.
    rerender(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, liveGame(laterRoundView())))}
      />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toBeInTheDocument();
  });

  it('coexists with the WU8 mandatory decision modal without changing its behavior', () => {
    const HIDDEN_CARD = {
      instanceId: 'hidden-instance-1',
      value: 6,
      type: 'SAQUEADOG_DE_TUMBAS' as const,
    };
    const swapView = publicView({
      round: roundView({ pendingInteraction: { type: 'SAQUEADOG_SWAP', actorId: SELF_ID } }),
    });
    const withSwap = gameReducer(liveGame(swapView), {
      type: 'game/private-state',
      privateView: privateViewWithPending(
        SELF_ID,
        { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
        [{ type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: true }],
        [],
        swapView,
      ),
    });
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, withSwap))}
      />,
    );
    // WU8 behavior untouched: mandatory dialog over the inert table.
    const dialog = screen.getByRole('dialog', { name: /Saqueadog de Tumbas/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The slip is hidden (not discarded) while the modal owns the interaction:
    // its Continue is never visible-but-inert behind the modal.
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();
  });

  it('shows the hidden slip again once the mandatory modal closes, if the evidence remains', () => {
    const HIDDEN_CARD = {
      instanceId: 'hidden-instance-1',
      value: 6,
      type: 'SAQUEADOG_DE_TUMBAS' as const,
    };
    const swapView = publicView({
      round: roundView({ pendingInteraction: { type: 'SAQUEADOG_SWAP', actorId: SELF_ID } }),
    });
    const withSwap = gameReducer(liveGame(swapView), {
      type: 'game/private-state',
      privateView: privateViewWithPending(
        SELF_ID,
        { type: 'SAQUEADOG_SWAP', actorId: SELF_ID, hiddenCard: HIDDEN_CARD },
        [{ type: 'CHOOSE_HIDDEN_SWAP', actorId: SELF_ID, swap: true }],
        [],
        swapView,
      ),
    });
    const controller = controllerStub() as RoomFlowController;
    const { rerender } = render(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, withSwap))}
      />,
    );
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();

    // The modal resolves; the still-captured evidence re-reveals the slip.
    rerender(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, liveGame()))}
      />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toBeInTheDocument();
  });

  it('suppresses the slip entirely when the match has ended (WU10 owns that presentation)', () => {
    let game = liveGame();
    game = gameReducer(game, { type: 'game/match-ended', winners: [SELF_ID] });
    game = gameAfterEvents(
      [
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
        { type: 'MATCH_ENDED', winnerIds: [SELF_ID] },
      ],
      game,
    );
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={stateWithGame(game)} />,
    );
    // No round-result slip: a match-ending batch never captures a result, and
    // WU10's match presentation owns this end state.
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Match result' })).toBeInTheDocument();
  });

  it('auto-clears when the next gameplay event batch arrives, but not on a new projection', () => {
    let game = gameAfterEvents(SINGLE_WIN, liveGame());
    // The server's immediate post-result fanout must not erase the slip.
    game = gameReducer(game, { type: 'game/private-state', privateView: privateView(SELF_ID) });
    game = gameReducer(game, {
      type: 'game/public-state',
      publicView: publicView({ round: roundView() }),
    });
    const { rerender } = render(
      <GameTable controller={controllerStub() as RoomFlowController} state={stateWithGame(game)} />,
    );
    expect(screen.getByRole('status', { name: 'Round result' })).toBeInTheDocument();

    // Actual gameplay resumed: the next non-round-end event batch clears it.
    game = gameReducer(game, {
      type: 'game/events',
      events: [{ type: 'CARD_DRAWN', playerId: OTHER_ID }],
    });
    rerender(
      <GameTable controller={controllerStub() as RoomFlowController} state={stateWithGame(game)} />,
    );
    expect(screen.queryByRole('status', { name: 'Round result' })).toBeNull();
  });
});
