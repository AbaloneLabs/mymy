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
}


export interface SearchResultProject {
  id: string;
  name: string;
  description?: string;
  status: string;
}


export interface SearchResultEvent {
  id: string;
  title: string;
  startDate: string;
  endDate?: string;
  projectId?: string;
}


export interface SearchResultMessage {
  entityType: "chatSession" | "chatMessage";
  id: string;

  title: string;

  sessionId?: string;
  projectId?: string;
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
