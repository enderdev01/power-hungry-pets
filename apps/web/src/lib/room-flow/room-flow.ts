/**
 * App-scoped room-flow singleton: one controller and one transport for the
 * whole client bundle, so membership survives client-side navigation between
 * the home invitation and a room lobby. Safe to import from client
 * components during SSR: no socket is opened until a component connects.
 */
import { SocketRoomFlowGateway } from '@/lib/socket/socket-gateway';
import { createBrowserStores } from './client-storage';
import { createRoomFlowController, type RoomFlowController } from './controller';
import { gameServerUrl } from '../server-url';

export type { RoomFlowController } from './controller';

let instance: RoomFlowController | null = null;

/** Returns the app-scoped controller, creating it on first use. */
export function getRoomFlowController(): RoomFlowController {
  if (instance === null) {
    instance = createRoomFlowController(new SocketRoomFlowGateway(gameServerUrl()), {
      stores: createBrowserStores(),
    });
  }
  return instance;
}
