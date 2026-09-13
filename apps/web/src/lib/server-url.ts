/**
 * Environment configuration for the web client: the game server URL is
 * configurable and falls back to a safe local default.
 */
const DEFAULT_GAME_SERVER_URL = 'http://localhost:3001';

/** Resolves the Socket.IO game server URL for this browser session. */
export function gameServerUrl(): string {
  const raw = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) {
    return raw.trim().replace(/\/+$/, '');
  }
  return DEFAULT_GAME_SERVER_URL;
}
