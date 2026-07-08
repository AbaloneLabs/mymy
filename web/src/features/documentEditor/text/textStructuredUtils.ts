/**
 * Structured text support is deliberately kept as lightweight parsing and
 * diagnostics instead of a full YAML/TOML/JSON Schema engine. This facade keeps
 * the editor-facing API stable while focused modules own diagnostics, parsing,
 * entry metadata, and source mutations.
 */
export { configEntryLineRange, configEntryParentLabel, configEntryPathLabel, configScalarType } from "./textConfigEntryUtils";
export {
  appendFlatConfigEntry,
  deleteFlatConfigGroup,
  duplicateFlatConfigEntry,
  flatConfigEntryCanDuplicate,
  flatConfigEntryCanMove,
  flatConfigLine,
  flatConfigLines,
  moveFlatConfigEntry,
} from "./textFlatConfigOperations";
export {
  joinStructuredTextLines,
  splitStructuredTextLines,
} from "./textFlatConfigStructure";
export { parseFlatConfig } from "./textFlatConfigParsers";
export { jsonSchemaDiagnostics } from "./textJsonSchemaDiagnostics";
export { sourceDiagnostics } from "./textStructuredDiagnostics";
export type { ConfigEntry, SourceDiagnostic } from "./textStructuredTypes";
