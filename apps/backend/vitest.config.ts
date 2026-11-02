import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed so Nest's decorator metadata (DI by type) is emitted under Vitest.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/e2e/**/*.spec.ts'],
          environment: 'node',
          setupFiles: ['test/setup-env.ts'],
          // HTTP suites boot the whole AppModule in beforeAll; CI runners need more than the 10 s default.
          hookTimeout: 60_000,
        },
      },
      {
        plugins,
        test: {
          // Fake-mode acceptance: real AppModule with DATA_STORE=memory, no Docker (one file per milestone).
          name: 'fake',
          include: ['test/fake/**/*.fake.spec.ts'],
          environment: 'node',
          setupFiles: ['test/setup-env.ts'],
        },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int.spec.ts'],
          environment: 'node',
          setupFiles: ['test/setup-env.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
    coverage: { provider: 'v8', include: ['src/**/*.ts'] },
  },
});
