import { Module } from '@nestjs/common';
import { TrustSafetyService } from './trust-safety.service';

/**
 * trust-safety — prohibited-item screening (M2); moderation, ratings, issues, disputes, trust
 * scores later (M7, M8). Owns its tables; other modules use TrustSafetyService or its events only.
 */
@Module({ providers: [TrustSafetyService], exports: [TrustSafetyService] })
export class TrustSafetyModule {}
