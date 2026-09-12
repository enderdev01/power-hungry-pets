/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  preset: 'ts-jest',
  // Intentionally uses the workspace `tsconfig.json` (ts-jest default lookup
  // from rootDir) so tests compile with the same settings as the build.
  moduleNameMapper: {
    '^@power-hungry-pets/game-engine$': '<rootDir>/../../packages/game-engine/src/index.ts',
  },
};
