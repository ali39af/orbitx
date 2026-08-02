/**
 * Retry-with-backoff helper. Each provider calls this around its own SDK
 * call (not a central wrapper in BaseAgent) so provider-specific errors
 * (rate limits, transient 5xx, network blips) are retried right at the
 * source before ever reaching the agent loop.
 *
 * Schedule: 1s, 2s, 4s, 8s between attempts (4 waits => 5 total attempts).
 * After the last attempt still fails, the error is rethrown as-is so the
 * caller sees the real underlying error rather than a generic wrapper.
 */
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000];

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying on any thrown error using the fixed backoff schedule
 * above. Every error is treated as transient/retryable — callers that only
 * want to retry specific error shapes should filter inside `fn` and rethrow
 * a non-retryable marker instead (not needed currently, since all providers
 * here want to retry on any error: network errors, timeouts, 5xx, etc).
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= BACKOFF_SCHEDULE_MS.length; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const waitMs = BACKOFF_SCHEDULE_MS[attempt];
            if (waitMs === undefined) break; // no more retries left
            await sleep(waitMs);
        }
    }

    throw lastError;
}

export default withRetry;
