export interface AccountSummary {
  id: string;
  name?: string;
  label?: string;
  status?: string;
  planType?: string | null;
  isAvailable?: boolean;
  usage?: {
    usedPercent?: number | null;
    remainPercent?: number | null;
  } | null;
}

export interface AccountListResult {
  items: AccountSummary[];
  total?: number;
}

export interface AggregateApiSummary {
  id: string;
  supplierName?: string | null;
  providerType?: string | null;
  protocolMode?: string | null;
  url: string;
  status: string;
  sort?: number;
  lastTestStatus?: string | null;
}

export interface ApiKeySummary {
  id: string;
  name?: string | null;
  keyPreview?: string | null;
  status?: string;
  rotationStrategy?: string | null;
  model?: string | null;
}

export interface ModelInfo {
  slug: string;
  displayName?: string | null;
  name?: string | null;
  source?: string | null;
  sourceKind?: string | null;
  visibility?: string | null;
  supportedInApi?: boolean | null;
  updatedAt?: number | string | null;
}

export interface RequestLogSummary {
  id?: number | string;
  traceId?: string | null;
  requestPath?: string;
  path?: string;
  method?: string;
  statusCode?: number | null;
  accountId?: string | null;
  upstreamUrl?: string | null;
  aggregateApiSupplierName?: string | null;
  model?: string | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  createdAt?: number | null;
}
