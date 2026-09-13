import { render, screen, waitFor } from '@testing-library/react';
import RoomPage from '@/app/room/[code]/page';
import { createInitialRoomFlowState } from '@/lib/room-flow/reducer';
import { roomSnapshotInMatch } from './helpers/game-views';

const enterRoom = jest.fn();
const controller = { enterRoom };
let routeCode = 'OTHER';
let roomCode: string | null = 'ABC12';
let roomStatus: 'LOBBY' | 'IN_MATCH' = 'IN_MATCH';

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
