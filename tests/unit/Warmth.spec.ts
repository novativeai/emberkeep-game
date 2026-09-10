import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from '../../src/core/Constants';
import {
  formatUnlimitedLeft,
  formatUntil,
  unlimitedWarmthActive,
  warmthPrice
} from '../../src/core/warmth';

/**
 * Unlimited Warmth's pure layer: ONE predicate for what it waives, and the two
 * formats the HUD, the confirm dialog and the banner print.
 */
describe('warmthPrice — what Unlimited Warmth waives', () => {
  const wall = 1_000_000;
  const until = wall + MS_PER_DAY;

  it('is 0 for a harvest and a skip while active, and the base for a building skip', () => {
    expect(warmthPrice(3, 'harvest', until, wall)).toBe(0);
    expect(warmthPrice(7, 'skip', until, wall)).toBe(0);
    expect(warmthPrice(7, 'skip_building', until, wall)).toBe(7);
  });

  it('charges the base when nothing is running', () => {
    expect(warmthPrice(3, 'harvest', 0, wall)).toBe(3);
    expect(warmthPrice(7, 'skip', wall - 1, wall)).toBe(7);
  });

  it('is inactive at the exact instant it ends', () => {
    expect(unlimitedWarmthActive(wall, wall)).toBe(false);
    expect(warmthPrice(3, 'harvest', wall, wall)).toBe(3);
    expect(unlimitedWarmthActive(wall + 1, wall)).toBe(true);
  });
});

describe('formatUnlimitedLeft — rounds UP at the unit shown', () => {
  it.each([
    [432_000_000, '5d 0h'],
    [431_999_999, '5d 0h'],
    [428_400_000, '4d 23h'],
    [86_400_000, '1d 0h'],
    [86_340_000, '23h 59m'],
    [3_600_000, '1h 0m'],
    [3_599_000, '59:59'],
    [61_000, '1:01']
  ])('%i ms → %s', (ms, text) => {
    expect(formatUnlimitedLeft(ms)).toBe(text);
  });
});

describe('formatUntil — a fixed month table', () => {
  it('prints "d Mon, hh:mm"', () => {
    expect(formatUntil(Date.now())).toMatch(
      /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), \d{2}:\d{2}$/
    );
    // September is "Sep", never en-GB's "Sept".
    expect(formatUntil(new Date(2026, 8, 15, 14, 2).getTime())).toBe('15 Sep, 14:02');
  });
});
