


export type TransactionType = "income" | "expense";


export type TransactionStatus = "pending" | "cleared";


export interface Transaction {
  id: string;

  projectId?: string;

  type: TransactionType;

  amount: number;

  currency: string;

  category: string;

  date: string;

  description: string;

  status: TransactionStatus;

  createdAt: string;

  updatedAt: string;
}


export interface CreateTransactionInput {
  projectId?: string;
  type: TransactionType;
  amount: number;
  currency?: string;
  category?: string;
  date: string;
  description?: string;
  status?: TransactionStatus;
}


export interface UpdateTransactionInput {
  projectId?: string;
  type?: TransactionType;
  amount?: number;
  currency?: string;
  category?: string;
  date?: string;
  description?: string;
  status?: TransactionStatus;
}


export interface TransactionSummary {
  count: number;

  currency?: string;

  income?: number;

  expense?: number;

  net?: number;

  totalsByCurrency: Array<{
    currency: string;
    income: number;
    expense: number;
    net: number;
    count: number;
  }>;
}
