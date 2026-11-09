import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'nucleo/test/**/*.test.ts',
      'midia/test/**/*.test.ts',
      'canais/*/test/**/*.test.ts',
      'servidor-udid/test/**/*.test.ts',
    ],
    testTimeout: 20000,
  },
});
