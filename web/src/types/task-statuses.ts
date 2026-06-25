


export type TaskStatus = string;


export interface TaskStatusDef {

  slug: string;

  label: string;

  color: TaskStatusColor;

  sortOrder: number;

  isDone: boolean;

  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Available status colors. */
export type TaskStatusColor = "gray" | "blue" | "green" | "orange" | "red" | "purple";

export interface CreateTaskStatusInput {
  /** Slug; if omitted, derived from label by the backend. */
  slug?: string;
  label: string;
  color?: TaskStatusColor;
  isDone?: boolean;
}

export interface UpdateTaskStatusInput {
  label?: string;
  color?: TaskStatusColor;
  isDone?: boolean;
}

export interface ReorderTaskStatusesInput {

  slugs: string[];
}
