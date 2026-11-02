import { describe, expect, it } from 'vitest';
import { screenReview } from './review-screen';

describe('review screen', () => {
  it('publishes ordinary reviews, in English and Telugu', () => {
    expect(screenReview('Fresh vegetables, quick delivery. Thank you!')).toEqual({ flagged: false, reasons: [] });
    expect(screenReview('చాలా బాగుంది, సమయానికి వచ్చింది')).toEqual({ flagged: false, reasons: [] });
    expect(screenReview(null).flagged).toBe(false);
  });

  it('holds contact details, links, abuse and shouting for a person', () => {
    expect(screenReview('Call me on 98765 43210 for a better price').reasons).toEqual(['contact_details']);
    expect(screenReview('order at mystore.in instead').reasons).toEqual(['link']);
    expect(screenReview('This shop is a fraud').reasons).toEqual(['abuse']);
    expect(screenReview('WORST DELIVERY EVER NEVER AGAIN').reasons).toEqual(['shouting']);
    expect(screenReview('write to me at a.b@gmail.com').reasons).toEqual(['contact_details', 'link']);
    expect(screenReview('mail ravi_k+deals@yahoo.co.in please').reasons).toContain('contact_details');
  });

  it('stays fast on hostile input (no catastrophic backtracking)', () => {
    const t0 = performance.now();
    screenReview('+'.repeat(50_000));
    screenReview(`${'a.'.repeat(20_000)}@`);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
