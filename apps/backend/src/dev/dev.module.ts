import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';

/** Fake-mode helper routes (/v1/dev/*): answer 404 unless DATA_STORE=memory. */
@Module({ controllers: [DevController] })
export class DevModule {}
