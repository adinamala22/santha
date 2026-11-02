import { Global, Module } from '@nestjs/common';
import { CLOCK, DEV_CLOCK, DevClock, systemClock } from '../common/clock';
import { parseEnv, type Env } from './env';

/** Injection token for the parsed, validated environment. */
export const ENV = Symbol('ENV');

/**
 * Global: parsed env (ENV) and the injectable clock (CLOCK). In fake mode CLOCK is a DevClock that
 * `POST /v1/dev/clock` can move forward; tests can also override CLOCK.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    { provide: DEV_CLOCK, inject: [ENV], useFactory: (env: Env) => (env.DATA_STORE === 'memory' ? new DevClock() : null) },
    { provide: CLOCK, inject: [DEV_CLOCK], useFactory: (dev: DevClock | null) => dev?.now ?? systemClock },
  ],
  exports: [ENV, CLOCK, DEV_CLOCK],
})
export class ConfigModule {}
