/**
 * Public entry point for the Power Hungry Pets server workspace.
 * There is no runnable CLI yet: `main.ts` exposes the programmatic
 * `createServer` seam used by tests and future entry points. This file is
 * the import surface for that seam and the gateway contracts.
 */
export { AppModule } from './app.module';
export { GameGateway } from './gateway/game.gateway';
export {
  ackFailure,
  ackSuccess,
  ClientEvents,
  ServerEvents,
  type AckEnvelope,
  type AckErrorCode,
  type ClientEventName,
  type ServerEventName,
  type SystemPingData,
  type SystemPingRequest,
} from './gateway/contracts';
export { createServer, type CreateServerOptions, type ServerHandles } from './main';
export {
  JoinRateLimiter,
  JoinRateLimitError,
  type JoinRateLimiterOptions,
} from './gateway/join-rate-limiter';
export {
  PublicEventError,
  PublicEventErrorCode,
  sanitizePublicEvents,
  type PublicEvent,
  type PublicEventCard,
} from './projection/public-events';
export { GameSessionError, GameSessionErrorCode } from './session/session.errors';
export { GameSessionService } from './session/game-session.service';
export type {
  GameSessionOptions,
  GameSessionRejection,
  GameSessionSnapshot,
  GameSessionSuccess,
  HandleCommandResult,
  SeedFactory,
} from './session/session.types';
export { RoomError, RoomErrorCode } from './room/room.errors';
export { RoomRegistry } from './room/room.registry';
export {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SEATS_PER_ROOM,
  MIN_SEATS_TO_START_MATCH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomStatus,
  type CreateRoomInput,
  type DisconnectSeatInput,
  type JoinRoomInput,
  type LeaveRoomInput,
  type ReconnectResult,
  type ReconnectSeatInput,
  type RoomMembership,
  type RoomPlayerView,
  type RoomRegistryOptions,
  type RoomSnapshot,
  type SocketBindingView,
  type TransitionRoomInput,
} from './room/room.types';
