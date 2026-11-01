import { Global, Module } from '@nestjs/common';
import { parseEnv, type Env } from './env';

/** Injection token for the parsed, validated environment. */
export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
