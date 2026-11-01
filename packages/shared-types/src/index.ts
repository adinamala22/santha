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

/** Error envelope returned by every non-2xx response. */
export interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId?: string };
}

export const API_PREFIX = '/v1' as const;
