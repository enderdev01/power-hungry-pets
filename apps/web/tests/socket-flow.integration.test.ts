/**
 * @jest-environment node
 *
 * Milestone 7 vertical-slice acceptance proof, two independent "browser
 * tabs": controller + real-Socket.IO client pairs against the real NestJS
 * gateway. Every test boots its own server on an ephemeral port and owns its
 * tabs, so the suite is independent per test (finding 12); nothing is mocked
 * between controller and server.
 */
import { createServer, type ServerHandles } from '../../server/dist/main';
import { SocketRoomFlowGateway } from '@/lib/socket/socket-gateway';
import {
  createMemoryStores,
  createRoomFlowController,
  type RoomFlowController,
} from '@/lib/room-flow/controller';

jest.setTimeout(20000);

interface TabFixture {
  baseUrl: string;
  tabA: RoomFlowController;
  tabB: RoomFlowController;
  extraTab: () => RoomFlowController;
  close: () => Promise<void>;
}

/** Boots a fresh gateway plus two independent "tabs" for one test. */
async function bootTabs(): Promise<TabFixture> {
  const handles: ServerHandles = await createServer({ port: 0 });
  const baseUrl = `http://127.0.0.1:${handles.port}`;
  const tabs: RoomFlowController[] = [];
  const newTab = (): RoomFlowController => {
    const tab = createRoomFlowController(new SocketRoomFlowGateway(baseUrl), {
      stores: createMemoryStores(),
    });
    tabs.push(tab);
    return tab;
  };
  return {
    baseUrl,
    tabA: newTab(),
    tabB: newTab(),
    extraTab: newTab,
    close: async () => {
      for (const tab of tabs) {
        tab.disconnect();
      }
      await handles.close();
    },
  };
}

