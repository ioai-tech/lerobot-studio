/** Retry policy of a failing video source: exponential backoff with jitter and a cap. */

export interface RetryPolicy {
  /** Delay of the first retry (ms). */
  baseMs: number;
  /** Upper bound of one delay (ms). */
  maxMs: number;
  /** Attempts before the camera shows a named error and stops retrying. */
  maxAttempts: number;
  /** Errors further apart than this start a fresh series (ms). */
  resetAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 1_000,
  maxMs: 30_000,
  maxAttempts: 5,
  resetAfterMs: 60_000,
};

/** Delay before retry number `attempt` (1-based), with ±20% jitter from `random`. */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const raw = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.8 + 0.4 * random()));
}

/** Counts failures of one source; `next()` says whether and when to retry. */
export class RetryBudget {
  private attempts = 0;
  private lastFailureAt = Number.NEGATIVE_INFINITY;

  private readonly getPolicy: () => RetryPolicy;
  private readonly now: () => number;

  constructor(
    getPolicy: () => RetryPolicy = () => DEFAULT_RETRY_POLICY,
    now: () => number = Date.now,
  ) {
    this.getPolicy = getPolicy;
    this.now = now;
  }

  get count(): number {
    return this.attempts;
  }

  /** Record a failure: the delay of the next attempt, or null when the budget is spent. */
  next(random: () => number = Math.random): number | null {
    const policy = this.getPolicy();
    const now = this.now();
    if (now - this.lastFailureAt > policy.resetAfterMs) this.attempts = 0;
    this.lastFailureAt = now;
    this.attempts += 1;
    if (this.attempts > policy.maxAttempts) return null;
    return backoffDelay(this.attempts, policy, random);
  }

  reset(): void {
    this.attempts = 0;
    this.lastFailureAt = Number.NEGATIVE_INFINITY;
  }
}

/** HTTP statuses object stores use for a refused (expired) signature. */
export function isSignatureRefused(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}
