'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { GameTable } from '@/components/game/game-table';
import { Lobby } from '@/components/lobby';
import { getRoomFlowController } from '@/lib/room-flow/room-flow';
import { useRoomFlowState } from '@/lib/room-flow/use-room-flow';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const controller = getRoomFlowController();
  const state = useRoomFlowState(controller);
  const code = String(params.code ?? '').toUpperCase();

  // Lobby owns initial entry. This route-level guard handles the otherwise
  // unreachable case where navigation changes while the live table is mounted.
  useEffect(() => {
    if (state.roomCode !== null && state.roomCode !== code) {
      controller.enterRoom(code);
    }
  }, [code, controller, state.roomCode]);

  const roomMatchesRoute = state.roomCode === code;
  const boundToDifferentRoom = state.roomCode !== null && !roomMatchesRoute;

  return (
    <main className="lobby">
      {boundToDifferentRoom ? (
        <section className="game-table-message" role="status">
          Switching rooms — clearing the previous table.
        </section>
      ) : state.room?.status === 'IN_MATCH' ? (
        <GameTable controller={controller} state={state} />
      ) : (
        <Lobby
          code={code}
          controller={controller}
          navigate={(to) => {
            router.push(to);
          }}
        />
      )}
    </main>
  );
}
