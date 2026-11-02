import { Inject, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { buildSeedCatalogue, buildSeedMaster, renderStorePhoto, seedStorePhotoRecords } from '../../dev/seed-catalogue';
import { buildSeedMerchants } from '../../dev/seed-records';
import { FakeSinks } from '../../infra/fake/fake-sinks';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BarcodeLookupProvider, MockBarcodeLookupProvider, OpenFoodFactsProvider } from '../../infra/providers/barcode/barcode.provider';
import { AnalyticsConfigModule } from '../analytics-config/analytics-config.module';
import { MicroMarketsService } from '../analytics-config/micro-markets.service';
import { IdentityKycModule } from '../identity-kyc/identity-kyc.module';
import { TrustSafetyModule } from '../trust-safety/trust-safety.module';
import { MasterCatalogueController, MerchantCatalogueController, OpsCatalogueController } from './catalogue.controller';
import { CatalogueRepository, PrismaCatalogueRepository } from './catalogue.repository';
import { CatalogueService } from './catalogue.service';
import { StalenessJob } from './jobs/staleness.job';
import { InMemoryCatalogueRepository } from './in-memory-catalogue.repository';
import { MediaService } from './media.service';
import { MerchantsController, OpsMerchantsController } from './merchants.controller';
import { InMemoryMerchantRepository, MerchantRepository, PrismaMerchantRepository } from './merchants.repository';
import { MerchantsService } from './merchants.service';

/**
 * Fake mode: renders the seeded store photos into in-memory storage once the app is up (needs
 * Sharp via MediaService, so it cannot run inside the repository factory).
 */
@Injectable()
class FakeStorePhotos implements OnApplicationBootstrap {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repo: CatalogueRepository,
    private readonly media: MediaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.DATA_STORE !== 'memory') return;
    const rows = seedStorePhotoRecords(new Date());
    for (const r of rows) {
      const variants = await this.media.render(await renderStorePhoto(r.storeName, r.storeType), `media/${r.merchantId}/${r.id}`);
      await this.repo.transaction((tx) => tx.updateMedia(r.id, { variants }));
    }
  }
}

/**
 * merchant-catalogue — merchants, staff, hours, radius, store photos (M1/M2); catalogue items and
 * variants, master catalogue + barcode resolution, menus/slots, media pipeline, staleness (M2).
 * Events out: merchant.created|updated|submitted|approved|rejected|went_live|staff_added|
 * catalogue_confirmed|slots_updated, item.created|updated|price_changed|stock_changed|deleted|
 * approved|released|rejected|stale_flagged, media.uploaded|approved|rejected
 * (merchant.kyc_updated comes from identity-kyc's KycService).
 */
@Module({
  imports: [IdentityKycModule, AnalyticsConfigModule, TrustSafetyModule],
  controllers: [MerchantsController, OpsMerchantsController, MerchantCatalogueController, MasterCatalogueController, OpsCatalogueController],
  providers: [
    MerchantsService,
    CatalogueService,
    MediaService,
    StalenessJob,
    FakeStorePhotos,
    {
      provide: MerchantRepository,
      inject: [ENV, PrismaService, FakeSinks, MicroMarketsService],
      useFactory: async (env: Env, prisma: PrismaService, sinks: FakeSinks, markets: MicroMarketsService) => {
        if (env.DATA_STORE !== 'memory') return new PrismaMerchantRepository(prisma);
        // Fake mode: the 12 demo merchants in the seeded micro-markets (identity-kyc seeds their KYC).
        const repo = new InMemoryMerchantRepository(sinks);
        const ids = new Map((await markets.list()).map((m) => [m.market.slug, m.market.id]));
        const seed = buildSeedMerchants(ids);
        repo.seed(seed.merchants, seed.staff);
        new Logger('FakeStore').log(`${seed.merchants.length} demo merchants loaded`);
        return repo;
      },
    },
    {
      provide: CatalogueRepository,
      inject: [ENV, PrismaService, FakeSinks, MerchantRepository, CLOCK],
      useFactory: async (env: Env, prisma: PrismaService, sinks: FakeSinks, merchants: MerchantRepository, clock: Clock) => {
        if (env.DATA_STORE !== 'memory') return new PrismaCatalogueRepository(prisma);
        const repo = new InMemoryCatalogueRepository(sinks);
        const now = clock();
        const all = await merchants.list({ limit: 1000 });
        const market = new Map(all.map((m) => [m.id, m.microMarketId]));
        const cat = buildSeedCatalogue(now, (id) => market.get(id) ?? null);
        const photos = seedStorePhotoRecords(now).map(({ storeName: _n, storeType: _t, ...m }) => m);
        repo.seed({ master: buildSeedMaster(now), items: cat.items, slots: cat.slots, media: photos });
        new Logger('FakeStore').log(`demo catalogue loaded: ${cat.items.length} items, ${cat.slots.length} kitchen slots`);
        return repo;
      },
    },
    {
      provide: BarcodeLookupProvider,
      inject: [ENV],
      // Dev, test and fake mode never call Open Food Facts.
      useFactory: (env: Env) => (env.BARCODE_PROVIDER === 'openfoodfacts' && env.DATA_STORE !== 'memory' && env.NODE_ENV !== 'test' ? new OpenFoodFactsProvider() : new MockBarcodeLookupProvider()),
    },
  ],
  exports: [MerchantsService, CatalogueService],
})
export class MerchantCatalogueModule {}

