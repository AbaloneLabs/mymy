/**
 * Audit log section for Settings.
 *
 * The section owns filter state and the paged query. Filter controls, timeline
 * rendering, and pagination are split out so each component has one reason to
 * change as audit log fields evolve.
 */
import { useState } from "react";
import type { AuditLogAction, AuditLogActorType } from "@/types/audit";
import { useAuditLogs } from "@/features/audit/api";
import { AuditLogFilters } from "./AuditLogFilters";
import { AuditLogPagination } from "./AuditLogPagination";
import { AuditLogTimeline } from "./AuditLogTimeline";

const PAGE_SIZE = 20;

export function AuditLogSection() {
  const [actorType, setActorType] = useState<"" | AuditLogActorType>("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState<"" | AuditLogAction>("");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isError } = useAuditLogs({
    actorType: actorType || undefined,
    entityType: entityType || undefined,
    action: action || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function changeActor(value: "" | AuditLogActorType) {
    setActorType(value);
    setOffset(0);
  }

  function changeEntity(value: string) {
    setEntityType(value);
    setOffset(0);
  }

  function changeAction(value: "" | AuditLogAction) {
    setAction(value);
    setOffset(0);
  }

  function selectSecurityDenials() {
    setActorType("agent");
    setEntityType("filesystem_guard");
    setAction("deny");
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <AuditLogFilters
        actorType={actorType}
        entityType={entityType}
        action={action}
        total={total}
        onActorChange={changeActor}
        onEntityChange={changeEntity}
        onActionChange={changeAction}
        onSelectSecurityDenials={selectSecurityDenials}
      />

      <AuditLogTimeline logs={logs} isLoading={isLoading} isError={isError} />

      {totalPages > 1 && (
        <AuditLogPagination
          currentPage={currentPage}
          totalPages={totalPages}
          canPrevious={offset > 0}
          canNext={offset + PAGE_SIZE < total}
          onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => setOffset(offset + PAGE_SIZE)}
        />
      )}
    </div>
  );
}
