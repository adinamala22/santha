import { createApp } from './app.factory';
import { parseEnv } from './config/env';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = parseEnv(process.env); // fail fast on bad config
  const app = await createApp();

  // In watch mode the previous process can still be releasing the port when we start; retry briefly
  // instead of dying silently. In production a busy port is a real error.
  const attempts = env.NODE_ENV === 'development' ? 20 : 1;
  for (let i = 1; ; i++) {
    try {
      await app.listen(env.PORT);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i >= attempts) throw err;
      await sleep(500);
    }
  }
}

main().catch((err: unknown) => {
  console.error('Fatal: backend failed to start', err);
  process.exit(1);
});
