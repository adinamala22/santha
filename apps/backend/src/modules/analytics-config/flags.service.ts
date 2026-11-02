import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Every flag the backend knows, with its default. Defaults are what dev, tests and fake mode
 * use, and what production falls back to if PostHog is unreachable — so a default must be the
 * safe choice. Flags are evaluated per micro-market (PostHog group `micro_market`).
 */
export const FLAG_DEFAULTS = {
  /** Merchant self-onboarding in the merchant app (off = field-agent onboarding only). */
  merchant_onboarding: true,
  /** Show the "not serviceable yet — join waitlist" CTA outside micro-markets. */
  serviceability_waitlist: true,
  /** Cash on delivery (also gated by each micro-market's COD rules). */
  cod_payments: true,
} as const satisfies Record<string, boolean>;

export type FlagName = keyof typeof FLAG_DEFAULTS;
export const FLAG_NAMES = Object.keys(FLAG_DEFAULTS) as FlagName[];

export interface FlagContext {
  distinctId: string;
  microMarketId?: string | null | undefined;
}

@Injectable()
export class FlagsService implements OnModuleDestroy {
  private readonly logger = new Logger(FlagsService.name);
  private readonly posthog: PostHog | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.posthog =
      env.POSTHOG_KEY && env.DATA_STORE !== 'memory'
        ? new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 20 })
        : null;
  }

  async isEnabled(flag: FlagName, ctx: FlagContext): Promise<boolean> {
    return (await this.evaluate(ctx))[flag];
  }

  /** All flags for a user (and micro-market): override → PostHog → default. */
  async evaluate(ctx: FlagContext): Promise<Record<FlagName, boolean>> {
    const out = { ...FLAG_DEFAULTS } as Record<FlagName, boolean>;
    if (this.posthog) {
      try {
        const remote = await this.posthog.getAllFlags(ctx.distinctId, {
          groups: ctx.microMarketId ? { micro_market: ctx.microMarketId } : undefined,
        });
        for (const f of FLAG_NAMES) if (typeof remote[f] === 'boolean') out[f] = remote[f];
      } catch (err) {
        this.logger.warn({ err }, 'PostHog flag evaluation failed; using defaults');
      }
    }
    for (const f of FLAG_NAMES) if (typeof this.env.FLAG_OVERRIDES[f] === 'boolean') out[f] = this.env.FLAG_OVERRIDES[f];
    return out;
  }

  async onModuleDestroy(): Promise<void> {
    await this.posthog?.shutdown();
  }
}
