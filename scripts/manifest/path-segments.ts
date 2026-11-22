/** Path segments with the version prefix stripped and `{param}` placeholders
 *  dropped, so only the literal resource-naming segments remain. */
export function realPathSegments(path: string): string[] {
  return path
    .replace(/\/rest\/v[\d.]+\//, "/")
    .split("/")
    .filter((s) => s && !s.startsWith("{"));
}
