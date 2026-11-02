import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../../common/auth/decorators';
import { DiscoveryService } from './discovery.service';
import { FeedDto, FeedQueryDto, SearchDto, SearchQueryDto, toStoreDto } from './dto/discovery.dto';

/** Public: browsing works before sign-in (location first, like the consumer app's first run). */
@ApiTags('discovery')
@Public()
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('feed')
  @ZodResponse({ type: FeedDto, description: 'Home feed: stores of one supply type that deliver here, ranked, with ETA chips' })
  async feed(@Query() q: FeedQueryDto) {
    const r = await this.discovery.feed({ lat: q.lat, lng: q.lng }, q.tab, { openNow: q.openNow, selfDelivered: q.selfDelivered, maxEtaMin: q.maxEta });
    return { ...r, stores: r.stores.map(toStoreDto) };
  }

  @Get('search')
  @ZodResponse({ type: SearchDto, description: 'Search items and stores nearby, grouped by store (typo-tolerant, Telugu synonyms)' })
  async search(@Query() q: SearchQueryDto) {
    const r = await this.discovery.search(q.q, { lat: q.lat, lng: q.lng }, { openNow: q.openNow, vegOnly: q.veg, selfDelivered: q.selfDelivered, maxEtaMin: q.maxEta });
    return { ...r, groups: r.groups.map((g) => ({ ...g, store: toStoreDto(g.store) })), stores: r.stores.map(toStoreDto) };
  }
}
