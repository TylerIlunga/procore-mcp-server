import { getEndpointDetails } from "../../catalog/service.js";

export async function handleGetEndpointDetails(args: {
  operation_id: string;
}): Promise<string> {
  const detail = getEndpointDetails(args.operation_id);

  if (!detail) {
    return `Endpoint not found: ${args.operation_id}. Use procore_search_endpoints or procore_discover_endpoints to find valid operationIds.`;
  }

  const lines: string[] = [
    `## ${detail.method} ${detail.path}`,
    `**${detail.summary}**`,
    "",
  ];

  if (detail.description) {
    lines.push(detail.description, "");
  }

  // Parameters
  if (detail.parameters.length > 0) {
    lines.push("### Parameters");
    for (const p of detail.parameters) {
      const req = p.required ? " **(required)**" : "";
      const schemaStr = p.schema.type
        ? ` (${p.schema.type}${p.schema.format ? `, ${p.schema.format}` : ""})`
        : "";
      lines.push(
        `- \`${p.name}\` [${p.in}]${schemaStr}${req}: ${p.description}`
      );
      if (p.schema.enum) {
        lines.push(
          `  Values: ${(p.schema.enum as unknown[]).map((v) => `\`${v}\``).join(", ")}`
        );
      }
    }
    lines.push("");
  }

  // Request body
  if (detail.requestBody) {
    lines.push(`### Request Body (${detail.requestBody.contentType})`);
    if (detail.requestBody.required) {
      lines.push("**Required**");
    }
    lines.push("```json");
    lines.push(JSON.stringify(detail.requestBody.schema, null, 2));
    lines.push("```");
    lines.push("");
  }

  // Response schemas (just 200/201)
  const successCodes = Object.entries(detail.responses).filter(
    ([code]) => code === "200" || code === "201"
  );
  if (successCodes.length > 0) {
    lines.push("### Success Response");
    for (const [code, resp] of successCodes) {
      lines.push(`**${code}**: ${resp.description}`);
      if (resp.schema) {
        lines.push("```json");
        lines.push(
          JSON.stringify(resp.schema, null, 2).slice(0, 2000)
        );
        lines.push("```");
      }
    }
    lines.push("");
  }

  // Error codes
  const errorCodes = Object.entries(detail.responses)
    .filter(([code]) => code !== "200" && code !== "201")
    .map(([code, resp]) => `${code}: ${resp.description}`);
  if (errorCodes.length > 0) {
    lines.push("### Error Codes");
    lines.push(errorCodes.join(", "));
    lines.push("");
  }

  lines.push(
    "Use procore_api_call to execute this endpoint."
  );

  return lines.join("\n");
}
