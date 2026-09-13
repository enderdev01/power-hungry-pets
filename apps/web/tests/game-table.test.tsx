/**
 * Game table shell contract (M7 slice): the table renders purely from
 * authoritative server projections — public view for the shared table and the
 * viewer's own private view for the face-up hand. It must show a truthful
 * loading/recovery state while projections are missing, must never render
 * another player's hidden information, must never invent state, and must
 * contain no gameplay command controls in this slice.
 */
import { render, screen } from '@testing-library/react';
import { GameTable } from '@/components/game/game-table';
import { createInitialRoomFlowState, type RoomFlowState } from '@/lib/room-flow/reducer';
import type { PrivateGameView, PublicGameView } from '@power-hungry-pets/protocol';
import {
  privateView,
  publicView,
  roomSnapshotInMatch,
  SELF_ID,
  OTHER_ID,
  roundView,
} from './helpers/game-views';

function flowState(overrides: {
  publicView?: PublicGameView | null;
  privateView?: PrivateGameView | null;
  matchEnded?: boolean;
  matchWinners?: string[];
}): RoomFlowState {
  return {
    ...createInitialRoomFlowState(),
    connection: 'connected',
    room: roomSnapshotInMatch(),
    roomCode: 'ABC12',
    self: { playerId: SELF_ID, seatNumber: 1 },
    game: {
      publicView: overrides.publicView !== undefined ? overrides.publicView : publicView(),
      privateView: overrides.privateView !== undefined ? overrides.privateView : privateView(),
      matchEnded: overrides.matchEnded ?? false,
      matchWinners: overrides.matchWinners ?? [],
      recentEvents: [],
    },
  };
}

describe('game table shell', () => {
  it('shows a truthful waiting state while the initial projections are missing', () => {
    render(<GameTable state={flowState({ publicView: null, privateView: null })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/table is being prepared/i);
    // No invented state: the roster's names must not be rendered as players.
    expect(screen.queryByText('Bruno')).toBeNull();
    expect(screen.queryByText(/your hand/i, { selector: '[data-hand-ready="true"]' })).toBeNull();
  });

  it('renders both seats from the public view with counts, tokens, and status', () => {
    render(<GameTable state={flowState({})} />);
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
    render(<GameTable state={flowState({})} />);
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
    render(<GameTable state={flowState({ publicView: eliminated })} />);
    expect(screen.getAllByText(/eliminated/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rey Gato/i)).toBeInTheDocument();
  });

  it('renders the current-turn text from the authoritative phase', () => {
    render(<GameTable state={flowState({})} />);
    expect(screen.getByText(/Waiting for Bruno to play a card/i)).toBeInTheDocument();
  });

  it('uses the authoritative phase in the current-turn prompt', () => {
    const playTurn = publicView({ round: roundView({ currentPlayerId: SELF_ID }) });
    const { rerender } = render(<GameTable state={flowState({ publicView: playTurn })} />);
    expect(screen.getByText(/YOUR TURN — play a card/i)).toBeInTheDocument();

    const drawTurn = publicView({
      round: roundView({ currentPlayerId: SELF_ID, phase: 'DRAW_REQUIRED' }),
    });
    rerender(<GameTable state={flowState({ publicView: drawTurn })} />);
    expect(screen.getByText(/YOUR TURN — draw a card/i)).toBeInTheDocument();
  });

  it('announces a public pending decision without revealing private data', () => {
    const pending = publicView({
      round: roundView({
        pendingInteraction: { type: 'RATON_INSERT_POSITION', actorId: OTHER_ID },
      }),
    });
    render(<GameTable state={flowState({ publicView: pending })} />);
    expect(screen.getByText(/Bruno is resolving Ratón Trampero/i)).toBeInTheDocument();
  });

  it('renders draw-pile count and hidden-card presence without identity', () => {
    render(<GameTable state={flowState({})} />);
    expect(screen.getByText(/^18 cards$/i)).toBeInTheDocument();
    expect(screen.getByText(/^1 face down$/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Draw pile, face down' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hidden card, face down' })).toBeInTheDocument();
  });

  it('renders the own face-up hand only from the viewer-matched private view', () => {
    const { container } = render(<GameTable state={flowState({})} />);
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
        state={flowState({})}
        assetConfig={{ images: { 'card/malabarista-de-ocho-patas': '/m8/card-7.webp' } }}
      />,
    );
    const ownCard = container.querySelector('[data-art-key="card/malabarista-de-ocho-patas"]');
    expect(ownCard).toHaveAttribute('data-art-kind', 'image');
    expect(ownCard?.querySelector('img')).toHaveAttribute('src', '/m8/card-7.webp');
  });

  it('never renders a private view addressed to a different viewer', () => {
    render(<GameTable state={flowState({ privateView: privateView(OTHER_ID) })} />);
    expect(screen.getByText(/hand has not arrived yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Malabarista de Ocho Patas/i)).toBeNull();
  });

  it('shows a truthful hand state while the private projection is missing', () => {
    render(<GameTable state={flowState({ privateView: null })} />);
    expect(screen.getByText(/hand has not arrived yet/i)).toBeInTheDocument();
  });

  it('contains no gameplay command controls in this slice', () => {
    const { container } = render(<GameTable state={flowState({})} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('announces a match end with the winners resolved by name', () => {
    render(<GameTable state={flowState({ matchEnded: true, matchWinners: [OTHER_ID] })} />);
    expect(screen.getByText(/The match is over — Bruno won/i)).toBeInTheDocument();
  });
});
