import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Retired tool names that tools/call still accepts, mapped to their current
 * name. They are deliberately NOT registered with McpServer: tools/list shows
 * each tool exactly once, so a client never sees two near-identical tools.
 *
 * The SDK (1.28) has no public way to make a tool callable but unlisted (a
 * disabled tool is hidden from tools/list but tools/call rejects it), so the
 * alias is resolved one layer down, on the incoming JSON-RPC message, before
 * McpServer looks the name up. Input validation, the handler, and the error
 * shape are therefore exactly those of the current tool.
 */
export const DEPRECATED_TOOL_ALIASES: Readonly<Record<string, string>> = {
  // Renamed so every meta tool reads procore_<verb>_<noun>.
  procore_api_call: "procore_call_api",
};

/** Rewrites a tools/call for a retired name to the current one; anything else passes through untouched. */
export function resolveToolAlias(message: JSONRPCMessage): JSONRPCMessage {
  if (!("method" in message) || message.method !== "tools/call") return message;
  const params = message.params as { name?: unknown } | undefined;
  const oldName = typeof params?.name === "string" ? params.name : undefined;
  if (!oldName || !Object.hasOwn(DEPRECATED_TOOL_ALIASES, oldName)) return message;

  const newName = DEPRECATED_TOOL_ALIASES[oldName];
  console.error(
    `DEPRECATED: tool "${oldName}" was renamed to "${newName}"; routing this call to ` +
      `"${newName}". Update saved prompts and allowedTools entries before the alias is removed.`
  );
  return { ...message, params: { ...message.params, name: newName } } as JSONRPCMessage;
}

/**
 * Wraps a transport so every incoming message passes through resolveToolAlias
 * before the server sees it. Outgoing traffic is forwarded unchanged.
 */
export function withToolAliases(inner: Transport): Transport {
  const wrapper: Transport = {
    start: async () => {
      inner.onmessage = (message, extra) => wrapper.onmessage?.(resolveToolAlias(message), extra);
      inner.onclose = () => wrapper.onclose?.();
      inner.onerror = (error) => wrapper.onerror?.(error);
      await inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return wrapper;
}
