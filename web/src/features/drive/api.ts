import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "@/lib/api";
import type {
  CreatePreviewEndpointInput,
  DriveFileResponse,
  DriveListResponse,
  DriveProvidersResponse,
  PreviewEndpoint,
  PreviewEndpointsResponse,
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

export function useWriteDriveFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { path: string; content: string }) =>
      api.put<{ success: boolean }>("/drive/file", body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["drive", "file", variables.path] });
      qc.invalidateQueries({ queryKey: ["drive", "list"] });
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

export function previewUrl(token: string) {
  return `${API_BASE}/previews/${token}`;
}
