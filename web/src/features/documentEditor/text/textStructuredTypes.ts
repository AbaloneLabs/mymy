export interface SourceDiagnostic {
  line?: number;
  path?: string;
  message: string;
}

export interface ConfigEntry {
  lineIndex: number;
  lineEndIndex?: number;
  key: string;
  value: string;
  path: string[];
  section?: string;
  indent: string;
  suffix: string;
  keyEditable: boolean;
  entryKind: "mapping" | "sequence" | "toml";
  valueHeader?: string;
  valueIndent?: string;
  valueStyle?: "yaml-block" | "toml-multiline";
}
