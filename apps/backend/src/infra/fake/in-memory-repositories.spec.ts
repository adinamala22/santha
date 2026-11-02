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
import { addressRepositoryContract } from '../../../test/contracts/address.contract';
import { InMemoryAddressRepository } from '../../modules/identity-kyc/addresses.repository';
import { randomUUID } from 'node:crypto';

microMarketRepositoryContract('in-memory', async () => new InMemoryMicroMarketRepository());
merchantRepositoryContract('in-memory', async () => new InMemoryMerchantRepository());
kycRepositoryContract('in-memory', async () => new InMemoryKycRepository());
catalogueRepositoryContract('in-memory', async () => ({ catalogue: new InMemoryCatalogueRepository(), merchants: new InMemoryMerchantRepository() }));
addressRepositoryContract('in-memory', async () => ({ repo: new InMemoryAddressRepository(), userId: async () => randomUUID() }));

// M4
import { orderRepositoryContract, paymentsRepositoryContract, promoRepositoryContract } from '../../../test/contracts/m4.contract';
import { InMemoryOrderRepository } from '../../modules/orders/orders.repository';
import { InMemoryCartPricingRepository } from '../../modules/cart-pricing/cart-pricing.repository';
import { InMemoryPaymentsRepository } from '../../modules/payments-settlement/payments.repository';

orderRepositoryContract('in-memory', async () => new InMemoryOrderRepository());
promoRepositoryContract('in-memory', async () => new InMemoryCartPricingRepository());
paymentsRepositoryContract('in-memory', async () => new InMemoryPaymentsRepository());

// M5
import { notificationRepositoryContract, orderLifecycleContract } from '../../../test/contracts/m5.contract';
import { InMemoryNotificationRepository } from '../../modules/notifications/notifications.repository';

orderLifecycleContract('in-memory', async () => new InMemoryOrderRepository());
notificationRepositoryContract('in-memory', async () => ({ repo: new InMemoryNotificationRepository(), userId: async () => randomUUID() }));

// M6
import { dispatchRepositoryContract } from '../../../test/contracts/m6.contract';
import { InMemoryDispatchRepository } from '../../modules/dispatch-tracking/dispatch.repository';

dispatchRepositoryContract('in-memory', async () => ({ repo: new InMemoryDispatchRepository(), riderId: async () => randomUUID() }));

// M7
import { issuesRepositoryContract, moneyRepositoryContract } from '../../../test/contracts/m7.contract';
import { InMemoryMoneyRepository } from '../../modules/payments-settlement/settlement/money.repository';
import { InMemoryIssuesRepository } from '../../modules/trust-safety/issues.repository';

moneyRepositoryContract('in-memory', async () => new InMemoryMoneyRepository());
issuesRepositoryContract('in-memory', async () => new InMemoryIssuesRepository());

// M8
import { complianceRepositoryContract, leadsRepositoryContract, reviewModerationContract } from '../../../test/contracts/m8.contract';
import { InMemoryLeadsRepository } from '../../modules/analytics-config/growth/leads.repository';
import { InMemoryComplianceRepository } from '../../modules/trust-safety/compliance.repository';

complianceRepositoryContract('in-memory', async () => ({ repo: new InMemoryComplianceRepository(), userId: async () => randomUUID() }));
leadsRepositoryContract('in-memory', async () => new InMemoryLeadsRepository());
reviewModerationContract('in-memory', async () => new InMemoryIssuesRepository());
