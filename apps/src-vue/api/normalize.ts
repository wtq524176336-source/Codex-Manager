import type {
  AccountListResult,
  AccountSummary,
  AggregateApiSecretResult,
  AggregateApiSummary,
  AggregateApiTestResult,
  ApiKeyCreateResult,
  ApiKeySummary,
  ApiKeyUsageStat,
  GatewayErrorLog,
  GatewayErrorLogListResult,
  GatewayRouteStrategySettings,
  GatewayTransportSettings,
  GatewayUpstreamProxySettings,
  ModelInfo,
  ModelListResult,
  RequestLogFilterSummary,
  RequestLogListResult,
  RequestLogSummary,
  ServiceListenConfig,
} from "@/types/common";

type UnknownRecord = Record<string, unknown>;

export function asObject(payload: unknown): UnknownRecord {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as UnknownRecord)
    : {};
}

export function asArray<T = unknown>(payload: unknown): T[] {
  return Array.isArray(payload) ? payload : [];
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toNumber(value: unknown, fallback = 0): number {
  return toNullableNumber(value) ?? fallback;
}

export function toNullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled", "active"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled", "inactive"].includes(normalized)) return false;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function firstString(source: UnknownRecord, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) return value;
  }
  return fallback;
}

function firstNumber(source: UnknownRecord, keys: string[], fallback: number | null = null) {
  for (const key of keys) {
    const value = toNullableNumber(source[key]);
    if (value !== null) return value;
  }
  return fallback;
}

function normalizeAccount(item: unknown): AccountSummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;
  const usage = asObject(source.usage);
  const label = firstString(source, ["label", "name"], id);
  const status = asString(source.status);
  const statusReason = firstString(source, ["statusReason", "status_reason"]);
  const availabilityStatus = firstString(usage, ["availabilityStatus", "availability_status"]);
  const isAvailable = toNullableBoolean(source.isAvailable ?? source.is_available);
  const unavailableByStatus = [status, statusReason, availabilityStatus].some((value) =>
    ["error", "disabled", "expired", "unavailable", "banned"].includes(value.toLowerCase()),
  );

  return {
    ...source,
    id,
    name: label,
    label,
    group: asString(source.group),
    groupName: firstString(source, ["groupName", "group_name"]),
    priority: toNumber(source.priority, 0),
    sort: toNumber(source.sort, 0),
    preferred: toNullableBoolean(source.preferred) ?? false,
    status,
    statusReason,
    planType:
      firstString(source, ["planType", "plan_type", "subscriptionPlan", "subscription_plan"]) ||
      null,
    planTypeRaw: firstString(source, ["planTypeRaw", "plan_type_raw"]) || null,
    subscriptionPlan: firstString(source, ["subscriptionPlan", "subscription_plan"]) || null,
    subscriptionExpiresAt: firstNumber(source, ["subscriptionExpiresAt", "subscription_expires_at"]),
    subscriptionRenewsAt: firstNumber(source, ["subscriptionRenewsAt", "subscription_renews_at"]),
    currentWindowCostUsd: toNumber(source.currentWindowCostUsd ?? source.current_window_cost_usd, 0),
    primaryWindowCostUsd: toNumber(source.primaryWindowCostUsd ?? source.primary_window_cost_usd, 0),
    secondaryWindowCostUsd: toNumber(
      source.secondaryWindowCostUsd ?? source.secondary_window_cost_usd,
      0,
    ),
    note: firstString(source, ["note"]) || null,
    tags: asStringArray(source.tags),
    isAvailable: isAvailable ?? !unavailableByStatus,
    isLowQuota: toNullableBoolean(source.isLowQuota ?? source.is_low_quota) ?? false,
    availabilityText: firstString(source, ["availabilityText", "availability_text"]) || status,
    availabilityLevel: firstString(source, ["availabilityLevel", "availability_level"]),
    lastRefreshAt: firstNumber(source, ["lastRefreshAt", "last_refresh_at"]),
    usage: {
      accountId: firstString(usage, ["accountId", "account_id"], id),
      availabilityStatus,
      usedPercent: firstNumber(usage, ["usedPercent", "used_percent"]),
      remainPercent: firstNumber(usage, ["remainPercent", "remain_percent"]),
      windowMinutes: firstNumber(usage, ["windowMinutes", "window_minutes"]),
      resetsAt: firstNumber(usage, ["resetsAt", "resets_at"]),
      secondaryUsedPercent: firstNumber(usage, [
        "secondaryUsedPercent",
        "secondary_used_percent",
      ]),
      secondaryRemainPercent: firstNumber(usage, [
        "secondaryRemainPercent",
        "secondary_remain_percent",
      ]),
      secondaryWindowMinutes: firstNumber(usage, [
        "secondaryWindowMinutes",
        "secondary_window_minutes",
      ]),
      secondaryResetsAt: firstNumber(usage, ["secondaryResetsAt", "secondary_resets_at"]),
      capturedAt: firstNumber(usage, ["capturedAt", "captured_at"]),
    },
  };
}

