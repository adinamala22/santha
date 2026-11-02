import { describe, expect, it } from 'vitest';
import { screenText } from './prohibited';

describe('prohibited-item screen (FR-CAT-7)', () => {
  it('holds tobacco and alcohol', () => {
    expect(screenText('Gold Flake Cigarettes 10s').codes).toEqual(['tobacco']);
    expect(screenText('Kingfisher Beer 650 ml').codes).toEqual(['alcohol']);
  });
  it('matches whole words only', () => {
    expect(screenText('Ginger garlic paste').held).toBe(false); // "gin" inside "ginger"
    expect(screenText('Begun bhaja').held).toBe(false); // "gun" inside "begun"
    expect(screenText('Drumstick').held).toBe(false); // "rum" inside a word
  });
  it('lets known harmless phrases through', () => {
    expect(screenText('Ginger beer 300 ml').held).toBe(false);
    expect(screenText('Britannia cream crackers').held).toBe(false);
  });
  it('checks every field and explains the hold', () => {
    const r = screenText('Gift hamper', null, 'with a bottle of wine');
    expect(r).toMatchObject({ held: true, codes: ['alcohol'] });
    expect(r.reason).toMatch(/restricted/);
  });
});
