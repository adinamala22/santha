import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the "one source of truth" rule: Tailwind tokens, CSS tokens and tokens.json agree.
const design = resolve(__dirname, '../../../../design/tokens');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tw = require(resolve(design, 'tailwind.tokens.js'));
const css = readFileSync(resolve(design, 'tokens.css'), 'utf8');

describe('design tokens', () => {
  it.each([
    ['indigo', tw.colors.indigo.DEFAULT, '--s-indigo'],
    ['indigo-700', tw.colors.indigo[700], '--s-indigo-700'],
    ['marigold', tw.colors.marigold.DEFAULT, '--s-marigold'],
    ['cream', tw.colors.cream, '--s-cream'],
    ['leaf', tw.colors.leaf, '--s-leaf'],
    ['chilli', tw.colors.chilli, '--s-chilli'],
    ['ink', tw.colors.ink, '--s-ink'],
    ['slate', tw.colors.slate, '--s-slate'],
  ])('%s matches between tailwind and CSS', (_name, hex, cssVar) => {
    expect(css).toMatch(new RegExp(`${cssVar}:\\s*${hex}`, 'i'));
  });

  it('matches the brand palette', () => {
    expect(tw.colors.indigo.DEFAULT).toBe('#1F2A5C');
    expect(tw.colors.marigold.DEFAULT).toBe('#F5A623');
  });
});
