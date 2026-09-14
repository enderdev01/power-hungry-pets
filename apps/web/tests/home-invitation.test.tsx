/**
 * Home invitation contract: the pinned-invitation entry — name on the slip,
 * create a room, join by code — with busy states, textual validation errors,
 * and no SaaS-dashboard framing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeInvitation } from '@/components/home-invitation';
import {
  createMemoryStores,
  createRoomFlowController,
  type MembershipAck,
  type RoomFlowGateway,
} from '@/lib/room-flow/controller';
import type { RoomSnapshot } from '@power-hungry-pets/protocol';

function roomSnapshot(): RoomSnapshot {
  return {
    roomId: 'room-1',
    code: 'ABC12',
    status: 'LOBBY',
    hostPlayerId: 'p-host',
    createdAt: 1,
    players: [
      {
        playerId: 'p-host',
        displayName: 'Ana',
        seatNumber: 1,
        connected: true,
        isHost: true,
        joinedAt: 0,
      },
    ],
  };
}

type CreateBehavior = () => Promise<MembershipAck & { reconnectToken: string }>;

interface Fixture {
  controller: ReturnType<typeof createRoomFlowController>;
  calls: { createRoom: number };
}

function controllerWithCreate(create: CreateBehavior): Fixture {
  const calls = { createRoom: 0 };
  const connectionCbs: Array<(status: 'connected' | 'disconnected' | 'connecting') => void> = [];
  const gateway = {
    connect: () => {
      for (const cb of [...connectionCbs]) cb('connected');
    },
    disconnect: () => {},
    createRoom: (): Promise<MembershipAck & { reconnectToken: string }> => {
      calls.createRoom += 1;
      return create();
    },
    joinRoom: () => Promise.reject(new Error('not scripted')),
    startMatch: () => Promise.resolve({ room: roomSnapshot() }),
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
  return { controller: createRoomFlowController(gateway, { stores: createMemoryStores() }), calls };
}

function ackError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { name: 'GatewayAckError', code });
}

describe('HomeInvitation', () => {
  it('disables creating while the name slip is empty', () => {
    const { controller } = controllerWithCreate(() => Promise.reject(new Error('not scripted')));
    render(<HomeInvitation controller={controller} navigate={() => {}} />);

    expect(screen.getByRole('button', { name: /crear una sala/i })).toBeDisabled();
  });

  it('creates a room and navigates to its lobby', async () => {
    const { controller, calls } = controllerWithCreate(() =>
      Promise.resolve({
        roomId: 'room-1',
        code: 'ABC12',
        playerId: 'p-host',
        seatNumber: 1,
        room: roomSnapshot(),
        reconnectToken: 'tok',
      }),
    );
    const navigate = jest.fn();
    render(<HomeInvitation controller={controller} navigate={navigate} />);

    await userEvent.type(screen.getByLabelText(/tu nombre/i), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: /crear una sala/i }));

    expect(calls.createRoom).toBe(1);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/room/ABC12'));
  });

  it('shows a busy label while the create request is in flight', async () => {
    let resolveCreate: (value: MembershipAck & { reconnectToken: string }) => void = () => {};
    const { controller } = controllerWithCreate(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(<HomeInvitation controller={controller} navigate={() => {}} />);

    await userEvent.type(screen.getByLabelText(/tu nombre/i), 'Ana');
    const createPromise = userEvent.click(screen.getByRole('button', { name: /crear una sala/i }));

    expect(await screen.findByText(/creando la sala/i)).toBeInTheDocument();
    resolveCreate({
      roomId: 'room-1',
      code: 'ABC12',
      playerId: 'p-host',
      seatNumber: 1,
      room: roomSnapshot(),
      reconnectToken: 'tok',
    });
    await createPromise;
  });

  it('surfaces a rejected create as a recoverable error banner', async () => {
    const { controller } = controllerWithCreate(() =>
      Promise.reject(ackError('INVALID_DISPLAY_NAME', 'bad name')),
    );
    render(<HomeInvitation controller={controller} navigate={() => {}} />);

    await userEvent.type(screen.getByLabelText(/tu nombre/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /crear una sala/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /volver al formulario/i })).toBeInTheDocument();
  });

  it('navigates a well-formed code to the lobby without socket traffic', async () => {
    const { controller, calls } = controllerWithCreate(() =>
      Promise.reject(new Error('not scripted')),
    );
    const navigate = jest.fn();
    render(<HomeInvitation controller={controller} navigate={navigate} />);

    await userEvent.type(screen.getByLabelText(/código de sala/i), 'abc12');
    await userEvent.click(screen.getByRole('button', { name: /entrar a una sala/i }));

    expect(calls.createRoom).toBe(0);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/room/ABC12'));
  });

  it('rejects a malformed code with inline text, before any navigation', async () => {
    const { controller } = controllerWithCreate(() => Promise.reject(new Error('not scripted')));
    const navigate = jest.fn();
    render(<HomeInvitation controller={controller} navigate={navigate} />);

    await userEvent.type(screen.getByLabelText(/código de sala/i), 'AB1');
    await userEvent.click(screen.getByRole('button', { name: /entrar a una sala/i }));

    expect(screen.getByText(/los códigos de sala tienen 5 caracteres/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('links the malformed-code message to the field with aria-invalid', async () => {
    const { controller } = controllerWithCreate(() => Promise.reject(new Error('not scripted')));
    const navigate = jest.fn();
    render(<HomeInvitation controller={controller} navigate={navigate} />);

    await userEvent.type(screen.getByLabelText(/código de sala/i), 'AB1');
    await userEvent.click(screen.getByRole('button', { name: /entrar a una sala/i }));

    const message = screen.getByText(/los códigos de sala tienen 5 caracteres/i);
    expect(message).toHaveAttribute('id', 'room-code-problem');
    const codeInput = screen.getByLabelText(/código de sala/i);
    expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput).toHaveAttribute('aria-describedby', 'room-code-problem');
  });

  it('marks the code field valid again for a well-formed code', async () => {
    const { controller } = controllerWithCreate(() => Promise.reject(new Error('not scripted')));
    const navigate = jest.fn();
    render(<HomeInvitation controller={controller} navigate={navigate} />);

    await userEvent.type(screen.getByLabelText(/código de sala/i), 'ABC12');
    await userEvent.click(screen.getByRole('button', { name: /entrar a una sala/i }));

    expect(screen.getByLabelText(/código de sala/i)).toHaveAttribute('aria-invalid', 'false');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/room/ABC12'));
  });

  it('announces connection status as text near the invitation', () => {
    const { controller } = controllerWithCreate(() => Promise.reject(new Error('not scripted')));
    render(<HomeInvitation controller={controller} navigate={() => {}} />);

    expect(screen.getByText(/accedé al tablero/i)).toBeInTheDocument();
  });
});
