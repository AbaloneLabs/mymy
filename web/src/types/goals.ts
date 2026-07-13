


export type GoalType = "quarterly" | "annual" | "monthly";


export type GoalStatus = "active" | "completed" | "archived";


export type KpiType = "manual" | "task_completion" | "finance";

/**
 * A lightweight task reference attached to a Key Result.
 * Used by the KR task linking feature to render per-KR task lists.
 */
export interface LinkedTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
}

export interface FinanceKpiDefinition {
  metric: "income" | "expense" | "net";
  currency: string;
  scope: "all" | "general" | "project";
  projectId?: string;
  status: "all" | "cleared" | "pending";
  from?: string;
  to?: string;
  category?: string;
}


export interface KeyResult {
  id: string;

  goalId: string;

  title: string;

  kpiType: KpiType;

  targetValue: number;

  currentValue: number;

  unit: string;

  progress: number;

  financeDefinition?: FinanceKpiDefinition;

  calculationStatus: "ready" | "no_assignment" | "unconfigured" | "broken_scope";

  /** Tasks linked directly to this KR. Populated by the backend. */
  linkedTasks?: LinkedTask[];

  createdAt: string;

  updatedAt: string;
}


export interface Goal {
  id: string;

  title: string;

  description: string;

  type: GoalType;

  period: string;

  status: GoalStatus;

  progress: number;

  keyResults?: KeyResult[];

  taskAssignment: {
    assigned: number;
    completed: number;
    hasAssignment: boolean;
  };

  createdAt: string;

  updatedAt: string;
}


export interface CreateGoalInput {
  title: string;
  description?: string;
  type?: GoalType;
  period?: string;
  status?: GoalStatus;
}


export interface UpdateGoalInput {
  title?: string;
  description?: string;
  type?: GoalType;
  period?: string;
  status?: GoalStatus;
}


export interface CreateKeyResultInput {
  title: string;
  kpiType?: KpiType;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  financeDefinition?: FinanceKpiDefinition;
}


export interface UpdateKeyResultInput {
  title?: string;
  kpiType?: KpiType;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  financeDefinition?: FinanceKpiDefinition | null;
}
