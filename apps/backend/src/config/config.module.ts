import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock';
import { parseEnv, type Env } from './env';

/** Injection token for the parsed, validated environment. */
export const ENV = Symbol('ENV');

/** Global: parsed env (ENV) and the injectable clock (CLOCK) — tests override CLOCK to move time. */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [ENV, CLOCK],
})
export class ConfigModule {}
