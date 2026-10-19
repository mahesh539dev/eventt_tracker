import { describe, expect, it } from 'vitest';
import { makeTodayResolver } from '../src/app.js';

describe('makeTodayResolver', () => {
  it('reads APP_TIMEZONE and returns a YYYY-MM-DD formatted date', () => {
    const resolver = makeTodayResolver('America/Toronto');
    const result = resolver();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('produces the same calendar date as a direct Intl call for a fixed timezone', () => {
    const timezone = 'Asia/Kolkata';
    const resolver = makeTodayResolver(timezone);
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    expect(resolver()).toBe(expected);
  });

  it('works with the config default timezone (UTC) and returns a valid-looking date', () => {
    const resolver = makeTodayResolver('UTC');
    expect(resolver()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
