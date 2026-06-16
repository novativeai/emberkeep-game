import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/systems/**', 'src/core/**']
    }
  }
});
