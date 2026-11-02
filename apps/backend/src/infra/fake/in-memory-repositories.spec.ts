/** Runs the repository contracts against the in-memory stores used by fake mode. */
import {
  kycRepositoryContract,
  merchantRepositoryContract,
  microMarketRepositoryContract,
} from '../../../test/contracts/repositories.contract';
import { InMemoryMicroMarketRepository } from '../../modules/analytics-config/in-memory-micro-markets.repository';
import { InMemoryKycRepository } from '../../modules/identity-kyc/kyc.repository';
import { InMemoryMerchantRepository } from '../../modules/merchant-catalogue/merchants.repository';
import { InMemoryCatalogueRepository } from '../../modules/merchant-catalogue/in-memory-catalogue.repository';
import { catalogueRepositoryContract } from '../../../test/contracts/catalogue.contract';

microMarketRepositoryContract('in-memory', async () => new InMemoryMicroMarketRepository());
merchantRepositoryContract('in-memory', async () => new InMemoryMerchantRepository());
kycRepositoryContract('in-memory', async () => new InMemoryKycRepository());
catalogueRepositoryContract('in-memory', async () => ({ catalogue: new InMemoryCatalogueRepository(), merchants: new InMemoryMerchantRepository() }));
