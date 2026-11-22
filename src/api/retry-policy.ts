/**
 * Which failed Procore requests are safe to send again.
 *
 * A 5xx, a timeout or a dropped connection says nothing about whether Procore
 * applied the request: the write may have landed before the failure. Re-sending
 * is only safe when doing it twice has the same effect as doing it once, i.e.
 * for idempotent methods. POST and PATCH are not, so a retry could create a
 * duplicate record or apply a change twice.
 *
 * A 429 is different: Procore rejected the request without executing it, so it
 * is retryable for every method. (The 401 refresh-and-retry-once lives in the
 * client and also applies to every method, for the same reason.)
 */

export type TransientFailure = "rate_limited" | "server_error" | "timeout" | "network_error";

const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

export function isIdempotent(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.trim().toUpperCase());
}

/** Whether a request that failed this way may be re-sent (attempt budget aside). */
export function isRetryable(method: string, failure: TransientFailure): boolean {
  return failure === "rate_limited" || isIdempotent(method);
}

/** The explanation attached to a failure returned without a retry. */
export function notRetriedNotice(method: string): string {
  const verb = method.trim().toUpperCase();
  return (
    `Not retried: ${verb} is not idempotent, and Procore may already have applied ` +
    `the request. Check whether it took effect before sending it again.`
  );
}
