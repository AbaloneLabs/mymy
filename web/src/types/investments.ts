export interface InvestmentAccount {
  id: string;
  projectId?: string;
  name: string;
  institution: string;
  currency: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentAsset {
  id: string;
  symbol: string;
  name: string;
  assetType: string;
  exchange: string;
  currency: string;
  sector: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentPosition {
  id: string;
  accountId?: string;
  projectId?: string;
  assetId: string;
  quantityMicro: number;
  costBasisAmount: number;
  currency: string;
  openedAt?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  accountName?: string;
  assetSymbol: string;
  assetName: string;
  assetType: string;
  latestMarketValueAmount?: number;
  latestUnitPriceAmount?: number;
  latestValuedAt?: string;
  latestValuationCurrency?: string;
  unrealizedPlAmount?: number;
}

export interface InvestmentValuationSnapshot {
  id: string;
  positionId: string;
  unitPriceAmount?: number;
  marketValueAmount: number;
  currency: string;
  recordedAt: string;
  notes: string;
}

export interface InvestmentCashflow {
  id: string;
  accountId?: string;
  projectId?: string;
  assetId?: string;
  flowType: string;
  amount: number;
  currency: string;
  recordedAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  accountName?: string;
  assetSymbol?: string;
}

export interface InvestmentWatchlistItem {
  id: string;
  assetId: string;
  targetPriceAmount?: number;
  currency: string;
  notes: string;
  createdAt: string;
  assetSymbol: string;
  assetName: string;
  assetType: string;
}

export interface InvestmentAllocation {
  label: string;
  currency: string;
  amount: number;
}

export interface InvestmentCurrencySummary {
  currency: string;
  costBasisAmount: number;
  marketValueAmount: number;
  unrealizedPlAmount?: number;
  incomeAmount: number;
  expenseAmount: number;
  netCashflowAmount: number;
  hasCurrencyMismatch: boolean;
}

export interface InvestmentSummary {
  currency?: string;
  costBasisAmount?: number;
  marketValueAmount?: number;
  unrealizedPlAmount?: number;
  incomeAmount?: number;
  expenseAmount?: number;
  netCashflowAmount?: number;
  positionCount: number;
  accountCount: number;
  watchlistCount: number;
  allocations: InvestmentAllocation[];
  totalsByCurrency: InvestmentCurrencySummary[];
  hasCurrencyMismatch: boolean;
}

export interface InvestmentSummaryResponse {
  summary: InvestmentSummary;
}

export interface InvestmentAccountsResponse {
  accounts: InvestmentAccount[];
}

export interface InvestmentAssetsResponse {
  assets: InvestmentAsset[];
}

export interface InvestmentPositionsResponse {
  positions: InvestmentPosition[];
}

export interface InvestmentValuationSnapshotsResponse {
  valuationSnapshots: InvestmentValuationSnapshot[];
}

export interface InvestmentCashflowsResponse {
  cashflows: InvestmentCashflow[];
}

export interface InvestmentWatchlistResponse {
  watchlist: InvestmentWatchlistItem[];
}

export interface CreateInvestmentAccountInput {
  projectId?: string;
  name: string;
  institution?: string;
  currency?: string;
  notes?: string;
}

export interface CreateInvestmentAssetInput {
  symbol: string;
  name?: string;
  assetType?: string;
  exchange?: string;
  currency?: string;
  sector?: string;
  notes?: string;
}

export interface CreateInvestmentPositionInput {
  accountId?: string;
  assetId: string;
  quantityMicro: number;
  costBasisAmount: number;
  currency?: string;
  openedAt?: string;
  notes?: string;
}

export interface CreateInvestmentValuationSnapshotInput {
  positionId: string;
  unitPriceAmount?: number;
  marketValueAmount: number;
  currency?: string;
  recordedAt?: string;
  notes?: string;
}

export interface CreateInvestmentCashflowInput {
  accountId?: string;
  assetId?: string;
  flowType: string;
  amount: number;
  currency?: string;
  recordedAt?: string;
  notes?: string;
}

export interface CreateInvestmentWatchlistInput {
  assetId: string;
  targetPriceAmount?: number;
  currency?: string;
  notes?: string;
}
