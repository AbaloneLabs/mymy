import type { KnowledgeNodeType, KnowledgeStatus } from "./knowledge";




export interface SearchResultNote {
  id: string;
  title: string;

  preview: string;
  projectId?: string;
  updatedAt: string;
}


export interface SearchResultTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId?: string;
  dueDate?: string;
  updatedAt: string;
}


export interface SearchResultProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  updatedAt: string;
}


export interface SearchResultEvent {
  id: string;
  title: string;
  startDate: string;
  endDate?: string;
  projectId?: string;
  updatedAt: string;
}


export interface SearchResultMessage {
  entityType: "chatSession" | "chatMessage";
  id: string;

  title: string;

  sessionId?: string;
  projectId?: string;
  authorRole?: string;
  updatedAt: string;
}


export interface SearchResultKnowledge {
  id: string;
  title: string;

  preview: string;
  nodeType: KnowledgeNodeType;
  status: KnowledgeStatus;
  updatedAt: string;
}


export interface SearchResults {
  notes: SearchResultNote[];
  tasks: SearchResultTask[];
  projects: SearchResultProject[];
  events: SearchResultEvent[];
  messages: SearchResultMessage[];
  knowledge: SearchResultKnowledge[];
}


export interface SearchResponse {
  query: string;
  results: SearchResults;
  total: number;
}

export type WorkspaceSearchDomain =
  | "sessions"
  | "tasks"
  | "notes"
  | "knowledge"
  | "drive"
  | "projects"
  | "calendar";

export type WorkspaceSearchScope =
  | "current_project"
  | "current_plus_global"
  | "all_permitted";

export interface WorkspaceSearchSourceLink {
  kind: string;
  id?: string;
  resourceId?: string;
  path?: string;
  mimeType?: string;
}

export interface WorkspaceSearchHit {
  domain: WorkspaceSearchDomain;
  resourceKind: string;
  stableId: string;
  title: string;
  snippet?: string;
  projectId?: string;
  scope: string;
  lifecycleState: string;
  freshness?: string;
  evidenceRole:
    | "user_asserted"
    | "agent_observed"
    | "external_source_claim"
    | "system_generated"
    | "unknown";
  sourceLink: WorkspaceSearchSourceLink;
  locations?: Array<{
    kind: string;
    label?: string;
    sourceLink: WorkspaceSearchSourceLink;
  }>;
  normalizedScore: number;
  reasonCodes: string[];
  revision?: string;
}

export interface WorkspaceSearchPartialFailure {
  domain: WorkspaceSearchDomain;
  code: string;
}

export interface WorkspaceSearchResponse {
  rankerVersion: string;
  scope: WorkspaceSearchScope;
  hits: WorkspaceSearchHit[];
  partialFailures: WorkspaceSearchPartialFailure[];
  nextCursor?: string;
  snapshotExpiresAt?: string;
}
