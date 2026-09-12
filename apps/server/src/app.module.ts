import { Module } from '@nestjs/common';
import { GameGateway } from './gateway/game.gateway';
import { JoinRateLimiter } from './gateway/join-rate-limiter';
import { GameSessionService } from './session/game-session.service';
import { RoomRegistry } from './room/room.registry';

/**
 * Root application module for the Power Hungry Pets server.
 *
 * The room registry and the game-session service are process-wide singletons:
 * the gateway resolves every socket's membership through the registry and every
 * command through the one authoritative session aggregate. Socket.IO wiring is
 * provided by the Nest WebSocket adapter in `main.ts`.
 */
@Module({
  providers: [RoomRegistry, GameSessionService, JoinRateLimiter, GameGateway],
})
export class AppModule {}
