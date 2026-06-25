


export interface Note {
  id: string;

  projectId?: string;

  title: string;

  content: string;

  tags: string[];

  pinned: boolean;

  createdAt: string;

  updatedAt: string;
}


export interface CreateNoteInput {
  projectId?: string;
  title: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
}


export interface UpdateNoteInput {
  projectId?: string;
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
}
