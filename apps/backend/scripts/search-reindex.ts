/**
 * Rebuilds the search index from the catalogue: `pnpm --filter backend search:reindex`.
 * Uses the configured engine (Typesense with DATA_STORE=postgres). Safe to run any time.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SearchIndexer } from '../src/modules/search-discovery/search-indexer.service';

process.env.RUN_WORKERS = 'false'; // just this job, no relay/workers

void (async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const counts = await app.get(SearchIndexer).reindexAll();
  console.log(`Indexed ${counts.merchants} stores and ${counts.items} items.`);
  await app.close();
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
