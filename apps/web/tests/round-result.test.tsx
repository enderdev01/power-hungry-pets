/**
 * Round-result slip contract (WU9): the result renders as a centered
 * pinned-paper slip inside the table — information, not a mandatory decision.
 * It is not a modal: no inert, no focus trap, no dialog semantics, and the
 * next round stays playable around it. Continue dismisses locally and sends
 * no game command; a later ROUND_ENDED batch re-arms it; room/game clear
 * resets it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTable } from '@/components/game/game-table';
import { createInitialGameState, gameReducer, type GameState } from '@/lib/game/game-reducer';
import type { RoomFlowController } from '@/lib/room-flow/controller';
import { createInitialRoomFlowState, type RoomFlowState } from '@/lib/room-flow/reducer';
import type { GamePublicEvent, PublicGameView } from '@power-hungry-pets/protocol';
import {
  OTHER_ID,
  THIRD_ID,
  matchEndPublicView,
  privateView,
  privateViewWithPending,
  publicView,
  roomSnapshotInMatch,
  roundView,
  SELF_ID,
} from './helpers/game-views';

const motionCss = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

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
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(slip).toHaveTextContent(/Terminó la ronda 1/i);
    expect(slip).toHaveTextContent(/Ana gana la ronda\./i);
    // Honest exhaustion copy: no winning-hand promise for a last-survivor round.
    expect(slip).toHaveTextContent(/último sobreviviente/i);
  });

  it('uses honest copy when the ended round number is unknown', () => {
    // A live table whose round projection is absent: the evidence still
    // carries no round number, so the copy stays honest.
    const state = stateWithGame(gameAfterEvents(SINGLE_WIN, liveGame(publicView({ round: null }))));
    render(<GameTable controller={controllerStub() as RoomFlowController} state={state} />);
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(slip).toHaveTextContent(/La ronda terminó/i);
    expect(slip).not.toHaveTextContent(/Terminó la ronda \d+/i);
  });

  it('uses shared-win wording when the server announced several winners', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(SHARED_WIN)}
      />,
    );
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toHaveTextContent(
      /Ana y Bruno comparten la victoria de la ronda\./i,
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
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toHaveTextContent(
      /Ana obtuvo 2 fichas de victoria \u2014 ahora tiene 3\./i,
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
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(slip).toHaveTextContent(/Ana obtuvo 2 fichas de victoria\./i);
    expect(slip).not.toHaveTextContent(/ahora tiene \d/i);
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
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(slip).toHaveTextContent(/El mazo se agotó/i);
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
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(slip).toHaveTextContent(/Terminó la ronda 1/i);
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
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toHaveTextContent(
      /Ana, Bruno y Caro comparten la victoria de la ronda\./i,
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
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(slip).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog')).toBeNull();
    // The next round remains playable while the slip is visible.
    expect(screen.getByRole('button', { name: 'Robar una carta' })).toBeEnabled();
  });

  it('dismisses on Continue locally and sends no game command', async () => {
    const controller = controllerStub();
    const state = capturedState(SINGLE_WIN);
    const { rerender } = render(
      <GameTable controller={controller as RoomFlowController} state={state} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
    Object.values(controller as unknown as Record<string, jest.Mock>).forEach((spy) =>
      expect(spy).not.toHaveBeenCalled(),
    );
    // Dismissal is local state: re-rendering the same captured state must not
    // resurrect the dismissed slip.
    rerender(<GameTable controller={controller as RoomFlowController} state={state} />);
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
  });

  it('re-arms a later ROUND_ENDED batch after an explicit dismissal', async () => {
    const controller = controllerStub() as RoomFlowController;
    const { rerender } = render(
      <GameTable controller={controller} state={capturedState(SINGLE_WIN)} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();

    rerender(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SHARED_WIN, liveGame(laterRoundView())))}
      />,
    );
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toHaveTextContent(
      /Ana y Bruno comparten la victoria de la ronda\./i,
    );
  });

  it('shows a fresh capture after a dismissal and a full game-state reset (room rejoin)', async () => {
    const controller = controllerStub() as RoomFlowController;
    const { rerender } = render(
      <GameTable controller={controller} state={capturedState(SINGLE_WIN)} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();

    // Room cleared and a later round ended again: a fresh evidence object
    // re-arms the slip even after the earlier dismissal.
    rerender(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, liveGame(laterRoundView())))}
      />,
    );
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toBeInTheDocument();
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
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
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
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();

    // The modal resolves; the still-captured evidence re-reveals the slip.
    rerender(
      <GameTable
        controller={controller}
        state={stateWithGame(gameAfterEvents(SINGLE_WIN, liveGame()))}
      />,
    );
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toBeInTheDocument();
  });

  it('suppresses the slip entirely when the match has ended (WU10 owns that presentation)', () => {
    let game = liveGame();
    // A real match-ending fanout: the terminal MATCH_END public projection
    // (the only authoritative match-over source) arrives alongside the
    // broadcast batch and the live match-ended evidence.
    game = gameAfterEvents(
      [
        { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
        { type: 'MATCH_ENDED', winnerIds: [SELF_ID] },
      ],
      game,
    );
    game = gameReducer(game, { type: 'game/match-ended', winners: [SELF_ID] });
    game = gameReducer(game, {
      type: 'game/public-state',
      publicView: matchEndPublicView(),
    });
    render(
      <GameTable controller={controllerStub() as RoomFlowController} state={stateWithGame(game)} />,
    );
    // No round-result slip: a match-ending batch never captures a result, and
    // WU10's match presentation owns this end state.
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
    expect(screen.getByRole('status', { name: 'Resultado de la partida' })).toBeInTheDocument();
  });

  it('stays until Continue even when the next round already started playing', async () => {
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
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toBeInTheDocument();

    // A fast next turn (e.g. an automatic draw) must not erase the result.
    game = gameReducer(game, {
      type: 'game/events',
      events: [{ type: 'CARD_DRAWN', playerId: OTHER_ID }],
    });
    rerender(
      <GameTable controller={controllerStub() as RoomFlowController} state={stateWithGame(game)} />,
    );
    expect(screen.getByRole('status', { name: 'Resultado de la ronda' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.queryByRole('status', { name: 'Resultado de la ronda' })).toBeNull();
  });
});

describe('round result reveal motion (M8)', () => {
  const EXHAUSTION: GamePublicEvent[] = [
    {
      type: 'HANDS_REVEALED',
      hands: [
        { playerId: SELF_ID, card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
        { playerId: OTHER_ID, card: { value: 5, type: 'SERPIENTE_ENCANTADORA' } },
      ],
    },
    { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
  ];

  it('applies the one-shot flip to the already-public reveal shells with the round as sequence', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(EXHAUSTION)}
      />,
    );
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    const flips = container.querySelectorAll('[data-motion="card-flip"]');
    expect(flips).toHaveLength(2);
    for (const shell of flips) {
      expect(shell).toHaveAttribute('data-motion-sequence', '1');
      expect(slip).toContainElement(shell);
    }
  });

  it('the stylesheet’s card-flip rule actually reaches the rendered reveal shells', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(EXHAUSTION)}
      />,
    );
    const shells = container.querySelectorAll('[data-motion="card-flip"]');
    expect(shells).toHaveLength(2);

    // Selector-reach contract: parse every stylesheet rule carrying the flip
    // animation and require one whose selector matches the rendered reveal
    // shells. Attribute presence alone never proves the animation starts —
    // a rule scoped to a surface the slip never renders would be dead CSS.
    const source = motionCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({ selector: match[1].trim(), body: match[2] }))
      .filter(
        (rule) => rule.selector.includes('card-flip') && rule.body.includes('motion-card-flip'),
      );
    const reaching = rules.filter((rule) =>
      [...container.querySelectorAll(rule.selector)].some(
        (node) =>
          node.classList.contains('game-card-placeholder') &&
          node.closest('.game-round-result-reveals-list') !== null,
      ),
    );
    expect(reaching).toHaveLength(1);
  });

  it("retriggers the reveal flip by the new round's batch identity after a dismissal", async () => {
    const controller = controllerStub() as RoomFlowController;
    const { container, rerender } = render(
      <GameTable controller={controller} state={capturedState(EXHAUSTION)} />,
    );
    const firstNode = container.querySelector('[data-motion="card-flip"]');
    expect(firstNode).toHaveAttribute('data-motion-sequence', '1');

    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0);

    // Round 2 ends: a fresh capture re-arms the slip and the flip replays with
    // the new round's identity — never a timer.
    rerender(
      <GameTable controller={controller} state={capturedState(EXHAUSTION, laterRoundView())} />,
    );
    const secondNode = container.querySelector('[data-motion="card-flip"]');
    expect(secondNode).not.toBe(firstNode);
    expect(secondNode).toHaveAttribute('data-motion-sequence', '2');
  });

  it('never moves the reveal flip onto private own-hand shells', () => {
    const drawView = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    const withHand = gameReducer(liveGame(drawView), {
      type: 'game/private-state',
      privateView: privateView(
        SELF_ID,
        [{ instanceId: 'own-instance-1', value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' }],
        [],
        drawView,
      ),
    });
    const { container } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={stateWithGame(gameAfterEvents(EXHAUSTION, withHand))}
      />,
    );
    // The slip's public reveal shells flip; the viewer's own hand never does.
    expect(container.querySelectorAll('[data-motion="card-flip"]')).toHaveLength(2);
    const ownHand = screen.getByRole('region', { name: 'Tu mano' });
    expect(ownHand.querySelectorAll('[data-motion]')).toHaveLength(0);
    expect(ownHand.querySelectorAll('.game-card-origin')).toHaveLength(0);
  });
});

describe('round result token award cues (M8)', () => {
  const SHARED_AWARD: GamePublicEvent[] = [
    { type: 'TOKEN_AWARDED', playerId: SELF_ID },
    { type: 'TOKEN_AWARDED', playerId: SELF_ID },
    { type: 'TOKEN_AWARDED', playerId: OTHER_ID },
    { type: 'ROUND_ENDED', winnerIds: [SELF_ID, OTHER_ID] },
  ];

  /** A post-award projection: both awarded seats' committed counts changed. */
  function confirmingView(): PublicGameView {
    return publicView({
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
          victoryTokens: 1,
          handCount: 2,
          discards: [{ card: { value: 10, type: 'REY_GATO' }, origin: 'PLAYED' }],
        },
      ],
    });
  }

  it('marks each award line with the one-shot token cue once the projected counts change', () => {
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(SHARED_AWARD)}
      />,
    );
    // Event-before-projection: the award batch is captured against the
    // pre-award counts, so no cue is confirmed yet.
    expect(container.querySelector('[data-motion="token-settle"]')).toBeNull();

    // The confirming authoritative projection.
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={stateWithGame(
          gameReducer(gameAfterEvents(SHARED_AWARD, liveGame()), {
            type: 'game/public-state',
            publicView: confirmingView(),
          }),
        )}
      />,
    );
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    const awardLines = within(slip).getAllByRole('listitem');
    expect(awardLines).toHaveLength(2);
    for (const line of awardLines) {
      expect(line).toHaveAttribute('data-motion', 'token-settle');
      expect(line).toHaveAttribute('data-motion-sequence', '1');
    }
    // The addressed public racks carry the same committed-award cue.
    expect(
      container.querySelectorAll('.game-token-pulse[data-motion="token-settle"]'),
    ).toHaveLength(2);
  });

  it("the stylesheet's award-line token rule actually reaches the rendered award lines", () => {
    const { container, rerender } = render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState(SHARED_AWARD)}
      />,
    );
    rerender(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={stateWithGame(
          gameReducer(gameAfterEvents(SHARED_AWARD, liveGame()), {
            type: 'game/public-state',
            publicView: confirmingView(),
          }),
        )}
      />,
    );
    const awardLines = [...container.querySelectorAll('.game-round-result-awards li')];
    expect(awardLines).toHaveLength(2);

    // Selector-reach contract: parse every stylesheet rule carrying the token
    // animation and require one whose selector matches the rendered award
    // lines. Attribute presence alone never proves the animation starts.
    const source = motionCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({ selector: match[1].trim(), body: match[2] }))
      .filter(
        (rule) =>
          rule.selector.includes('token-settle') && rule.body.includes('motion-token-settle'),
      );
    const reaching = rules.filter((rule) =>
      [...container.querySelectorAll(rule.selector)].some((node) =>
        awardLines.includes(node as HTMLLIElement),
      ),
    );
    expect(reaching).toHaveLength(1);
  });

  it('resolves every shared award by name and never renders a raw id', () => {
    render(
      <GameTable
        controller={controllerStub() as RoomFlowController}
        state={capturedState([
          { type: 'TOKEN_AWARDED', playerId: 'p-ghost' },
          { type: 'TOKEN_AWARDED', playerId: SELF_ID },
          { type: 'ROUND_ENDED', winnerIds: [SELF_ID] },
        ])}
      />,
    );
    const slip = screen.getByRole('status', { name: 'Resultado de la ronda' });
    expect(within(slip).getByText(/Ana obtuvo 1 ficha de victoria/i)).toBeInTheDocument();
    expect(slip.textContent).not.toContain('p-ghost');
  });
});
