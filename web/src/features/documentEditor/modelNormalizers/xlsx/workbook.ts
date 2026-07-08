import type { XlsxDefinedName } from "../../shared/models";
import { isRecord, numericField } from "../shared";

export function normalizeXlsxDefinedName(value: unknown): XlsxDefinedName | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.name !== "string" || item.name.trim() === "") return null;
  return {
    name: item.name,
    value: typeof item.value === "string" ? item.value : "",
    localSheetId: numericField(item.localSheetId),
    hidden: item.hidden === true,
    comment: typeof item.comment === "string" ? item.comment : undefined,
    sourceXml: typeof item.sourceXml === "string" ? item.sourceXml : undefined,
  };
}
