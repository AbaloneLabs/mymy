import type { TextEditorKind } from "./textSourceTypes";

export function textEditorKind(filePath: string): TextEditorKind {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "toml") return "toml";
  if (
    [
      "css",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "rs",
      "py",
      "sh",
      "bash",
      "sql",
      "xml",
      "html",
      "htm",
    ].includes(extension)
  ) {
    return "code";
  }
  return "text";
}

export function languageForPath(filePath: string, kind: TextEditorKind) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "json") return "json";
  if (kind === "yaml") return "yaml";
  if (kind === "toml") return "toml";
  const aliases: Record<string, string> = {
    cjs: "javascript",
    htm: "html",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    py: "python",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  return aliases[extension] ?? (extension || "text");
}
