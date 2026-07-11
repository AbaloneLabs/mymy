export interface SourceDiagnostic {
  line?: number;
  column?: number;
  length?: number;
  path?: string;
  message: string;
}

export interface ConfigEntry {
  documentIndex?: number;
  lineIndex: number;
  lineEndIndex?: number;
  key: string;
  keyStartColumn?: number;
  keyEndColumn?: number;
  value: string;
  valueStartColumn?: number;
  valueEndColumn?: number;
  path: string[];
  section?: string;
  indent: string;
  suffix: string;
  valuePrefix?: string;
  yamlDecorators?: string[];
  sequencePrefix?: string;
  keyEditable: boolean;
  entryKind: "mapping" | "sequence" | "toml";
  valueHeader?: string;
  valueIndent?: string;
  valueStyle?: "yaml-block" | "toml-multiline";
}
