import type { ToolParam } from "./params.js";

export interface ToolManifestEntry {
  toolName: string;
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  category: string;
  module: string;
  version: string;
  contentType: string | null;
  params: ToolParam[];
  bodyWrapper?: string;
  returnsCollection: boolean;
  collectionEnvelope?: string;
  deprecated: boolean;
  deprecatedAt?: string;
  sunset?: string;
  /** Other tools for the same operation at a different Procore API version.
   *  Procore sometimes moves a resource (weather_logs -> daily_logs/
   *  weather_logs) between versions rather than cleanly superseding the old
   *  path, so dedupeByVersionedPath can't merge them — both stay callable,
   *  but a bare "Show Weather Log" reads identically on both, leaving an
   *  agent no way to tell them apart. */
  versionSiblings?: Array<{ toolName: string; version: string }>;
}
