/**
 * Lobby component contract: the noticeboard view renders purely from the
 * room-flow state — room code, player slips, host gating, copy-invite
 * feedback, connection status, and error recovery — with keyboard-accessible
 * actions and no color-only state.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lobby } from '@/components/lobby';
import {
  createMemoryStores,
  createRoomFlowController,
  type MembershipAck,
  type RoomFlowGateway,
} from '@/lib/room-flow/controller';
import type { RoomSnapshot } from '@power-hungry-pets/protocol';

function roomSnapshot(
  players: Array<{ playerId: string; displayName: string; isHost?: boolean; connected?: boolean }>,
  overrides: Partial<RoomSnapshot> = {},
): RoomSnapshot {
  return {
    roomId: 'room-1',
    code: 'ABC12',
    status: 'LOBBY',
    hostPlayerId: players.find((p) => p.isHost)?.playerId ?? players[0].playerId,
    createdAt: 1,
    players: players.map((p, i) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      seatNumber: i + 1,
      connected: p.connected ?? true,
      isHost: p.isHost ?? false,
      joinedAt: i,
    })),
    ...overrides,
  };
}

/** Rejection shaped like the socket adapter's typed ack error. */
function ackError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { name: 'GatewayAckError', code });
}

type StartBehavior = () => Promise<{ room: RoomSnapshot }>;

/** Seeded controller: joins the lobby as the requested seat before render. */
async function seededController(
  room: RoomSnapshot,
  opts: { as: 'host' | 'guest'; start?: StartBehavior },
): Promise<ReturnType<typeof createRoomFlowController>> {
  const selfPlayerId = opts.as === 'host' ? room.players[0].playerId : room.players[1].playerId;
  const selfSeat = opts.as === 'host' ? 1 : 2;
  const connectionCbs: Array<(status: 'connected' | 'disconnected' | 'connecting') => void> = [];
  const gateway = {
    connect: () => {
      for (const cb of [...connectionCbs]) cb('connected');
    },
    disconnect: () => {},
    createRoom: () => Promise.reject(new Error('not scripted')),
    joinRoom: (): Promise<MembershipAck & { reconnectToken: string }> =>
      Promise.resolve({
        roomId: room.roomId,
        code: room.code,
        playerId: selfPlayerId,
        seatNumber: selfSeat,
        room,
        reconnectToken: 'tok',
      }),
    startMatch:
      opts.start ?? (() => Promise.resolve({ room: { ...room, status: 'IN_MATCH' as const } })),
    leaveRoom: () => Promise.resolve({ room: null }),
    onRoomUpdated: () => () => {},
    onConnectionChange: (cb: (status: 'connected' | 'disconnected' | 'connecting') => void) => {
      connectionCbs.push(cb);
      return () => {
        const index = connectionCbs.indexOf(cb);
        if (index >= 0) connectionCbs.splice(index, 1);
      };
    },
  } as unknown as RoomFlowGateway;
  const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
  await controller.joinRoom(room.code, opts.as === 'host' ? 'Ana' : 'Bruno');
  return controller;
}

const LOBBY_TWO = roomSnapshot([
  { playerId: 'p-host', displayName: 'Ana', isHost: true },
  { playerId: 'p-2', displayName: 'Bruno' },
]);