export function normalizeAccountList(payload: unknown): AccountListResult {
  const source = asObject(payload);
  const items = asArray(source.items ?? payload)
    .map((item) => normalizeAccount(item))
    .filter((item): item is AccountSummary => Boolean(item));

  return {
    items,
    total: toNullableNumber(source.total) ?? items.length,
    page: toNullableNumber(source.page) ?? 1,
    pageSize: toNullableNumber(source.pageSize ?? source.page_size) ?? items.length,
  };
}

function normalizeAggregateApi(item: unknown): AggregateApiSummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;

  return {
    ...source,
    id,
    supplierName: firstString(source, ["supplierName", "supplier_name"]) || null,
    providerType: firstString(source, ["providerType", "provider_type"]) || null,
    protocolMode: firstString(source, ["protocolMode", "protocol_mode"]) || null,
    url: asString(source.url),
    authType: firstString(source, ["authType", "auth_type"]) || null,
    authCustomEnabled:
      toNullableBoolean(source.authCustomEnabled ?? source.auth_custom_enabled) ?? null,
    authParams: asObject(source.authParams ?? source.auth_params),
    actionCustomEnabled:
      toNullableBoolean(source.actionCustomEnabled ?? source.action_custom_enabled) ?? null,
    action: asString(source.action) || null,
    modelOverride: firstString(source, ["modelOverride", "model_override"]) || null,
    status: asString(source.status) || "active",
    sort: toNumber(source.sort ?? source.priority, 0),
    createdAt: firstNumber(source, ["createdAt", "created_at"]),
    updatedAt: firstNumber(source, ["updatedAt", "updated_at"]),
    lastTestAt: firstNumber(source, ["lastTestAt", "last_test_at"]),
    lastTestStatus: firstString(source, ["lastTestStatus", "last_test_status"]) || null,
    lastTestError: firstString(source, ["lastTestError", "last_test_error"]) || null,
    estimatedCostUsd: toNumber(source.estimatedCostUsd ?? source.estimated_cost_usd, 0),
  };
}

export function normalizeAggregateApiList(payload: unknown): AggregateApiSummary[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload)
    .map((item) => normalizeAggregateApi(item))
    .filter((item): item is AggregateApiSummary => Boolean(item));
}

export function normalizeAggregateApiSecret(payload: unknown): AggregateApiSecretResult {
  const source = asObject(payload);
  return {
    id: asString(source.id),
    key: asString(source.key),
    authType: firstString(source, ["authType", "auth_type"]) || null,
    username: asString(source.username) || null,
    password: asString(source.password) || null,
  };
}

export function normalizeAggregateApiTest(payload: unknown): AggregateApiTestResult {
  const source = asObject(payload);
  return {
    id: asString(source.id),
    ok: toNullableBoolean(source.ok) ?? false,
    statusCode: firstNumber(source, ["statusCode", "status_code"]),
    message: asString(source.message) || null,
    testedAt: firstNumber(source, ["testedAt", "tested_at"]),
    latencyMs: firstNumber(source, ["latencyMs", "latency_ms"]),
  };
}

