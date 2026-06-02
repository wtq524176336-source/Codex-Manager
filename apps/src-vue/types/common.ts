export interface AccountSummary {
  id: string;
  name: string;
  label: string;
  group?: string;
  groupName?: string;
  priority?: number;
  sort?: number;
  preferred?: boolean;
  status: string;
  statusReason?: string;
  planType?: string | null;
  planTypeRaw?: string | null;
  subscriptionPlan?: string | null;
  subscriptionExpiresAt?: number | null;
  subscriptionRenewsAt?: number | null;
  currentWindowCostUsd?: number;
  primaryWindowCostUsd?: number;
  secondaryWindowCostUsd?: number;
  note?: string | null;
  tags?: string[];
  isAvailable?: boolean;
  isLowQuota?: boolean;
  availabilityText?: string;
  availabilityLevel?: string;
  lastRefreshAt?: number | null;
  usage?: {
    accountId?: string;
    availabilityStatus?: string;
    usedPercent?: number | null;
    remainPercent?: number | null;
    windowMinutes?: number | null;
    resetsAt?: number | null;
    secondaryUsedPercent?: number | null;
    secondaryRemainPercent?: number | null;
    secondaryWindowMinutes?: number | null;
    secondaryResetsAt?: number | null;
    capturedAt?: number | null;
  } | null;
  [key: string]: unknown;
}

export interface AccountListResult {
  items: AccountSummary[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface AggregateApiSummary {
  id: string;
  supplierName?: string | null;
  providerType?: string | null;
  protocolMode?: string | null;
  url: string;
  authType?: string | null;
  authCustomEnabled?: boolean | null;
  authParams?: Record<string, unknown> | null;
  actionCustomEnabled?: boolean | null;
  action?: string | null;
  modelOverride?: string | null;
  status: string;
  sort?: number;
  createdAt?: number | null;
  updatedAt?: number | null;
  lastTestAt?: number | null;
  lastTestStatus?: string | null;
  lastTestError?: string | null;
  estimatedCostUsd?: number;
  [key: string]: unknown;
}

export interface AggregateApiSecretResult {
  id: string;
  key: string;
  authType?: string | null;
  username?: string | null;
  password?: string | null;
}

export interface AggregateApiTestResult {
  id: string;
  ok: boolean;
  statusCode?: number | null;
  message?: string | null;
  testedAt?: number | null;
  latencyMs?: number | null;
}

export interface ApiKeySummary {
  id: string;
  name?: string | null;
  keyPreview?: string | null;
  status?: string;
  rotationStrategy?: string | null;
  model?: string | null;
  modelSlug?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  aggregateApiId?: string | null;
  accountPlanFilter?: string | null;
  protocol?: string | null;
  clientType?: string | null;
  authScheme?: string | null;
  upstreamBaseUrl?: string | null;
  staticHeadersJson?: string | null;
  createdAt?: number | null;
  lastUsedAt?: number | null;
  totalTokens?: number;
  estimatedCostUsd?: number;
  [key: string]: unknown;
}

export interface ApiKeyCreateResult {
  id: string;
  key: string;
}

export interface ApiKeyUsageStat {
  keyId: string;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ModelInfo {
  slug: string;
  displayName?: string | null;
  name?: string | null;
  description?: string | null;
  defaultReasoningLevel?: string | null;
  supportedReasoningLevels?: Array<Record<string, unknown>>;
  source?: string | null;
  sourceKind?: string | null;
  visibility?: string | null;
  supportedInApi?: boolean | null;
  priority?: number;
  userEdited?: boolean;
  sortIndex?: number;
  updatedAt?: number | string | null;
  contextWindow?: number | null;
  availableInPlans?: string[];
  inputModalities?: string[];
  [key: string]: unknown;
}

export interface ModelListResult {
  items: ModelInfo[];
}

export interface RequestLogSummary {
  id?: number | string;
  traceId?: string | null;
  keyId?: string | null;
  requestPath?: string;
  originalPath?: string;
  adaptedPath?: string;
  path?: string;
  method?: string;
  requestType?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  effectiveServiceTier?: string | null;
  statusCode?: number | null;
  accountId?: string | null;
  initialAccountId?: string | null;
  attemptedAccountIds?: string[];
  initialAggregateApiId?: string | null;
  attemptedAggregateApiIds?: string[];
  upstreamUrl?: string | null;
  aggregateApiSupplierName?: string | null;
  aggregateApiUrl?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  reasoningOutputTokens?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
  firstResponseMs?: number | null;
  error?: string | null;
  createdAt?: number | null;
  [key: string]: unknown;
}

export interface RequestLogListResult {
  items: RequestLogSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequestLogFilterSummary {
  totalCount: number;
  filteredCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface GatewayErrorLog {
  traceId: string;
  keyId?: string;
  accountId?: string;
  requestPath?: string;
  method?: string;
  stage?: string;
  errorKind?: string;
  upstreamUrl?: string;
  cfRay?: string;
  statusCode?: number | null;
  compressionEnabled?: boolean;
  compressionRetryAttempted?: boolean;
  message?: string;
  createdAt?: number | null;
  [key: string]: unknown;
}

export interface GatewayErrorLogListResult {
  items: GatewayErrorLog[];
  total: number;
  page: number;
  pageSize: number;
  stages: string[];
}

export interface ServiceListenConfig {
  mode: string;
  options: string[];
  requiresRestart?: boolean;
}

export interface GatewayRouteStrategySettings {
  strategy: string;
  options: string[];
  manualPreferredAccountId?: string;
}

export interface GatewayUpstreamProxySettings {
  proxyUrl: string;
  envKey?: string;
  requiresRestart?: boolean;
}

export interface GatewayTransportSettings {
  sseKeepaliveIntervalMs: number;
  upstreamStreamTimeoutMs: number;
  upstreamTotalTimeoutMs: number;
  envKeys?: string[];
  requiresRestart?: boolean;
}

export interface BackgroundTaskSettings {
  [key: string]: unknown;
}
