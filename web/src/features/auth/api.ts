/**
 * TanStack Query hooks for this domain.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/* -------------------------------------------------- Auth (PIN) */

interface PinStatusResponse {
  initialized: boolean;
  authenticated: boolean;
  recoveryScopeId: string | null;
}
interface PinVerifyResponse {
  valid: boolean;
  authenticated: boolean;
  recoveryScopeId: string | null;
}

export function usePinStatus() {
  return useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => api.get<PinStatusResponse>("/auth/status"),
  });
}

export function useVerifyPin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pin: string) =>
      api.post<PinVerifyResponse>("/auth/verify", { pin }),
    onSuccess: (data) => {
      qc.setQueryData<PinStatusResponse>(["auth", "status"], (current) => ({
        initialized: current?.initialized ?? true,
        authenticated: data.authenticated,
        recoveryScopeId: data.recoveryScopeId,
      }));
      return qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean }>("/auth/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });
}

export function useChangePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { currentPin: string; newPin: string }) =>
      api.post<{ success: boolean }>("/auth/pin", {
        current: vars.currentPin,
        next: vars.newPin,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth"] }),
  });
}
