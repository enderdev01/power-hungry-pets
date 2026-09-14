'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { GameTable } from '@/components/game/game-table';
import { Lobby } from '@/components/lobby';
import { TABLETOP_ASSET_CONFIG } from '@/lib/game/card-assets';
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

  const inTable =
    !boundToDifferentRoom &&
    (state.room?.status === 'IN_MATCH' ||
      (state.room?.status === 'FINISHED' && state.self !== null));

  return (
    <main className={inTable ? 'table-scene' : 'lobby'}>
      {boundToDifferentRoom ? (
        <section className="game-table-message" role="status">
          Cambiando de sala y cerrando la mesa anterior.
        </section>
      ) : inTable ? (
        // A seated finished room still shows the match result through the
        // game table (WU10). A visitor with no restored seat stays on the
        // lobby entry/rebind path and never sees a finished private game's
        // result.
        <GameTable
          controller={controller}
          state={state}
          assetConfig={TABLETOP_ASSET_CONFIG}
          autoDraw
        />
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
