import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "@/lib/api";
import type {
  CreatePreviewEndpointInput,
  DriveFileResponse,
  DriveListResponse,
  DriveProvidersResponse,
  DriveRestoreResponse,
  DriveSyncJobsResponse,
  DriveTrashResponse,
  DriveUploadResponse,
  PreviewEndpoint,
  PreviewEndpointsResponse,
  WriteDriveFileResponse,
} from "@/types/drive";

function driveQuery(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return params.toString();
}

export function useDriveList(path: string) {
  return useQuery({
    queryKey: ["drive", "list", path],
    queryFn: () => api.get<DriveListResponse>(`/drive?${driveQuery(path)}`),
  });
}

export function useDriveFile(path: string | null) {
  return useQuery({
    queryKey: ["drive", "file", path],
    enabled: Boolean(path),
    queryFn: () => api.get<DriveFileResponse>(`/drive/file?${driveQuery(path ?? "/drive")}`),
  });
}

export function useDriveProviders() {
  return useQuery({
    queryKey: ["drive", "providers"],
    queryFn: () => api.get<DriveProvidersResponse>("/drive/providers"),
  });
}

export function useDriveSyncJobs() {
  return useQuery({
    queryKey: ["drive", "sync-jobs"],
    queryFn: () => api.get<DriveSyncJobsResponse>("/drive/sync-jobs"),
  });
}

export function useWriteDriveFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      path: string;
      content: string;
      expectedFingerprint?: string;
      idempotencyKey?: string;
    }) => api.put<WriteDriveFileResponse>("/drive/file", body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["drive", "file", variables.path] });
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "sync-jobs"] });
    },
  });
}

export function useCreateDriveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.post<{ success: boolean }>("/drive/folder", { path }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive", "list"] }),
  });
}

export function useDeleteDrivePath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.delete<{ success: boolean }>(`/drive?${driveQuery(path)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "file"] });
      qc.invalidateQueries({ queryKey: ["drive", "trash"] });
      qc.invalidateQueries({ queryKey: ["drive", "sync-jobs"] });
    },
  });
}

export function useUploadDriveFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, files }: { path: string; files: File[] }) =>
      uploadDriveFiles(path, files),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "sync-jobs"] });
    },
  });
}

export async function uploadDriveFiles(
  path: string,
  files: File[],
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
) {
  const form = new FormData();
  form.append("path", path);
  if (options.idempotencyKey) {
    form.append("idempotencyKey", options.idempotencyKey);
  }
  for (const file of files) {
    form.append("file", file, file.name);
  }
  return api.form<DriveUploadResponse>("/drive/upload", form, {
    signal: options.signal,
  });
}

export function deleteDrivePath(path: string) {
  return api.delete<{ success: boolean }>(`/drive?${driveQuery(path)}`);
}

export function useDriveTrash() {
  return useInfiniteQuery({
    queryKey: ["drive", "trash"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: "50" });
      if (pageParam) query.set("cursor", pageParam);
      return api.get<DriveTrashResponse>(`/drive/trash?${query.toString()}`);
    },
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
}

export function useRestoreDriveTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      idempotencyKey,
      expectedLifecycleRevision,
    }: {
      id: string;
      idempotencyKey: string;
      expectedLifecycleRevision?: string;
    }) => {
      const query = new URLSearchParams({ idempotencyKey });
      if (expectedLifecycleRevision) query.set("expectedLifecycleRevision", expectedLifecycleRevision);
      return api.post<DriveRestoreResponse>(`/drive/trash/${id}/restore?${query.toString()}`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "trash"] });
      qc.invalidateQueries({ queryKey: ["drive", "sync-jobs"] });
      qc.invalidateQueries({ queryKey: ["artifacts"] });
      qc.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
}

export function usePurgeDriveTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      idempotencyKey,
      expectedLifecycleRevision,
    }: {
      id: string;
      idempotencyKey: string;
      expectedLifecycleRevision?: string;
    }) => {
      const query = new URLSearchParams({ idempotencyKey });
      if (expectedLifecycleRevision) query.set("expectedLifecycleRevision", expectedLifecycleRevision);
      return api.delete<{ success: boolean }>(`/drive/trash/${id}?${query.toString()}`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
      qc.invalidateQueries({ queryKey: ["drive", "file"] });
      qc.invalidateQueries({ queryKey: ["drive", "trash"] });
      qc.invalidateQueries({ queryKey: ["artifacts"] });
      qc.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
}

export function usePreviewEndpoints(agentProfile?: string | null) {
  return useQuery({
    queryKey: ["preview-endpoints", agentProfile ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams();
      if (agentProfile) params.set("agentProfile", agentProfile);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return api.get<PreviewEndpointsResponse>(`/preview-endpoints${qs}`);
    },
  });
}

export function useCreatePreviewEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePreviewEndpointInput) =>
      api.post<{ preview: PreviewEndpoint }>("/preview-endpoints", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preview-endpoints"] }),
  });
}

export function useDeletePreviewEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/preview-endpoints/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preview-endpoints"] }),
  });
}

export function driveBlobUrl(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return `${API_BASE}/drive/blob?${params.toString()}`;
}

export function drivePackageUrl(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return `${API_BASE}/drive/download-package?${params.toString()}`;
}

export function driveHtmlViewerUrl(path: string) {
  const params = new URLSearchParams();
  params.set("path", path);
  return `${API_BASE}/web-viewer/drive?${params.toString()}`;
}

export function previewUrl(token: string) {
  return `${API_BASE}/previews/${token}`;
}
