import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server as HttpServer } from 'node:http';
import { AppModule } from './app.module';

/** Concrete server instances plus the bound port and a close handle. */
export interface ServerHandles {
  /** The underlying HTTP server (useful for assertions in tests). */
  httpServer: HttpServer;
  /** Port the server is listening on; resolved after listen. */
  port: number;
  /** Fully initialized Nest application. */
  app: NestExpressApplication;
  /** Closes the Nest app and the HTTP server; resolves once fully closed. */
  close: () => Promise<void>;
}

/** Options for the programmatic server bootstrap seam. */
export interface CreateServerOptions {
  /** Port to listen on. Use `0` to bind an ephemeral port (tests). */
  port: number;
}

/**
 * Creates and starts the server programmatically. This seam exists so tests
 * can boot on port 0 and shut down cleanly without process-level side effects.
 */
export async function createServer(options: CreateServerOptions): Promise<ServerHandles> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });

  const httpServer = app.getHttpServer() as HttpServer;
  await app.listen(options.port);
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    httpServer,
    port,
    app,
    close: async () => {
      await app.close();
    },
  };
}
