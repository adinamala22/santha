/** Injectable clock so time-dependent logic (OTP expiry, sessions, timers) is testable. */
export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
