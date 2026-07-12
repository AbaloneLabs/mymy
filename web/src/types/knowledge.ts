


export type KnowledgeNodeType = "category" | "article";


export type KnowledgeStatus = "draft" | "published";


export interface KnowledgeArticle {
  id: string;

  parentId?: string;

  /** Owning project (only on root nodes). */
  projectId?: string;

  nodeType: KnowledgeNodeType;
  title: string;

  slug: string;

  content: string;

  excerpt: string;
  tags: string[];
  status: KnowledgeStatus;

  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}


export interface KnowledgeTreeNode extends KnowledgeArticle {
  children: KnowledgeTreeNode[];
  resources: KnowledgeResource[];
}

export interface KnowledgeResource {
  id: string;
  knowledgeId: string;
  driveResourceId?: string;
  resourceType: "drive_file";
  resourceRef: string;
  title: string;
  sortOrder: number;
  status: "linked" | "broken";
  editorKind: "markdown" | "docx" | "xlsx" | "pptx";
  createdAt: string;
  updatedAt: string;
}


export interface KnowledgeBreadcrumbItem {
  id: string;
  title: string;
  slug: string;
  nodeType: KnowledgeNodeType;
}


export interface CreateKnowledgeArticleInput {
  parentId?: string;
  /** Owning project (root nodes only). */
  projectId?: string;
  nodeType?: KnowledgeNodeType;
  title: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  tags?: string[];
  status?: KnowledgeStatus;
  sortOrder?: number;
}


export interface UpdateKnowledgeArticleInput {
  parentId?: string | null;
  nodeType?: KnowledgeNodeType;
  title?: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  tags?: string[];
  status?: KnowledgeStatus;
  sortOrder?: number;
}


export interface MoveKnowledgeArticleInput {
  parentId?: string | null;
  /** New project (only when moving to root). */
  projectId?: string | null;
  sortOrder?: number;
}
