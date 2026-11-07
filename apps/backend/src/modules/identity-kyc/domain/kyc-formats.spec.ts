import { describe, expect, it } from 'vitest';
import {
  isDrivingLicence,
  isVehicleNumber,
  normalizeDrivingLicence,
  normalizeVehicleNumber,
  gstinCheckChar,
  isAadhaar,
  isBankAccount,
  isFssai,
  isGstin,
  isIfsc,
  isPan,
  maskAadhaar,
  maskAccount,
  maskPan,
  panOfGstin,
  verhoeffCheckDigit,
  verhoeffValid,
} from './kyc-formats';

describe('KYC formats', () => {
  it('PAN', () => {
    expect(isPan('ABCPR1234K')).toBe(true);
    expect(isPan('ABCXR1234K')).toBe(false); // X is not a holder type
    expect(isPan('abcpr1234k')).toBe(false); // callers upper-case first
    expect(isPan('ABCPR123K')).toBe(false);
  });

  it('Aadhaar uses the Verhoeff checksum', () => {
    const base = '23456789012';
    const valid = base + verhoeffCheckDigit(base);
    expect(verhoeffValid(valid)).toBe(true);
    expect(isAadhaar(valid)).toBe(true);
    const wrong = base + ((Number(verhoeffCheckDigit(base)) + 1) % 10);
    expect(isAadhaar(wrong)).toBe(false);
    expect(isAadhaar('1' + valid.slice(1))).toBe(false); // cannot start with 0/1
    expect(isAadhaar('2345')).toBe(false);
  });

  it('GSTIN: state code, embedded PAN, check character', () => {
    const first14 = '37ABCPR1234K1Z';
    const gstin = first14 + gstinCheckChar(first14);
    expect(isGstin(gstin)).toBe(true);
    expect(panOfGstin(gstin)).toBe('ABCPR1234K');
    const other = gstin.slice(0, 14) + (gstin[14] === 'A' ? 'B' : 'A');
    expect(isGstin(other)).toBe(false);
    expect(isGstin('00' + gstin.slice(2))).toBe(false); // invalid state code
    // Real published GSTIN check character example
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
  });

  it('FSSAI, IFSC and account numbers', () => {
    expect(isFssai('12345678901234')).toBe(true);
    expect(isFssai('22345678901234')).toBe(true);
    expect(isFssai('32345678901234')).toBe(false);
    expect(isFssai('1234567890123')).toBe(false);
    expect(isIfsc('SBIN0001234')).toBe(true);
    expect(isIfsc('SBIN1001234')).toBe(false);
    expect(isBankAccount('123456789012')).toBe(true);
    expect(isBankAccount('12345678')).toBe(false);
  });

  it('masks numbers that must never be stored in full', () => {
    expect(maskPan('ABCPR1234K')).toBe('AB******4K');
    expect(maskAadhaar('234567890124')).toBe('XXXX XXXX 0124');
    expect(maskAccount('123456789012')).toBe('•••• 9012');
  });

  it('driving licence (ADR-029): Sarathi format, spaces and hyphens ignored', () => {
    expect(isDrivingLicence(normalizeDrivingLicence('AP09 2015 0001234'))).toBe(true);
    expect(isDrivingLicence(normalizeDrivingLicence('ap-26-2019-0012345'))).toBe(true);
    expect(isDrivingLicence(normalizeDrivingLicence('TS07A20200001234'))).toBe(true); // RTO with a letter
    expect(isDrivingLicence('AP0920150001')).toBe(false); // too short
    expect(isDrivingLicence('AP0918150001234')).toBe(false); // no plausible year
  });

  it('vehicle number (ADR-029): state series and Bharat series', () => {
    expect(isVehicleNumber(normalizeVehicleNumber('AP 26 AB 1234'))).toBe(true);
    expect(isVehicleNumber(normalizeVehicleNumber('ap-39-x-7'))).toBe(true);
    expect(isVehicleNumber(normalizeVehicleNumber('22 BH 1234 AA'))).toBe(true);
    expect(isVehicleNumber('1234')).toBe(false);
    expect(isVehicleNumber('AP26AB12345')).toBe(false);
  });
});
