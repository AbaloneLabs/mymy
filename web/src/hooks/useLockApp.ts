import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

/**
 * Lock the local UI immediately and ask the backend to revoke the session.
 *
 * The UI should not wait for the network before moving to the PIN screen:
 * a slow or already-expired session should still feel locked right away.
 * The backend request clears the HttpOnly cookie and the in-memory
 * PIN-derived encryption key when the server is reachable.
 */
export function useLockApp() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setAuthState = useAuthStore((s) => s.setAuthState);

  return useCallback(() => {
    setAuthState(false);
    queryClient.clear();
    navigate("/pin", { replace: true });

    void api.post<{ success: boolean }>("/auth/logout").catch(() => {
      // Local lock is already applied. A failed logout means the server was
      // unreachable or the session was already invalid, so there is nothing
      // useful to surface in the UI here.
    });
  }, [navigate, queryClient, setAuthState]);
}
