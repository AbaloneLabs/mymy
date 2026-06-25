import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePinStatus } from "@/features/auth/api";
import { useAuthStore } from "@/store/auth";


export function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setAuthState = useAuthStore((s) => s.setAuthState);
  const status = usePinStatus();
  const serverAuthenticated = status.data?.authenticated;
  const authenticated = serverAuthenticated ?? isAuthenticated;

  useEffect(() => {
    if (serverAuthenticated !== undefined) {
      setAuthState(serverAuthenticated);
    }
  }, [serverAuthenticated, setAuthState]);

  if (status.isLoading && !isAuthenticated) {
    return null;
  }

  if (!authenticated) {
    return <Navigate to="/pin" replace />;
  }
  return <>{children}</>;
}
