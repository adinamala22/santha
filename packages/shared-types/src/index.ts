// Public surface of @santha/shared-types. `api.ts` is generated — run `pnpm openapi:gen` at the root.
import type { components, operations, paths } from './api';

export type { components, operations, paths };

type Schemas = components['schemas'];

export type OtpRequest = Schemas['OtpRequestDto'];
export type OtpChallenge = Schemas['OtpChallengeDto_Output'];
export type OtpVerify = Schemas['OtpVerifyDto'];
export type AuthSession = Schemas['AuthSessionDto_Output'];
export type TokenPair = Schemas['TokenPairDto_Output'];
export type RefreshRequest = Schemas['RefreshDto'];
export type Me = Schemas['MeDto_Output'];
export type Role = Me['roles'][number];

// M1 — micro-markets, merchants, KYC, audit
export type MicroMarketList = Schemas['MicroMarketListDto_Output'];
export type MicroMarketSummary = MicroMarketList['items'][number];
export type City = MicroMarketList['cities'][number];
export type MicroMarketDetail = Schemas['MicroMarketDetailDto_Output'];
export type MicroMarketVersion = Schemas['VersionDto_Output'];
export type PublishVersion = Schemas['PublishVersionDto'];
export type CreateMicroMarket = Schemas['CreateMicroMarketDto'];
export type Serviceability = Schemas['ServiceabilityDto_Output'];
export type MerchantView = Schemas['MerchantViewDto_Output'];
export type Merchant = MerchantView['merchant'];
export type MerchantStatus = Merchant['status'];
export type MerchantType = Merchant['type'];
export type KycCheck = Schemas['KycCheckDto_Output'];
export type AuditList = Schemas['AuditListDto_Output'];
export type AuditRow = AuditList['items'][number];

// M2 — catalogue, media, search and discovery
export type Item = Schemas['ItemDto_Output'];
export type ItemVariant = Item['variants'][number];
export type ItemPage = Schemas['ItemPageDto_Output'];
export type ItemStatus = Item['status'];
export type CreateItem = Schemas['CreateItemDto'];
export type UpdateItem = Schemas['UpdateItemDto'];
export type Media = Schemas['MediaDto_Output'];
export type MediaList = Schemas['MediaListDto_Output'];
export type QaSummary = Schemas['QaSummaryDto_Output'];
export type BarcodeRequestList = Schemas['BarcodeRequestListDto_Output'];
export type BarcodeResult = Schemas['BarcodeResultDto_Output'];
export type MasterProduct = BarcodeResult['product'];
export type MasterList = Schemas['MasterListDto_Output'];
export type EnrichBarcode = Schemas['EnrichBarcodeDto'];
export type ImportReport = Schemas['ImportReportDto_Output'];
export type CategoryList = Schemas['CategoryListDto_Output'];
export type SlotList = Schemas['SlotListDto_Output'];
export type Feed = Schemas['FeedDto_Output'];
export type StoreCard = Feed['stores'][number];
export type SearchResult = Schemas['SearchDto_Output'];

// M3 — consumer discovery
export type StorePage = Schemas['StoreDto_Output'];
export type Address = Schemas['AddressDto_Output'];
export type AddressList = Schemas['AddressListDto_Output'];

// M4 — cart, checkout, orders, payments, promos
export type Cart = Schemas['CartDto_Output'];
export type Checkout = Schemas['CheckoutDto_Output'];
export type Order = Schemas['OrderDto_Output'];
export type OrderList = Schemas['OrderListDto_Output'];
export type Wallet = Schemas['WalletDto_Output'];
export type Promo = Schemas['PromoDto_Output'];
export type PromoList = Schemas['PromoListDto_Output'];
export type PromoInput = Schemas['PromoInputDto'];
export type PromoPatch = Schemas['PromoPatchDto'];

/** Error envelope returned by every non-2xx response. */
export interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId?: string };
}

export const API_PREFIX = '/v1' as const;
