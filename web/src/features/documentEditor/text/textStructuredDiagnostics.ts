import { configEntryPathLabel } from "./textConfigEntryUtils";
import { parseFlatConfig } from "./textFlatConfigParsers";
import { cursorPosition } from "./textSourceUtils";
import type { TextEditorKind } from "./textSourceTypes";
import type { SourceDiagnostic } from "./textStructuredTypes";

export function sourceDiagnostics(content: string, kind: TextEditorKind): SourceDiagnostic[] {
  if (kind === "json") {
    try {
      JSON.parse(content || "null");
      return [];
    } catch (error) {
      return [jsonParseDiagnostic(content, error)];
    }
  }
  if (kind === "yaml") {
    const diagnostics = content
      .split("\n")
      .map((line, index): SourceDiagnostic | null =>
        /^\t+/.test(line)
          ? { line: index + 1, message: "YAML indentation should use spaces." }
          : null,
      )
      .filter((diagnostic): diagnostic is SourceDiagnostic => Boolean(diagnostic));
    diagnostics.push(...duplicateConfigPathDiagnostics(content, "yaml"));
    return diagnostics;
  }
  if (kind === "toml") {
    return duplicateConfigPathDiagnostics(content, "toml");
  }
  return [];
}

function jsonParseDiagnostic(content: string, error: unknown): SourceDiagnostic {
  const message = error instanceof Error ? error.message : "Invalid JSON";
  const position = /position\s+(\d+)/i.exec(message)?.[1];
  if (!position) return { message };
  const offset = Number(position);
  if (!Number.isFinite(offset)) return { message };
  const cursor = cursorPosition(content, offset, offset);
  return {
    line: cursor.line,
    message: `${message} at column ${cursor.column}`,
  };
}

function duplicateConfigPathDiagnostics(
  content: string,
  kind: "yaml" | "toml",
): SourceDiagnostic[] {
  const seen = new Map<string, number>();
  const diagnostics: SourceDiagnostic[] = [];
  for (const entry of parseFlatConfig(content, kind).entries) {
    const path = configEntryPathLabel(entry);
    const existingLine = seen.get(path);
    if (existingLine !== undefined) {
      diagnostics.push({
        line: entry.lineIndex + 1,
        path,
        message: `Duplicate key; first defined on line ${existingLine}.`,
      });
      continue;
    }
    seen.set(path, entry.lineIndex + 1);
  }
  return diagnostics;
}
