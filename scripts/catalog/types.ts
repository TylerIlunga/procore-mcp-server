/**
 * Shapes shared by the catalog generator: the slice of the OAS it reads, and
 * the catalog / endpoint-detail / category-index records it writes to data/.
 */

export interface OASParameter {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
}

export interface OASOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  "x-deprecated-at"?: string;
  "x-sunset"?: string;
  parameters?: OASParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, unknown>;
}

export interface CatalogEntry {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
  category: string;
  module: string;
  version: string;
  pathParams: string[];
  requiredParams: string[];
  hasRequestBody: boolean;
  contentType: string | null;
  /** True when the 2xx response is a JSON array (a collection), so callers
   *  know pagination applies. Derived from the response schema, not the path. */
  returnsCollection: boolean;
  /** Response property that wraps the collection array. Procore's v2.x
   *  endpoints envelope their payload as `{ data: [...] }`. */
  collectionEnvelope?: string;
  deprecated: boolean;
  deprecatedAt?: string;
  sunset?: string;
}

export interface EndpointDetail {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tag: string;
  deprecated: boolean;
  deprecatedAt?: string;
  sunset?: string;
  parameters: Array<{
    name: string;
    in: string;
    required: boolean;
    description: string;
    schema: Record<string, unknown>;
  }>;
  requestBody?: {
    contentType: string;
    required: boolean;
    schema: Record<string, unknown>;
  };
  responses: Record<string, { description: string; schema?: Record<string, unknown> }>;
}

export interface CategoryIndex {
  categories: Record<
    string,
    {
      modules: Record<string, { endpointCount: number; tags: string[] }>;
      totalEndpoints: number;
    }
  >;
  totalEndpoints: number;
  generatedAt: string;
}

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
