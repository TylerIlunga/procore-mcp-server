/**
 * Hard length cap with a trailing ellipsis, shared by the catalog and
 * manifest generators. Where the same raw OAS text passes through both, the
 * two call sites must pass the same limit (see "Two truncation limits" in
 * CLAUDE.md).
 */
export function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max - 3) + "...";
}
