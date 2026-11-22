/**
 * Tool parameters: the ToolParam shape, OAS type mapping, request-body field
 * extraction, and collapsing params that would land on the same schema key.
 */
import { truncate } from "../shared/truncate.js";
import { enrichParamDescription } from "./param-enrichment.js";

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: unknown[];
  source: "path" | "query" | "body";
  /** Set when a body field was merged away into an identically named path or
   *  query param. The handler sends the single supplied value to both places. */
  alsoBody?: boolean;
}

/** Mirror of the key transform auto-register applies when building the Zod
 *  shape. Collisions must be detected on this form, not the raw OAS name. */
export function toSchemaKey(name: string): string {
  return name.replace(/\[/g, "__").replace(/\]/g, "").replace(/\./g, "_");
}

const SOURCE_RANK: Record<ToolParam["source"], number> = {
  path: 0,
  query: 1,
  body: 2,
};

/**
 * Collapse params that would land on the same Zod key. Procore routinely
 * repeats an identifier in both the URL and the request body (e.g. company_id
 * on create_permission_template); previously the body entry silently clobbered
 * the path entry in the generated schema, so the agent saw the wrong
 * description for a required path param. Path wins; a dropped body twin is
 * recorded via alsoBody so the value is still sent in the payload.
 */
export function dedupeParams(params: ToolParam[]): ToolParam[] {
  const byKey = new Map<string, ToolParam>();

  for (const param of params) {
    const key = toSchemaKey(param.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...param });
      continue;
    }

    const winner =
      SOURCE_RANK[param.source] < SOURCE_RANK[existing.source]
        ? { ...param }
        : existing;
    const loser = winner === existing ? param : existing;

    if (loser.source === "body") winner.alsoBody = true;
    if (existing.alsoBody) winner.alsoBody = true;
    // A value required anywhere is required overall.
    winner.required = existing.required || param.required;
    byKey.set(key, winner);
  }

  return [...byKey.values()];
}

export function mapOasTypeToSimple(schema: Record<string, unknown>): string {
  const type = schema.type as string;
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "string";
}

/** Extract body params from OAS request body schema */
export function extractBodyParams(
  schema: Record<string, unknown>,
  moduleName: string
): { params: ToolParam[]; wrapper?: string } {
  const params: ToolParam[] = [];

  if (!schema.properties) return { params };

  const props = schema.properties as Record<string, Record<string, unknown>>;
  const requiredFields = (schema.required as string[]) || [];
  const topKeys = Object.keys(props);

  // Detect wrapper pattern: single top-level key that's an object
  if (topKeys.length === 1) {
    const wrapperKey = topKeys[0];
    const wrapperSchema = props[wrapperKey];
    if (wrapperSchema.type === "object" && wrapperSchema.properties) {
      const innerProps = wrapperSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      const innerRequired = (wrapperSchema.required as string[]) || [];

      for (const [name, propSchema] of Object.entries(innerProps)) {
        const rawDesc = truncate(
          (propSchema.description as string) || name,
          200
        );
        params.push({
          name,
          type: mapOasTypeToSimple(propSchema),
          required: innerRequired.includes(name),
          description: enrichParamDescription(name, rawDesc, moduleName),
          enum: propSchema.enum as unknown[] | undefined,
          source: "body",
        });
      }
      return { params, wrapper: wrapperKey };
    }
  }

  for (const [name, propSchema] of Object.entries(props)) {
    const rawDesc = truncate(
      (propSchema.description as string) || name,
      200
    );
    params.push({
      name,
      type: mapOasTypeToSimple(propSchema),
      required: requiredFields.includes(name),
      description: enrichParamDescription(name, rawDesc, moduleName),
      enum: propSchema.enum as unknown[] | undefined,
      source: "body",
    });
  }

  return { params };
}
