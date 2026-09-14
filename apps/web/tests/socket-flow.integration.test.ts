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
import { evaluateMatchResult } from '@/lib/game/match-result';
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
    ).toContain('Sos el anfitrión del asiento 1');

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
    ).toContain('Bruno llegó (asiento 2).');

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
    ).toContain('La partida comenzó.');
    expect(
      tabB
        .getState()
        .notices.map((n) => n.text)
        .join(' '),
    ).toContain('La partida comenzó.');

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

describe('match-end acceptance over real sockets (WU10)', () => {
  // A full match is driven command by command; give it its own generous budget.
  jest.setTimeout(120_000);

  const COMMAND_BUDGET = 600;
  const MATCH_DEADLINE_MS = 90_000;

  type LegalAction = NonNullable<
    ReturnType<RoomFlowController['getState']>['game']['privateView']
  >['legalActions'][number];

  /** The single seat whose latest private projection carries legal actions. */
  function authorizedSeat(tabs: RoomFlowController[]): RoomFlowController | undefined {
    const authorized = tabs.filter(
      (tab) => (tab.getState().game.privateView?.legalActions.length ?? 0) > 0,
    );
    return authorized.length === 1 ? authorized[0] : undefined;
  }

  /** Echoes the exact canonical action through the tab's typed controller. */
  async function echoAction(tab: RoomFlowController, action: LegalAction): Promise<boolean> {
    switch (action.type) {
      case 'DRAW_CARD':
        return tab.drawCard();
      case 'PLAY_CARD':
        return action.targetId === undefined
          ? tab.playCard(action.cardInstanceId)
          : tab.playCard(action.cardInstanceId, action.targetId);
      case 'CHOOSE_TARGET':
        return tab.chooseTarget(action.targetId);
      case 'SUBMIT_GUESS':
        return tab.submitGuess(action.value);
      case 'CHOOSE_HIDDEN_SWAP':
        return tab.chooseHiddenSwap(action.swap);
      case 'CHOOSE_DECK_POSITION':
        return tab.chooseDeckPosition(action.index);
    }
  }

  it(
    'drives a two-seat match to MATCH_END, and a reconnecting seat keeps a ' +
      'projection-derived match result',
    async () => {
      const fixture = await bootTabs();
      // The fixture lifetime is owned by this guard: a thrown assertion must
      // still close every tab socket and the Nest server, or stray handles
      // would hang the whole suite past its timeout.
      try {
        const { tabA, tabB } = fixture;
        const tabs = [tabA, tabB];

        const code = await tabA.createRoom('Ana');
        await tabB.joinRoom(code as string, 'Bruno');
        await waitUntil(tabA, (s) => (s.room?.players.length ?? 0) === 2);
        expect(await tabA.startMatch()).toBe(true);
        await waitUntil(tabA, (s) => s.game.publicView !== null && s.game.privateView !== null);
        await waitUntil(tabB, (s) => s.game.publicView !== null && s.game.privateView !== null);

        // Drive the match by echoing exact legalActions, lockstep-fresh: after
        // every echoed command, both seats must have received a new private
        // fanout before the next observation, so no stale action is ever sent.
        const deadline = Date.now() + MATCH_DEADLINE_MS;
        let steps = 0;
        while (tabA.getState().game.publicView?.match.status !== 'MATCH_END') {
          if (Date.now() > deadline) {
            throw new Error(`match did not reach MATCH_END within ${MATCH_DEADLINE_MS}ms`);
          }
          if (steps > COMMAND_BUDGET) {
            throw new Error(`command budget of ${COMMAND_BUDGET} exhausted without a match end`);
          }
          const seat = authorizedSeat(tabs);
          const action = seat?.getState().game.privateView?.legalActions[0];
          if (seat === undefined || action === undefined) {
            await new Promise((resolve) => setTimeout(resolve, 15));
            continue;
          }
          const beforeFanouts = tabs.map((tab) => tab.getState().game.privateView);
          const sent = await echoAction(seat, action);
          expect(sent).toBe(true);
          steps += 1;
          for (let index = 0; index < tabs.length; index += 1) {
            const tab = tabs[index]!;
            const before = beforeFanouts[index];
            await waitUntil(tab, (s) => s.game.privateView !== before, 8000);
          }
        }
        expect(steps).toBeGreaterThan(0);

        // -- both clients receive the match-end projection and results data ----
        const rosterIds = new Set(
          tabs.map((tab) => tab.getState().self?.playerId).filter((id) => id !== undefined),
        );
        // One canonical winner list, taken from the first tab's public
        // projection; every tab must independently match it. Identical per-tab
        // winners must never be concatenated into one doubled list.
        const canonicalWinners = [...(tabA.getState().game.publicView?.match.winners ?? [])].sort();
        for (const tab of tabs) {
          const view = tab.getState().game.publicView;
          expect(view?.match.status).toBe('MATCH_END');
          expect(view?.round).toBeNull();
          expect(view?.match.winners.length).toBeGreaterThan(0);
          expect([...(view?.match.winners ?? [])].sort()).toEqual(canonicalWinners);
          for (const winnerId of view?.match.winners ?? []) {
            expect(rosterIds.has(winnerId)).toBe(true);
          }
          // The match threshold is 3 tokens for a 2-seat match: at least one
          // roster player must carry the winning total in the projection.
          const tokens = (view?.players ?? []).map((player) => player.victoryTokens);
          expect(Math.max(...tokens)).toBeGreaterThanOrEqual(3);
          // A match-end batch belongs to WU10: no round slip may be captured.
          expect(tab.getState().game.roundResult).toBeNull();
        }
        // The live match:ended broadcast arrived as supplemental evidence too.
        expect(tabA.getState().game.matchEnded).toBe(true);
        expect(tabA.getState().room?.status).toBe('FINISHED');
        expect(tabB.getState().room?.status).toBe('FINISHED');

        // -- reconnect after finish --------------------------------------------
        tabB.disconnect();
        await waitUntil(tabA, (s) => s.room?.players.some((p) => !p.connected) ?? false);

        const restored = await tabB.restoreSeat(code as string);
        expect(restored).toBe('restored');
        await waitUntil(
          tabB,
          (s) =>
            s.game.publicView?.match.status === 'MATCH_END' &&
            s.game.privateView?.viewerId === s.self?.playerId,
        );

        // The restored projection alone carries the whole match result: the
        // match broadcast evidence is deliberately withheld (empty winners) to
        // prove the reconnect path never needs it.
        const restoredView = tabB.getState().game.publicView;
        expect([...(restoredView?.match.winners ?? [])].sort()).toEqual(canonicalWinners);
        const restoredModel = evaluateMatchResult(restoredView ?? null, []);
        expect(restoredModel.kind).toBe('visible');
        if (restoredModel.kind !== 'visible') throw new Error('unreachable');
        expect(restoredModel.winners.length).toBeGreaterThan(0);
        for (const winner of restoredModel.winners) {
          expect(rosterIds.has(winner.playerId)).toBe(true);
        }
        expect(restoredModel.totals).toHaveLength(2);
      } finally {
        await fixture.close();
      }
    },
  );
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
