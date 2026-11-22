/**
 * Per-request timeout for Procore API calls.
 *
 * `PROCORE_REQUEST_TIMEOUT_MS` overrides the default. It must be a positive
 * integer number of milliseconds; anything else throws, so a typo can never
 * silently fall back to the default (or to no timeout at all). `src/index.ts`
 * calls this at startup so a bad value stops the server before it serves.
 */

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Largest delay Node's timers honour; above this they fire after 1 ms. */
export const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

export function getRequestTimeoutMs(): number {
  const raw = process.env.PROCORE_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_REQUEST_TIMEOUT_MS;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_REQUEST_TIMEOUT_MS) {
    throw new Error(
      `PROCORE_REQUEST_TIMEOUT_MS must be a positive integer number of milliseconds ` +
        `(1 to ${MAX_REQUEST_TIMEOUT_MS}), got ${JSON.stringify(raw)}. ` +
        `Unset it to use the default of ${DEFAULT_REQUEST_TIMEOUT_MS} ms.`
    );
  }
  return value;
}

/** True when `err` is the rejection `fetch` raises once an `AbortSignal.timeout` fires. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}
