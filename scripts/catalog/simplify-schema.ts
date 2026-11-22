import { truncate } from "../shared/truncate.js";

/**
 * Reduce an OAS schema to the fields the endpoint-detail files carry (type,
 * description, enum, required, format, default, properties, items), capped at
 * a fixed nesting depth so detail files stay small.
 */
export function simplifySchema(
  schema: Record<string, unknown> | undefined,
  depth = 0
): Record<string, unknown> {
  if (!schema) return {};
  if (depth > 3) return { type: "object", description: "(nested object)" };

  const result: Record<string, unknown> = {};
  if (schema.type) result.type = schema.type;
  if (schema.description)
    result.description = truncate(schema.description as string, 200);
  if (schema.enum) {
    const enumVals = schema.enum as unknown[];
    if (enumVals.length <= 15) {
      result.enum = enumVals;
    } else {
      result.description =
        (result.description || "") + ` (${enumVals.length} possible values)`;
    }
  }
  if (schema.required) result.required = schema.required;
  if (schema.format) result.format = schema.format;
  if (schema.default !== undefined) result.default = schema.default;

  if (schema.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      schema.properties as Record<string, Record<string, unknown>>
    )) {
      props[key] = simplifySchema(val, depth + 1);
    }
    result.properties = props;
  }

  if (schema.items) {
    result.items = simplifySchema(
      schema.items as Record<string, unknown>,
      depth + 1
    );
  }

  return result;
}
