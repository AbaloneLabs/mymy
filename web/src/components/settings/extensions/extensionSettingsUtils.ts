import type { ExtensionKind } from "@/features/extensions/api";

export const DEFAULT_EXTENSION_PARAMETERS =
  '{\n  "type": "object",\n  "properties": {}\n}';

export function parseExtensionJson(
  value: string,
  onError: () => void,
): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    onError();
    return undefined;
  }
}

export function extensionKindLabel(kind: ExtensionKind) {
  if (kind === "mcp_server") return "MCP";
  return kind.toUpperCase();
}
