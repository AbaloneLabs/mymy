/**
 * TanStack Query hooks for this domain.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AuditLogsResponse } from "@/types/audit";

/* -------------------------------------------------- Audit Logs */

/**
 * Fetch audit logs with optional filters and pagination.
 *
 * @param actorType   Filter by "user" or "agent".
 * @param entityType  Filter by entity type (e.g. "note", "task").
 * @param action      Filter by "create", "update", or "delete".
 * @param startDate   Inclusive start (ISO 8601).
 * @param endDate     Exclusive end (ISO 8601).
 * @param limit       Page size (default 50, max 200).
 * @param offset      Pagination offset.
 */
export function useAuditLogs(params?: {
  actorType?: string;
  entityType?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: [
      "audit-logs",
      params?.actorType ?? "all",
      params?.entityType ?? "all",
      params?.action ?? "all",
      params?.startDate ?? "any",
      params?.endDate ?? "any",
      params?.limit ?? 50,
      params?.offset ?? 0,
    ],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params?.actorType) qs.set("actorType", params.actorType);
      if (params?.entityType) qs.set("entityType", params.entityType);
      if (params?.action) qs.set("action", params.action);
      if (params?.startDate) qs.set("startDate", params.startDate);
      if (params?.endDate) qs.set("endDate", params.endDate);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return api.get<AuditLogsResponse>(`/audit-logs${query}`);
    },
  });
}
