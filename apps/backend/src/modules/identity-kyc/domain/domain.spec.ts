import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../common/errors/domain-error';
import { maskPhone } from '../../../common/pii';
import { normalizeIndianMobile } from './phone';
import { formatRefreshToken, generateOtpCode, hashOtp, parseRefreshToken, safeEqual } from './secrets';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['(+91) 6000-000-000', '+916000000000'],
  ])('%s → %s', (input, out) => expect(normalizeIndianMobile(input)).toBe(out));

  it.each(['5876543210', '98765', '+1 415 555 0100', 'abcdefghij', ''])('rejects %s', (input) =>
    expect(() => normalizeIndianMobile(input)).toThrow(DomainError),
  );
});

describe('secrets', () => {
  it('generates 6-digit codes', () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('binds OTP hashes to the challenge', () => {
    expect(hashOtp('p', 'c1', '123456')).not.toBe(hashOtp('p', 'c2', '123456'));
    expect(hashOtp('p', 'c1', '123456')).toBe(hashOtp('p', 'c1', '123456'));
  });

  it('round-trips refresh tokens and rejects malformed ones', () => {
    const sid = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    expect(parseRefreshToken(formatRefreshToken(sid, 'abc.def'))).toEqual({ sessionId: sid, secret: 'abc.def' });
    expect(parseRefreshToken('nodot')).toBeNull();
    expect(parseRefreshToken('short.secret')).toBeNull();
    expect(parseRefreshToken(`${sid}.`)).toBeNull();
  });

  it('safeEqual handles different lengths', () => {
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });
});

describe('maskPhone', () => {
  it('keeps country prefix and last two digits only', () => {
    expect(maskPhone('+919876543210')).toBe('+9198******10');
  });
});
