


export type AuditLogActorType = "user" | "agent";


export type AuditLogAction = "create" | "update" | "delete";


export interface AuditLog {
  id: string;

  actorType: AuditLogActorType;

  actorId: string;

  action: AuditLogAction;

  entityType: string;

  entityId?: string;

  changes?: Record<string, unknown>;

  createdAt: string;
}


export interface AuditLogsResponse {
  logs: AuditLog[];

  total: number;
  limit: number;
  offset: number;
}
