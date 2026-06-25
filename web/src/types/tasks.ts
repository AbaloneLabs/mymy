import type { TaskStatus } from "./task-statuses";


export type TaskPriority = "low" | "medium" | "high" | "urgent";


export interface Task {
  id: string;

  projectId?: string;

  title: string;

  description: string;

  status: TaskStatus;

  priority: TaskPriority;

  dueDate?: string;

  completedAt?: string;

  createdAt: string;

  updatedAt: string;
}


export interface CreateTaskInput {
  projectId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string;
}


export interface UpdateTaskInput {
  projectId?: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;

  dueDate?: string;
}