describe('two-tab room flow against the real gateway', () => {
  it('walks create → join → shared lobby → host-only start → match started', async () => {
    const fixture = await bootTabs();
    const { tabA, tabB } = fixture;

    // Tab A pins a new room to the noticeboard.
    const code = await tabA.createRoom('Ana');
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(tabA.getState().room?.players).toHaveLength(1);
    expect(tabA.getState().self).toEqual({ playerId: expect.any(String), seatNumber: 1 });
    expect(
      tabA
        .getState()
        .notices.map((n) => n.text)
        .join(' '),
    ).toContain('You host seat 1');

    // Tab B joins the same room by code; tab A must see the arrival live.
    const seenArrival = waitUntil(tabA, (s) => (s.room?.players.length ?? 0) === 2);
    const joined = await tabB.joinRoom(code as string, 'Bruno');
    expect(joined).toBe(true);
    await seenArrival;

    expect(tabB.getState().room?.players.map((p) => p.displayName)).toEqual(['Ana', 'Bruno']);
    expect(tabB.getState().self?.seatNumber).toBe(2);
    expect(
      tabA
        .getState()
        .notices.map((n) => n.text)
        .join(' '),
    ).toContain('Bruno arrived (seat 2).');

    // Non-host cannot start: typed NOT_HOST, room unchanged.
    const guestStarted = await tabB.startMatch();
    expect(guestStarted).toBe(false);
    expect(tabB.getState().error?.code).toBe('NOT_HOST');
    expect(tabB.getState().room?.status).toBe('LOBBY');

    // Host starts at two seats: the room reaches IN_MATCH for both tabs.
    const hostStarted = await tabA.startMatch();
    expect(hostStarted).toBe(true);
    await waitUntil(tabA, (s) => s.room?.status === 'IN_MATCH');
    await waitUntil(tabB, (s) => s.room?.status === 'IN_MATCH');
    expect(
      tabA
        .getState()
        .notices.map((n) => n.text)
        .join(' '),
    ).toContain('The match has started.');
    expect(
      tabB
        .getState()
        .notices.map((n) => n.text)
        .join(' '),
    ).toContain('The match has started.');

    await fixture.close();
  });

  it('delivers shared public state and viewer-specific private state after the host starts', async () => {
    const fixture = await bootTabs();
    const { tabA, tabB } = fixture;

    const code = await tabA.createRoom('Ana');
    await tabB.joinRoom(code as string, 'Bruno');
    await waitUntil(tabA, (s) => (s.room?.players.length ?? 0) === 2);

    expect(await tabA.startMatch()).toBe(true);

    // Both tabs converge on the same authoritative public projection.
    await waitUntil(tabA, (s) => s.game.publicView !== null);
    await waitUntil(tabB, (s) => s.game.publicView !== null);
    const publicA = tabA.getState().game.publicView;
    expect(tabB.getState().game.publicView).toEqual(publicA);
    expect(publicA?.players.map((p) => p.name)).toEqual(['Ana', 'Bruno']);
    // Deck arithmetic: 21 cards − 2 hands − 1 hidden card.
    expect(publicA?.round?.drawPileCount).toBe(18);
    expect(publicA?.round?.hiddenCardCount).toBe(1);
    expect(publicA?.round?.currentPlayerId).toBeDefined();

    // Each seat receives its own private projection with its own hand only.
    await waitUntil(tabA, (s) => s.game.privateView !== null);
    await waitUntil(tabB, (s) => s.game.privateView !== null);
    const stateA = tabA.getState();
    const stateB = tabB.getState();
    expect(stateA.game.privateView?.viewerId).toBe(stateA.self?.playerId);
    expect(stateB.game.privateView?.viewerId).toBe(stateB.self?.playerId);
    const handA = stateA.game.privateView?.hand ?? [];
    const handB = stateB.game.privateView?.hand ?? [];
    expect(handA).toHaveLength(1);
    expect(handB).toHaveLength(1);
    expect(handA[0].instanceId).not.toBe(handB[0].instanceId);
    // No private view ever carries another seat's hand identities.
    expect(JSON.stringify(stateA.game.privateView)).not.toContain(handB[0].instanceId);
    expect(JSON.stringify(stateB.game.privateView)).not.toContain(handA[0].instanceId);

    await fixture.close();
  });

  it('keeps the last known game state through a mid-match disconnect and restores it on rebind', async () => {
    const fixture = await bootTabs();
    const { tabA, tabB } = fixture;
    const code = await tabA.createRoom('Ana');
    await tabB.joinRoom(code as string, 'Bruno');
    await waitUntil(tabA, (s) => (s.room?.players.length ?? 0) === 2);
    expect(await tabA.startMatch()).toBe(true);
    await waitUntil(tabB, (s) => s.game.publicView !== null && s.game.privateView !== null);
    const knownPublic = tabB.getState().game.publicView;

    // Recovery safety: a dropped transport keeps the last authoritative state.
    tabB.disconnect();
    expect(tabB.getState().game.publicView).toEqual(knownPublic);

    // Rebinding re-fans out fresh public and private projections.
    const restored = await tabB.restoreSeat(code as string);
    expect(restored).toBe('restored');
    await waitUntil(tabB, (s) => s.game.privateView?.viewerId === s.self?.playerId);
    expect(tabB.getState().game.publicView).not.toBeNull();
    expect(tabB.getState().game.privateView?.hand).toHaveLength(1);

    await fixture.close();
  });

  it('rejects joining an unknown code with a typed error', async () => {
    const fixture = await bootTabs();
    const tab = fixture.extraTab();

    const ok = await tab.joinRoom('ZZZZ9', 'Nobody');

    expect(ok).toBe(false);
    expect(tab.getState().error?.code).toBe('ROOM_NOT_FOUND');
    await fixture.close();
  });

  it('rebinds a dropped tab through its stored room-scoped token', async () => {
    const fixture = await bootTabs();
    const { tabA, tabB } = fixture;
    const code = await tabA.createRoom('Ana');
    await tabB.joinRoom(code as string, 'Bruno');
    await waitUntil(tabA, (s) => (s.room?.players.length ?? 0) === 2);

    tabB.disconnect();
    await waitUntil(tabA, (s) => s.room?.players.some((p) => !p.connected) ?? false);

    const restored = await tabB.restoreSeat(code as string);
    expect(restored).toBe('restored');
    await waitUntil(tabA, (s) => s.room?.players.every((p) => p.connected) ?? false);

    await fixture.close();
  });

  it('treats a stale reconnect token as a clearable, recoverable state', async () => {
    const fixture = await bootTabs();
    const { tabA, tabB } = fixture;
    const code = await tabA.createRoom('Ana');
    await tabB.joinRoom(code as string, 'Bruno');
    await waitUntil(tabA, (s) => (s.room?.players.length ?? 0) === 2);

    tabB.disconnect();
    await waitUntil(tabA, (s) => s.room?.players.some((p) => !p.connected) ?? false);

    // Corrupt the stored token: the rebind must reject, clear the stale
    // seat, and leave a recoverable join path (no room/self retained).
    const outcome = await tabB.restoreSeatWithToken(code as string, 'stale-token');
    expect(outcome).toBe('rejected');
    expect(tabB.getState().self).toBeNull();
    expect(tabB.getState().room).toBeNull();
    expect(tabB.getState().error?.code).toBe('INVALID_RECONNECT_TOKEN');

    await fixture.close();
  });
});

/** Resolves when the controller state satisfies `predicate`. */
async function waitUntil(
  controller: RoomFlowController,
  predicate: (state: ReturnType<RoomFlowController['getState']>) => boolean,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate(controller.getState())) return;
    if (Date.now() > deadline) throw new Error('condition not reached before timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}
