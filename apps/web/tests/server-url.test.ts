/**
 * Environment configuration contract: the game server URL is configurable and
 * falls back to a safe local default.
 */
import { gameServerUrl } from '@/lib/server-url';

describe('gameServerUrl', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_GAME_SERVER_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NEXT_PUBLIC_GAME_SERVER_URL;
    } else {
      process.env.NEXT_PUBLIC_GAME_SERVER_URL = ORIGINAL;
    }
  });

  it('defaults to the local game server', () => {
    delete process.env.NEXT_PUBLIC_GAME_SERVER_URL;
    expect(gameServerUrl()).toBe('http://localhost:3001');
  });

  it('uses the configured URL verbatim', () => {
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = 'https://games.example.com';
    expect(gameServerUrl()).toBe('https://games.example.com');
  });

  it('trims whitespace and trailing slashes', () => {
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = '  https://games.example.com/  ';
    expect(gameServerUrl()).toBe('https://games.example.com');
  });

  it('falls back to the safe default on a malformed value', () => {
    process.env.NEXT_PUBLIC_GAME_SERVER_URL = 'javascript:alert(1)';
    expect(gameServerUrl()).toBe('http://localhost:3001');
  });
});
