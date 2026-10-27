import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  RetryBudget,
  backoffDelay,
  isSignatureRefused,
} from '../src/react/services/video/retry';

describe('video retry policy', () => {
  it('backs off exponentially with jitter and a cap', () => {
    const mid = () => 0.5;
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelay(attempt, DEFAULT_RETRY_POLICY, mid)),
    ).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(backoffDelay(1, DEFAULT_RETRY_POLICY, () => 0)).toBe(800);
    expect(backoffDelay(1, DEFAULT_RETRY_POLICY, () => 1)).toBe(1_200);
  });

  it('stops after the attempt budget and starts over after a quiet period', () => {
    let now = 0;
    const budget = new RetryBudget(
      () => DEFAULT_RETRY_POLICY,
      () => now,
    );
    const delays: Array<number | null> = [];
    for (let index = 0; index < 6; index++) {
      delays.push(budget.next(() => 0.5));
      now += 1_000;
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, null]);
    now += DEFAULT_RETRY_POLICY.resetAfterMs + 1;
    expect(budget.next(() => 0.5)).toBe(1_000);
  });

  it('treats 400 / 401 / 403 as a refused signature, not 5xx or 404', () => {
    expect([400, 401, 403].every(isSignatureRefused)).toBe(true);
    expect([404, 416, 500, 502, 503].some(isSignatureRefused)).toBe(false);
  });
});
