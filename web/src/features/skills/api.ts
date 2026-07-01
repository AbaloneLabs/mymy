import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface NativeSkill {
  name: string;
  description: string;
  category?: string | null;
  path: string;
}

export interface SkillBundle {
  name: string;
  description: string;
  skills: string[];
  instruction?: string | null;
}

export interface SkillsConfig {
  templateVars: boolean;
  inlineShell: boolean;
  inlineShellTimeoutSecs: number;
}

interface SkillsResponse {
  skills: NativeSkill[];
  categories: string[];
}

interface SkillBundlesResponse {
  bundles: SkillBundle[];
}

interface SkillsConfigResponse {
  config: SkillsConfig;
}

interface SaveSkillBundleRequest {
  name: string;
  description: string;
  skills: string[];
  instruction?: string | null;
}

interface UpdateSkillsConfigRequest {
  templateVars?: boolean;
  inlineShell?: boolean;
  inlineShellTimeoutSecs?: number;
}

export function useNativeSkills() {
  return useQuery({
    queryKey: ["native-skills"],
    queryFn: () => api.get<SkillsResponse>("/skills"),
  });
}

export function useSkillBundles() {
  return useQuery({
    queryKey: ["skill-bundles"],
    queryFn: () => api.get<SkillBundlesResponse>("/skills/bundles"),
  });
}

export function useSkillsConfig() {
  return useQuery({
    queryKey: ["skills-config"],
    queryFn: () => api.get<SkillsConfigResponse>("/skills/config"),
  });
}

export function useSaveSkillBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveSkillBundleRequest) =>
      api.post<SkillBundlesResponse>("/skills/bundles", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-bundles"] }),
  });
}

export function useDeleteSkillBundle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete<{ success: boolean }>(`/skills/bundles/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-bundles"] }),
  });
}

export function useUpdateSkillsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSkillsConfigRequest) =>
      api.put<SkillsConfigResponse>("/skills/config", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills-config"] }),
  });
}
