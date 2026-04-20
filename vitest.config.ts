import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
    },
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'test/photos.test.ts', 'test/security.test.ts', 'test/tokens.test.ts', 'src/api/__tests__/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/dxt-server.ts', 'src/views/**', 'src/types/**'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        lines: 70,
        functions: 75,
        branches: 70,
        statements: 70,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
