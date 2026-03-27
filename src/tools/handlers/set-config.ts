import { setRuntimeConfig, getRuntimeConfig } from "../../api/client.js";

export async function handleSetConfig(args: {
  key: string;
  value: string;
}): Promise<string> {
  const allowedKeys = ["company_id", "project_id"];

  if (!allowedKeys.includes(args.key)) {
    return `Invalid config key: "${args.key}". Allowed keys: ${allowedKeys.join(", ")}`;
  }

  const numericKeys = ["company_id", "project_id"];
  const value = numericKeys.includes(args.key)
    ? parseInt(args.value, 10)
    : args.value;

  if (numericKeys.includes(args.key) && isNaN(value as number)) {
    return `"${args.key}" must be a number. Got: "${args.value}"`;
  }

  setRuntimeConfig(args.key, value);

  const config = getRuntimeConfig();
  return `Config updated: ${args.key} = ${value}\n\nCurrent config: ${JSON.stringify(config, null, 2)}`;
}
