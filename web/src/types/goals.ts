


export type GoalType = "quarterly" | "annual" | "monthly";


export type GoalStatus = "active" | "completed" | "archived";


export type KpiType = "manual" | "task_completion" | "finance";


export interface KeyResult {
  id: string;

  goalId: string;

  title: string;

  kpiType: KpiType;

  targetValue: number;

  currentValue: number;

  unit: string;

  progress: number;

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
}


export interface UpdateKeyResultInput {
  title?: string;
  kpiType?: KpiType;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
}
