import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fill } from '@/i18n/console';
import { siteCopy } from '@/i18n/site';
import { RatingBars } from './rating-bars';

describe('RatingBars', () => {
  it('lists 5 stars first, scales bars to the most common level and labels each for screen readers', () => {
    const s = siteCopy('en').store;
    render(<RatingBars distribution={[0, 0, 1, 1, 2]} label={(stars, count) => fill(s.starBar, { stars, count })} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['5 stars: 2', '4 stars: 1', '3 stars: 1', '2 stars: 0', '1 stars: 0']);
    const widths = rows.map((r) => (r.querySelector('span > span') as HTMLElement).style.width);
    expect(widths).toEqual(['100%', '50%', '50%', '0%', '0%']);
  });

  it('Telugu labels', () => {
    const s = siteCopy('te').store;
    render(<RatingBars distribution={[1, 0, 0, 0, 0]} label={(stars, count) => fill(s.starBar, { stars, count })} />);
    expect(screen.getAllByRole('listitem')[4]!.getAttribute('aria-label')).toBe('1 నక్షత్రాలు: 1');
  });
});
