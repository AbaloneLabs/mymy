


export type GitSystemType = "github" | "gitlab" | "gitea";

export interface GitSystemConfig {
  type: GitSystemType;
  enabled: boolean;
  host: string;
  port: number;
  sshAlias: string;
  username: string;

  apiToken?: string;
}


export type Language = "en" | "ko" | "zh" | "ja";

export interface AppSettings {
  language: Language;
  gitSystems: {
    github: GitSystemConfig;
    gitlab: GitSystemConfig;
    gitea: GitSystemConfig;
  };
}

// ---- LLM Providers ----

/** Wire format for API calls. "auto" resolves at runtime. */
export type ApiFormat = "openai" | "anthropic" | "auto";

/** A configured LLM provider, as returned by the API. */
export interface LlmProvider {
  id: string;
  label: string;
  api_format: ApiFormat;
  base_url: string;
  /** Masked hint of the API key, e.g. `sk-...7a2b`. */
  api_key_hint: string;
  model: string;
  max_tokens: number;
  is_default: boolean;
  enabled: boolean;
  preset: string | null;
}

/** Preset identifiers for the Add Provider dropdown. */
export type LlmProviderPreset =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "groq"
  | "together"
  | "deepseek"
  | "custom";

/** A single model entry from the model list endpoint. */
export interface ModelInfo {
  id: string;
  display_name: string;
  is_curated: boolean;
}

export type ModelListSource = "live" | "curated" | "error";

export interface CredentialRateLimitStatus {
  credentialId?: string;
  label: string;
  status: "ok" | "exhausted" | "dead" | string;
  resetAt?: string;
  resetAfterSecs?: number;
  requestCount: number;
}

export interface ProviderRateLimitStatus {
  providerId: string;
  label: string;
  credentials: CredentialRateLimitStatus[];
}

export interface SecretSourceStatus {
  name: string;
  configured: boolean;
}

export interface SecurityStatus {
  redactionEnabled: boolean;
  filesystemGuardEnabled: boolean;
  tlsValidationEnabled: boolean;
  secretSources: SecretSourceStatus[];
  contentEngineEnabled: boolean;
  contentPolicyVersion: string;
  pendingQuarantineCount: number;
  quarantineCapacityAvailable: boolean;
}

export type ContentOrigin =
  | "user_edit"
  | "user_upload"
  | "agent_generated"
  | "agent_download"
  | "s3_download"
  | "connector_import"
  | "editor_output";

export type ContentFindingCode =
  | "ambiguous_filename"
  | "double_extension"
  | "declared_type_mismatch"
  | "executable_content"
  | "script_content"
  | "unknown_content_type"
  | "restricted_format"
  | "archive_active_content"
  | "ooxml_macro"
  | "ooxml_active_x"
  | "ooxml_ole_embedding"
  | "ooxml_external_relationship"
  | "ooxml_svg_content"
  | "archive_resource_limit"
  | "invalid_archive_structure"
  | "invalid_document_structure"
  | "invalid_media_structure";

export interface ContentSafetyFinding {
  code: ContentFindingCode;
  severity: "notice" | "suspicious" | "dangerous" | "invalid";
}

export interface QuarantineItem {
  id: string;
  desiredPath: string;
  normalizedName: string;
  detectedType: string;
  origin: ContentOrigin;
  actorKind: string;
  actorLabel?: string;
  size: number;
  findings: ContentSafetyFinding[];
  policyVersion: string;
  status: string;
  version: number;
  createdAt: string;
  expiresAt: string;
}

export interface QuarantineListResponse {
  items: QuarantineItem[];
  nextCursor?: string;
}

export interface QuarantineDecisionResponse {
  id: string;
  status: string;
  version: number;
  committedPath?: string;
  fingerprint?: string;
}
