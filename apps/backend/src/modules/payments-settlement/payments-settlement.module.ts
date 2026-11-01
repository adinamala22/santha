import { Module } from '@nestjs/common';

/**
 * payments-settlement — payment intents, webhooks, refunds, wallet, settlement runs (M4, M7).
 * Scaffolded in M0; see BUILD-PLAN.md for the milestone that fills it in.
 * Owns its tables; other modules use its exported services or its events only.
 */
@Module({})
export class PaymentsSettlementModule {}
