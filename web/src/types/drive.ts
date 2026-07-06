import type { DocumentEditorKind } from "./documentEditor";

export type DriveEntryKind = "directory" | "file";

export type DriveProviderKind = "local_vm" | "s3";

export interface DriveEntry {
  name: string;
  path: string;
  kind: DriveEntryKind;
  mimeType: string;
  size: number;
  updatedAt?: string;
  provider: DriveProviderKind;
}

export interface DriveListResponse {
  path: string;
  entries: DriveEntry[];
}

export interface DriveFileResponse {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt?: string;
  content: string;
  editable: boolean;
  editorKind: DocumentEditorKind;
}

export interface DriveProviderStatus {
  provider: DriveProviderKind;
  configured: boolean;
  writable: boolean;
  bucket?: string;
  region?: string;
  endpoint?: string;
}

export interface DriveProvidersResponse {
  providers: DriveProviderStatus[];
}

export interface DriveUploadResponse {
  success: boolean;
  files: DriveEntry[];
}

export interface DriveTrashEntry {
  id: string;
  originalPath: string;
  trashPath: string;
  kind: DriveEntryKind;
  size: number;
  deletedAt: string;
}

export interface DriveTrashResponse {
  entries: DriveTrashEntry[];
}

export interface DriveRestoreResponse {
  success: boolean;
  restoredPath: string;
}

export type DriveSyncOperation = "upload" | "download" | "delete";

export type DriveSyncStatus = "pending" | "running" | "failed" | "done";

export interface DriveSyncJob {
  id: string;
  provider: DriveProviderKind;
  drivePath: string;
  operation: DriveSyncOperation;
  status: DriveSyncStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DriveSyncJobsResponse {
  jobs: DriveSyncJob[];
}

export type PreviewStatus = "active" | "stopped" | "failed";

export type PreviewVisibility = "session" | "public";

export interface PreviewEndpoint {
  id: string;
  agentProfile: string;
  projectId?: string;
  processId?: string;
  label: string;
  targetUrl: string;
  token: string;
  visibility: PreviewVisibility;
  status: PreviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewEndpointsResponse {
  previews: PreviewEndpoint[];
}

export interface CreatePreviewEndpointInput {
  agentProfile: string;
  projectId?: string;
  label: string;
  targetUrl: string;
  visibility?: PreviewVisibility;
}
