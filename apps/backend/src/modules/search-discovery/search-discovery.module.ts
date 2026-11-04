import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { GoogleRoutesProvider, MapsProvider, MockMapsProvider } from '../../infra/providers/maps/maps.provider';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { MerchantCatalogueModule } from '../merchant-catalogue/merchant-catalogue.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { EtaService } from './eta.service';
import { InMemorySearchIndex } from './in-memory-search.index';
import { SearchIndex } from './search-index';
import { SearchIndexer } from './search-indexer.service';
import { StoreRatings } from './store-ratings';
import { TypesenseSearchIndex } from './typesense-search.index';

/**
 * search-discovery — search index (Typesense; in-memory in fake mode), indexing from catalogue
 * events, /v1/feed and /v1/search, ETA v1 and ranking from micro-market config (M2).
 * Events in: merchant.*, item.* and rating.* (see SearchIndexer.INDEXED_EVENTS), media.approved|rejected.
 * Store ratings come from trust-safety through StoreRatings (registered at start-up).
 * Reads the catalogue only through CatalogueService.
 */
@Module({
  imports: [MerchantCatalogueModule, AnalyticsConfigModule],
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    EtaService,
    SearchIndexer,
    StoreRatings,
    {
      provide: SearchIndex,
      inject: [ENV],
      useFactory: (env: Env) => (env.SEARCH_ENGINE === 'typesense' ? new TypesenseSearchIndex(env) : new InMemorySearchIndex()),
    },
    {
      provide: MapsProvider,
      inject: [ENV],
      // Dev, test and fake mode never call Google.
      useFactory: (env: Env) =>
        env.MAPS_PROVIDER === 'google' && env.DATA_STORE !== 'memory' && env.NODE_ENV !== 'test' ? new GoogleRoutesProvider(env.GOOGLE_MAPS_SERVER_KEY!) : new MockMapsProvider(),
    },
  ],
  exports: [DiscoveryService, SearchIndexer, StoreRatings],
})
export class SearchDiscoveryModule {}
