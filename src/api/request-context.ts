/**
 * Session defaults for the identifiers most Procore paths need.
 *
 * `procore_set_config` stores company_id / project_id here, and every request
 * path (procore_call_api and the generated per-endpoint tools) falls back to
 * them when the caller omits the value. Tool descriptions promise exactly this
 * ("company_id and project_id default to the values set by procore_set_config
 * when omitted"), so the fallback has to live in one place both paths share.
 *
 * Precedence: explicit argument > procore_set_config > PROCORE_COMPANY_ID env
 * (company_id only).
 */

/** Path identifiers the server can supply itself. */
export const CONFIG_BACKED_PARAMS: ReadonlySet<string> = new Set(["company_id", "project_id"]);

let runtimeConfig: Record<string, string | number> = {};

export function getRuntimeConfig(): Record<string, string | number> {
  return { ...runtimeConfig };
}

export function setRuntimeConfig(key: string, value: string | number): void {
  runtimeConfig[key] = value;
}

/** Test hook: forget every session default. */
export function resetRuntimeConfig(): void {
  runtimeConfig = {};
}

/** The session default for a config-backed identifier, if one is known. */
export function contextDefault(key: string): string | undefined {
  const value =
    runtimeConfig[key] ?? (key === "company_id" ? process.env.PROCORE_COMPANY_ID : undefined);
  if (value === undefined || value === "") return undefined;
  return String(value);
}

/** The company to send in the Procore-Company-Id header when none was given. */
export function defaultCompanyId(): number | null {
  const value = contextDefault("company_id");
  const id = value === undefined ? NaN : parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
}

/**
 * Fill `{company_id}` / `{project_id}` placeholders the caller left out from the
 * session defaults. Explicit values always win; other placeholders are untouched.
 */
export function withContextDefaults(
  path: string,
  pathParams?: Record<string, string>
): Record<string, string> | undefined {
  const filled: Record<string, string> = { ...(pathParams ?? {}) };
  for (const key of CONFIG_BACKED_PARAMS) {
    if (!path.includes(`{${key}}`) || filled[key] !== undefined) continue;
    const value = contextDefault(key);
    if (value !== undefined) filled[key] = value;
  }
  return Object.keys(filled).length > 0 ? filled : undefined;
}

/** Hint for an unfilled config-backed placeholder: name the tool that sets it. */
export function missingContextHint(missing: string[]): string {
  const backed = missing.filter((name) => CONFIG_BACKED_PARAMS.has(name));
  if (backed.length === 0) return "";
  return (
    ` Pass ${backed.join(" and ")} explicitly, or set a session default once with ` +
    `procore_set_config (e.g. { "key": "${backed[0]}", "value": "123" }).`
  );
}
