/**
 * React subscription seam for the room-flow controller: components read the
 * shared state through one hook and never hold room-flow logic themselves.
 */
import { useSyncExternalStore } from 'react';
import type { RoomFlowController } from '@/lib/room-flow/room-flow';
import type { RoomFlowState } from '@/lib/room-flow/reducer';

/** Subscribes a component to the room-flow state. */
export function useRoomFlowState(controller: RoomFlowController): RoomFlowState {
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