function normalizeApiKey(item: unknown): ApiKeySummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;

  return {
    ...source,
    id,
    name: asString(source.name) || null,
    keyPreview: firstString(source, ["keyPreview", "key_preview"]) || null,
    status: asString(source.status) || "enabled",
    rotationStrategy: firstString(source, ["rotationStrategy", "rotation_strategy"]) || null,
    model: firstString(source, ["model", "modelSlug", "model_slug"]) || null,
    modelSlug: firstString(source, ["modelSlug", "model_slug"]) || null,
    reasoningEffort: firstString(source, ["reasoningEffort", "reasoning_effort"]) || null,
    serviceTier: firstString(source, ["serviceTier", "service_tier"]) || null,
    aggregateApiId: firstString(source, ["aggregateApiId", "aggregate_api_id"]) || null,
    accountPlanFilter: firstString(source, ["accountPlanFilter", "account_plan_filter"]) || null,
    protocol: asString(source.protocol) || null,
    clientType: firstString(source, ["clientType", "client_type"]) || null,
    authScheme: firstString(source, ["authScheme", "auth_scheme"]) || null,
    upstreamBaseUrl: firstString(source, ["upstreamBaseUrl", "upstream_base_url"]) || null,
    staticHeadersJson: firstString(source, ["staticHeadersJson", "static_headers_json"]) || null,
    createdAt: firstNumber(source, ["createdAt", "created_at"]),
    lastUsedAt: firstNumber(source, ["lastUsedAt", "last_used_at"]),
    totalTokens: toNumber(source.totalTokens ?? source.total_tokens, 0),
    estimatedCostUsd: toNumber(source.estimatedCostUsd ?? source.estimated_cost_usd, 0),
  };
}

export function normalizeApiKeyList(payload: unknown): ApiKeySummary[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload)
    .map((item) => normalizeApiKey(item))
    .filter((item): item is ApiKeySummary => Boolean(item));
}

export function normalizeApiKeyCreateResult(payload: unknown): ApiKeyCreateResult {
  const source = asObject(payload);
  return {
    id: asString(source.id),
    key: asString(source.key),
  };
}

export function normalizeApiKeyUsageStats(payload: unknown): ApiKeyUsageStat[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload).map((item) => {
    const row = asObject(item);
    return {
      keyId: firstString(row, ["keyId", "key_id"]),
      totalTokens: toNumber(row.totalTokens ?? row.total_tokens, 0),
      estimatedCostUsd: toNumber(row.estimatedCostUsd ?? row.estimated_cost_usd, 0),
    };
  });
}

function normalizeModel(item: unknown): ModelInfo | null {
  const source = asObject(item);
  const slug = asString(source.slug);
  if (!slug) return null;
  const updatedAtNumber = firstNumber(source, ["updatedAt", "updated_at"]);
  const updatedAtText = firstString(source, ["updatedAt", "updated_at"]);

  return {
    ...source,
    slug,
    displayName: firstString(source, ["displayName", "display_name", "name"], slug),
    name: asString(source.name) || null,
    description: asString(source.description) || null,
    defaultReasoningLevel:
      firstString(source, ["defaultReasoningLevel", "default_reasoning_level"]) || null,
    supportedReasoningLevels: asArray<Record<string, unknown>>(
      source.supportedReasoningLevels ?? source.supported_reasoning_levels,
    ),
    source: asString(source.source) || null,
    sourceKind: firstString(source, ["sourceKind", "source_kind"]) || null,
    visibility: asString(source.visibility) || null,
    supportedInApi:
      toNullableBoolean(source.supportedInApi ?? source.supported_in_api) ?? false,
    priority: toNumber(source.priority, 0),
    userEdited: toNullableBoolean(source.userEdited ?? source.user_edited) ?? false,
    sortIndex: toNumber(source.sortIndex ?? source.sort_index, 0),
    updatedAt: updatedAtNumber ?? (updatedAtText || null),
    contextWindow: firstNumber(source, ["contextWindow", "context_window"]),
    availableInPlans: asStringArray(source.availableInPlans ?? source.available_in_plans),
    inputModalities: asStringArray(source.inputModalities ?? source.input_modalities),
  };
}

export function normalizeModelListResult(payload: unknown): ModelListResult {
  const source = asObject(payload);
  const items = asArray(source.items ?? source.models ?? payload)
    .map((item) => normalizeModel(item))
    .filter((item): item is ModelInfo => Boolean(item));
  return { items };
}