describe('Lobby', () => {
  it('shows the room code, every player slip, and the host marker', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    expect(screen.getByText('ABC12')).toBeInTheDocument();
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    expect(screen.getByText(/Bruno/)).toBeInTheDocument();
    expect(screen.getByText('HOST')).toBeInTheDocument();
  });

  it('marks an away player with text, not just color', async () => {
    const away = roomSnapshot([
      { playerId: 'p-host', displayName: 'Ana', isHost: true },
      { playerId: 'p-2', displayName: 'Bruno', connected: false },
    ]);
    const controller = await seededController(away, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    expect(screen.getByText('away')).toBeInTheDocument();
  });

  it('disables the host start with the minimum-count reason at one player', async () => {
    const alone = roomSnapshot([{ playerId: 'p-host', displayName: 'Ana', isHost: true }]);
    const controller = await seededController(alone, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    const start = screen.getByRole('button', { name: /start the match/i });
    expect(start).toBeDisabled();
    expect(screen.getByText(/waiting for at least 2 players/i)).toBeInTheDocument();
  });

  it('enables the host start at two players and starts through the controller', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    const start = screen.getByRole('button', { name: /start the match/i });
    expect(start).toBeEnabled();
    await userEvent.click(start);
    await waitFor(() => {
      expect(controller.getState().room?.status).toBe('IN_MATCH');
    });
  });

  it('tells non-hosts who they are waiting for instead of a start button', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'guest' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    expect(screen.queryByRole('button', { name: /start the match/i })).toBeNull();
    expect(screen.getByText(/waiting for ana/i)).toBeInTheDocument();
  });

  it('copies an invite link and confirms it textually', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /copy invite/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/room/ABC12'));
    await waitFor(() => {
      expect(screen.getByText(/invite link copied/i)).toBeInTheDocument();
    });
  });

  it('falls back to honest failure text when the clipboard is unavailable', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /copy invite/i }));

    await waitFor(() => {
      expect(screen.getByText(/copy failed/i)).toBeInTheDocument();
    });
  });

  it('shows a connection line that names each transport state', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);
    expect(screen.getByText('Connected.')).toBeInTheDocument();
  });

  it('renders the recovery banner with retry for retryable server errors', async () => {
    const controller = await seededController(LOBBY_TWO, {
      as: 'host',
      start: () => Promise.reject(ackError('RATE_LIMITED', 'too many attempts')),
    });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /start the match/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('confirms a leave and hands control back to navigation', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'guest' });
    const navigate = jest.fn();
    render(<Lobby code="ABC12" controller={controller} navigate={navigate} />);

    await userEvent.click(screen.getByRole('button', { name: /leave the room/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(controller.getState().self).toBeNull();
  });

  it('keeps the notice log reachable as live text', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/You joined room ABC12/)).toBeInTheDocument();
  });

  it('shows the started-match state instead of lobby actions once IN_MATCH', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /start the match/i }));

    await screen.findByText(/follow the game table/i);
    expect(screen.queryByRole('button', { name: /start the match/i })).toBeNull();
  });
});

describe('Lobby stale-state and label safety', () => {
  it('shows a labeled join prompt when this tab has no seat for the room', async () => {
    const gateway = {
      connect: () => {},
      disconnect: () => {},
      createRoom: () => Promise.reject(new Error('not scripted')),
      joinRoom: () => Promise.reject(new Error('not scripted')),
      startMatch: () => Promise.reject(new Error('not scripted')),
      leaveRoom: () => Promise.resolve({ room: null }),
      onRoomUpdated: () => () => {},
      onConnectionChange: () => () => {},
    } as unknown as RoomFlowGateway;
    const controller = createRoomFlowController(gateway, { stores: createMemoryStores() });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pin me to this room/i })).toBeInTheDocument();
  });

  it('clears the previous room when the lobby renders a different code', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ZZZZ9" controller={controller} navigate={() => {}} />);

    await waitFor(() => expect(controller.getState().self).toBeNull());
    expect(controller.getState().room).toBeNull();
    expect(await screen.findByLabelText('Your name')).toBeInTheDocument();
  });
});

describe('Lobby finish-review fixes', () => {
  /** Gateway that never seats this tab: the pre-noticeboard state. */
  function unseatedController() {
    const gateway = {
      connect: () => {},
      disconnect: () => {},
      createRoom: () => Promise.reject(new Error('not scripted')),
      joinRoom: () => Promise.reject(new Error('not scripted')),
      startMatch: () => Promise.reject(new Error('not scripted')),
      leaveRoom: () => Promise.resolve({ room: null }),
      onRoomUpdated: () => () => {},
      onConnectionChange: () => () => {},
    } as unknown as RoomFlowGateway;
    return createRoomFlowController(gateway, { stores: createMemoryStores() });
  }

  it('exposes the room surface as a real heading outline', async () => {
    const controller = await seededController(LOBBY_TWO, { as: 'host' });
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    expect(screen.getByRole('heading', { level: 1, name: 'ABC12' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /players \(2\/6\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /host actions/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /notices/i })).toBeInTheDocument();
  });

  it('fills the empty roster with honest copy before any slip is pinned', async () => {
    const controller = unseatedController();
    render(<Lobby code="ABC12" controller={controller} navigate={() => {}} />);

    expect(await screen.findByText(/no slips pinned yet/i)).toBeInTheDocument();
  });

  it('gives pre-seat users an in-page way back to the invitation', async () => {
    const controller = unseatedController();
    const navigate = jest.fn();
    render(<Lobby code="ABC12" controller={controller} navigate={navigate} />);

    const back = await screen.findByRole('button', { name: /back to the invitation/i });
    await userEvent.click(back);
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
