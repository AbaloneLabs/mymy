import type { Note } from "./notes";
import type { KnowledgeArticle } from "./knowledge";




export type VersionEntityType = "note" | "task" | "knowledge_article";


export type VersionActorType = "user" | "agent" | "system";


export interface NoteSnapshot {
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  projectId?: string;
}


/** Snapshot of a knowledge article's editable state (version restore). */
export interface KnowledgeArticleSnapshot {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  tags: string[];
  status: string;
  nodeType: string;
  parentId?: string;
  projectId?: string;
  sortOrder: number;
}

/** Union of all entity snapshot types. */
export type EntitySnapshot = NoteSnapshot | KnowledgeArticleSnapshot;


export interface EntityVersionSummary {
  id: string;
  entityType: VersionEntityType;
  entityId: string;
  versionNum: number;
  actorType: VersionActorType;
  actorLabel?: string;

  changeSummary: string;

  createdAt: string;
}


export interface EntityVersion extends EntityVersionSummary {
  snapshot: EntitySnapshot;

  snapshotSize: number;
}


export interface EntityVersionsResponse {
  versions: EntityVersionSummary[];
}


export interface EntityVersionResponse {
  version: EntityVersion;
}


export interface RestoreVersionResponse {
  note?: Note;
  article?: KnowledgeArticle;
  version: EntityVersionSummary;
}