export function normalizeModelList(payload: unknown): ModelInfo[] {
  return normalizeModelListResult(payload).items;
}

function normalizeRequestLog(item: unknown): RequestLogSummary | null {
  const source = asObject(item);
  const traceId = firstString(source, ["traceId", "trace_id"]);
  const requestPath = firstString(source, ["requestPath", "request_path", "path"]);
  const method = asString(source.method);
  const createdAt = firstNumber(source, ["createdAt", "created_at"]);
  const id = firstString(source, ["id"]) || traceId || [createdAt ?? "", method, requestPath].join("|");
  if (!id) return null;

  return {
    ...source,
    id,
    traceId,
    keyId: firstString(source, ["keyId", "key_id"]) || null,
    requestPath,
    originalPath: firstString(source, ["originalPath", "original_path"]),
    adaptedPath: firstString(source, ["adaptedPath", "adapted_path"]),
    path: requestPath,
    method,
    requestType: firstString(source, ["requestType", "request_type"]),
    reasoningEffort: firstString(source, ["reasoningEffort", "reasoning_effort"]) || null,
    serviceTier: firstString(source, ["serviceTier", "service_tier"]) || null,
    effectiveServiceTier:
      firstString(source, ["effectiveServiceTier", "effective_service_tier"]) || null,
    statusCode: firstNumber(source, ["statusCode", "status_code"]),
    accountId: firstString(source, ["accountId", "account_id"]) || null,
    initialAccountId: firstString(source, ["initialAccountId", "initial_account_id"]) || null,
    attemptedAccountIds: asStringArray(
      source.attemptedAccountIds ?? source.attempted_account_ids,
    ),
    initialAggregateApiId:
      firstString(source, ["initialAggregateApiId", "initial_aggregate_api_id"]) || null,
    attemptedAggregateApiIds: asStringArray(
      source.attemptedAggregateApiIds ?? source.attempted_aggregate_api_ids,
    ),
    upstreamUrl: firstString(source, ["upstreamUrl", "upstream_url"]) || null,
    aggregateApiSupplierName:
      firstString(source, ["aggregateApiSupplierName", "aggregate_api_supplier_name"]) || null,
    aggregateApiUrl: firstString(source, ["aggregateApiUrl", "aggregate_api_url"]) || null,
    model: asString(source.model) || null,
    inputTokens: firstNumber(source, ["inputTokens", "input_tokens"]),
    cachedInputTokens: firstNumber(source, ["cachedInputTokens", "cached_input_tokens"]),
    outputTokens: firstNumber(source, ["outputTokens", "output_tokens"]),
    totalTokens: firstNumber(source, ["totalTokens", "total_tokens"]),
    reasoningOutputTokens: firstNumber(source, [
      "reasoningOutputTokens",
      "reasoning_output_tokens",
    ]),
    estimatedCostUsd: firstNumber(source, ["estimatedCostUsd", "estimated_cost_usd"]),
    durationMs: firstNumber(source, [
      "durationMs",
      "duration_ms",
      "latencyMs",
      "latency_ms",
      "elapsedMs",
      "elapsed_ms",
    ]),
    firstResponseMs: firstNumber(source, ["firstResponseMs", "first_response_ms"]),
    error: asString(source.error) || null,
    createdAt,
  };
}

export function normalizeRequestLogListResult(payload: unknown): RequestLogListResult {
  const source = asObject(payload);
  const items = asArray(source.items ?? payload)
    .map((item) => normalizeRequestLog(item))
    .filter((item): item is RequestLogSummary => Boolean(item));
  return {
    items,
    total: toNullableNumber(source.total) ?? items.length,
    page: toNullableNumber(source.page) ?? 1,
    pageSize: toNullableNumber(source.pageSize ?? source.page_size) ?? items.length,
  };
}

export function normalizeRequestLogList(payload: unknown): RequestLogSummary[] {
  return normalizeRequestLogListResult(payload).items;
}

