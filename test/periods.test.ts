import { describe, expect, it } from 'vitest';
import { isValidRange, monthToRange } from '../src/periods.js';

describe('monthToRange', () => {
  it('returns the first and last day of a 31-day month', () => {
    expect(monthToRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
  it('returns the first and last day of a 30-day month', () => {
    expect(monthToRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });
  it('handles February in a non-leap year', () => {
    expect(monthToRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('handles February in a leap year', () => {
    expect(monthToRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('isValidRange', () => {
  it('accepts a range where from is before to', () => {
    expect(isValidRange('2026-01-01', '2026-01-31')).toBe(true);
  });
  it('accepts a single-day range', () => {
    expect(isValidRange('2026-01-01', '2026-01-01')).toBe(true);
  });
  it('rejects a range where from is after to', () => {
    expect(isValidRange('2026-02-01', '2026-01-01')).toBe(false);
  });
});
