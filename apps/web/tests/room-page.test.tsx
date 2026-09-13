import { render, screen, waitFor } from '@testing-library/react';
import RoomPage from '@/app/room/[code]/page';
import { createInitialRoomFlowState } from '@/lib/room-flow/reducer';
import { roomSnapshotInMatch } from './helpers/game-views';

const enterRoom = jest.fn();
const controller = { enterRoom };
let routeCode = 'OTHER';
let roomCode: string | null = 'ABC12';
let roomStatus: 'LOBBY' | 'IN_MATCH' | 'FINISHED' = 'IN_MATCH';
let seated = true;

jest.mock('next/navigation', () => ({
  useParams: () => ({ code: routeCode }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/room-flow/room-flow', () => ({
  getRoomFlowController: () => controller,
}));

jest.mock('@/lib/room-flow/use-room-flow', () => ({
  useRoomFlowState: () => ({
    ...createInitialRoomFlowState(),
    roomCode,
    room: { ...roomSnapshotInMatch(), status: roomStatus },
    self: seated ? { playerId: 'p-self', seatNumber: 1 } : null,
  }),
}));

jest.mock('@/components/game/game-table', () => ({
  GameTable: () => <div>game table</div>,
}));

jest.mock('@/components/lobby', () => ({
  Lobby: () => <div>lobby</div>,
}));

describe('room route identity guard', () => {
  beforeEach(() => {
    enterRoom.mockClear();
    routeCode = 'OTHER';
    roomCode = 'ABC12';
    roomStatus = 'IN_MATCH';
    seated = true;
  });

  it('reconciles a changed URL without rendering the previous live table', async () => {
    render(<RoomPage />);
    expect(screen.queryByText('game table')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/switching rooms/i);
    await waitFor(() => expect(enterRoom).toHaveBeenCalledWith('OTHER'));
  });

  it('also hides a stale lobby while route identity is changing', () => {
    roomStatus = 'LOBBY';
    render(<RoomPage />);
    expect(screen.queryByText('lobby')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/switching rooms/i);
  });

  it('leaves initial entry to the lobby when no room is currently bound', async () => {
    roomCode = null;
    render(<RoomPage />);
    await Promise.resolve();
    expect(enterRoom).not.toHaveBeenCalled();
  });
});

describe('finished room route (WU10)', () => {
  beforeEach(() => {
    enterRoom.mockClear();
    routeCode = 'ABC12';
    roomCode = 'ABC12';
    roomStatus = 'FINISHED';
    seated = true;
  });

  it('renders the game table with the match result for a seated finished room', () => {
    render(<RoomPage />);
    expect(screen.getByText('game table')).toBeInTheDocument();
    expect(screen.queryByText('lobby')).toBeNull();
  });

  it('keeps an unseated visitor on the lobby entry path for a finished room', () => {
    // No restored seat: a finished private game's result must never be
    // exposed to a visitor, so the lobby entry/rebind path stays.
    seated = false;
    render(<RoomPage />);
    expect(screen.getByText('lobby')).toBeInTheDocument();
    expect(screen.queryByText('game table')).toBeNull();
  });
});
