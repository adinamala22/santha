/** Injectable clock so time-dependent logic (OTP expiry, sessions, timers) is testable. */
export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

/**
 * Fake mode only (DATA_STORE=memory): a clock that can be moved forward through
 * `POST /v1/dev/clock`, so time-based features (catalogue staleness after 72 h, slot cut-offs)
 * can be demoed and tested without waiting. Never wired with Postgres.
 */
export class DevClock {
  private offsetMs = 0;
  readonly now: Clock = () => new Date(Date.now() + this.offsetMs);

  advance(ms: number): Date {
    if (ms < 0) throw new Error('The dev clock only moves forward');
    this.offsetMs += ms;
    return this.now();
  }

  get offset(): number {
    return this.offsetMs;
  }
}
export const DEV_CLOCK = Symbol('DEV_CLOCK');