export function normalizeRequestLogSummary(payload: unknown): RequestLogFilterSummary {
  const source = asObject(payload);
  return {
    totalCount: toNumber(source.totalCount ?? source.total_count, 0),
    filteredCount: toNumber(source.filteredCount ?? source.filtered_count, 0),
    successCount: toNumber(source.successCount ?? source.success_count, 0),
    errorCount: toNumber(source.errorCount ?? source.error_count, 0),
    totalTokens: toNumber(source.totalTokens ?? source.total_tokens, 0),
    totalCostUsd: toNumber(source.totalCostUsd ?? source.total_cost_usd, 0),
  };
}

function normalizeGatewayErrorLog(item: unknown): GatewayErrorLog {
  const source = asObject(item);
  return {
    ...source,
    traceId: firstString(source, ["traceId", "trace_id"]),
    keyId: firstString(source, ["keyId", "key_id"]),
    accountId: firstString(source, ["accountId", "account_id"]),
    requestPath: firstString(source, ["requestPath", "request_path"]),
    method: asString(source.method),
    stage: asString(source.stage),
    errorKind: firstString(source, ["errorKind", "error_kind"]),
    upstreamUrl: firstString(source, ["upstreamUrl", "upstream_url"]),
    cfRay: firstString(source, ["cfRay", "cf_ray"]),
    statusCode: firstNumber(source, ["statusCode", "status_code"]),
    compressionEnabled:
      toNullableBoolean(source.compressionEnabled ?? source.compression_enabled) ?? false,
    compressionRetryAttempted:
      toNullableBoolean(
        source.compressionRetryAttempted ?? source.compression_retry_attempted,
      ) ?? false,
    message: asString(source.message),
    createdAt: firstNumber(source, ["createdAt", "created_at"]),
  };
}

export function normalizeGatewayErrorLogList(payload: unknown): GatewayErrorLogListResult {
  const source = asObject(payload);
  const items = asArray(source.items ?? payload).map(normalizeGatewayErrorLog);
  return {
    items,
    total: toNullableNumber(source.total) ?? items.length,
    page: toNullableNumber(source.page) ?? 1,
    pageSize: toNullableNumber(source.pageSize ?? source.page_size) ?? items.length,
    stages: asStringArray(source.stages),
  };
}

export function normalizeServiceListenConfig(payload: unknown): ServiceListenConfig {
  const source = asObject(payload);
  return {
    mode: asString(source.mode) || "loopback",
    options: asStringArray(source.options).length ? asStringArray(source.options) : ["loopback", "all_interfaces"],
    requiresRestart: toNullableBoolean(source.requiresRestart ?? source.requires_restart) ?? true,
  };
}

export function normalizeGatewayRouteStrategy(payload: unknown): GatewayRouteStrategySettings {
  const source = asObject(payload);
  return {
    strategy: asString(source.strategy) || "ordered",
    options: asStringArray(source.options).length ? asStringArray(source.options) : ["ordered", "balanced"],
    manualPreferredAccountId:
      firstString(source, ["manualPreferredAccountId", "manual_preferred_account_id"]) || "",
  };
}

export function normalizeGatewayUpstreamProxy(payload: unknown): GatewayUpstreamProxySettings {
  const source = asObject(payload);
  return {
    proxyUrl: firstString(source, ["proxyUrl", "proxy_url"]),
    envKey: firstString(source, ["envKey", "env_key"]),
    requiresRestart: toNullableBoolean(source.requiresRestart ?? source.requires_restart) ?? false,
  };
}

export function normalizeGatewayTransport(payload: unknown): GatewayTransportSettings {
  const source = asObject(payload);
  return {
    sseKeepaliveIntervalMs: toNumber(
      source.sseKeepaliveIntervalMs ?? source.sse_keepalive_interval_ms,
      15000,
    ),
    upstreamStreamTimeoutMs: toNumber(
      source.upstreamStreamTimeoutMs ?? source.upstream_stream_timeout_ms,
      300000,
    ),
    upstreamTotalTimeoutMs: toNumber(
      source.upstreamTotalTimeoutMs ?? source.upstream_total_timeout_ms,
      0,
    ),
    envKeys: asStringArray(source.envKeys ?? source.env_keys),
    requiresRestart: toNullableBoolean(source.requiresRestart ?? source.requires_restart) ?? false,
  };
}
