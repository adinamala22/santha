import { Injectable } from '@nestjs/common';
import { type ScreenResult, screenText } from './domain/prohibited';

/** trust-safety's exported API for other modules (M2: prohibited-item screening). */
@Injectable()
export class TrustSafetyService {
  screenItem(input: { name: string; nameTe?: string | null; description?: string | null; brand?: string | null }): ScreenResult {
    return screenText(input.name, input.nameTe, input.description, input.brand);
  }
}
