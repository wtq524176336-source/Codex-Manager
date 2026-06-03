import type {
  AccountListResult,
  AccountSummary,
  AccountUsage,
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

function remainingPercent(value: number | null | undefined): number | null {
  const parsed = toNullableNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.min(100, Math.round(100 - parsed)));
}

function hasSecondarySignal(usage?: AccountUsage | null): boolean {
  return (
    toNullableNumber(usage?.secondaryUsedPercent) != null ||
    toNullableNumber(usage?.secondaryWindowMinutes) != null
  );
}

function isLongWindow(windowMinutes: number | null | undefined): boolean {
  const parsed = toNullableNumber(windowMinutes);
  return parsed != null && parsed > 24 * 60 + 3;
}

function parseJsonObject(raw: string | null | undefined): UnknownRecord | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return asObject(parsed);
  } catch {
    return null;
  }
}

function extractPlanTypeRecursive(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractPlanTypeRecursive(item);
      if (nested) return nested;
    }
    return null;
  }
  const source = asObject(value);
  if (!Object.keys(source).length) return null;
  for (const key of [
    "plan_type",
    "planType",
    "subscription_tier",
    "subscriptionTier",
    "tier",
    "account_type",
    "accountType",
    "type",
  ]) {
    const text = asString(source[key]).toLowerCase();
    if (text) return text;
  }
  for (const nested of Object.values(source)) {
    const result = extractPlanTypeRecursive(nested);
    if (result) return result;
  }
  return null;
}

function isFreePlanUsage(raw: string | null | undefined): boolean {
  const planType = extractPlanTypeRecursive(parseJsonObject(raw));
  return Boolean(planType && planType.includes("free"));
}

function getUsageDisplayBuckets(usage?: AccountUsage | null) {
  const hasPrimarySignal =
    toNullableNumber(usage?.usedPercent) != null || toNullableNumber(usage?.windowMinutes) != null;
  const secondarySignal = hasSecondarySignal(usage);
  const secondaryOnly =
    hasPrimarySignal &&
    !secondarySignal &&
    (isLongWindow(usage?.windowMinutes) || isFreePlanUsage(usage?.creditsJson));

  if (secondaryOnly) {
    return {
      primaryRemainPercent: null,
      primaryResetsAt: null,
      secondaryRemainPercent: remainingPercent(usage?.usedPercent),
      secondaryResetsAt: toNullableNumber(usage?.resetsAt),
    };
  }
  return {
    primaryRemainPercent: remainingPercent(usage?.usedPercent),
    primaryResetsAt: toNullableNumber(usage?.resetsAt),
    secondaryRemainPercent: remainingPercent(usage?.secondaryUsedPercent),
    secondaryResetsAt: toNullableNumber(usage?.secondaryResetsAt),
  };
}

function normalizedAccountStatus(account?: { status?: string | null } | null): string {
  return String(account?.status || "").trim().toLowerCase();
}

function normalizedAccountStatusReason(account?: { statusReason?: string | null } | null): string {
  return String(account?.statusReason || "").trim().toLowerCase();
}

function isLimitedStatus(account?: { status?: string | null } | null): boolean {
  return normalizedAccountStatus(account) === "limited";
}

function isBannedStatus(account?: { status?: string | null; statusReason?: string | null } | null): boolean {
  const status = normalizedAccountStatus(account);
  if (status !== "banned" && status !== "unavailable") return false;
  const reason = normalizedAccountStatusReason(account);
  return (
    status === "banned" ||
    reason === "account_deactivated" ||
    reason === "workspace_deactivated" ||
    reason === "deactivated_workspace"
  );
}

function calcAvailability(
  usage: AccountUsage | null | undefined,
  account: { status?: string | null; statusReason?: string | null },
) {
  const primaryExhausted = (usage?.usedPercent ?? 0) >= 100;
  const secondaryExhausted = (usage?.secondaryUsedPercent ?? 0) >= 100;
  if (isBannedStatus(account)) return { text: "封禁", level: "bad" };
  if (isLimitedStatus(account)) return { text: "限流", level: "bad" };
  if (normalizedAccountStatus(account) === "unavailable") return { text: "不可用", level: "bad" };
  if (!usage) return { text: "正常", level: "ok" };

  const availabilityStatus = String(usage.availabilityStatus || "").trim().toLowerCase();
  const hasPrimarySignal =
    toNullableNumber(usage.usedPercent) != null || toNullableNumber(usage.windowMinutes) != null;
  const secondarySignal = hasSecondarySignal(usage);
  const secondaryOnly =
    hasPrimarySignal &&
    !secondarySignal &&
    (isLongWindow(usage.windowMinutes) || isFreePlanUsage(usage.creditsJson));

  if (availabilityStatus === "available") return { text: "可用", level: "ok" };
  if (availabilityStatus === "primary_window_available_only") {
    return { text: secondaryOnly ? "仅7天额度" : "7天窗口未提供", level: "ok" };
  }
  if (availabilityStatus === "unavailable") {
    return primaryExhausted || secondaryExhausted
      ? { text: "限流", level: "bad" }
      : { text: "不可用", level: "bad" };
  }
  if (availabilityStatus === "unknown") return { text: "未知", level: "unknown" };

  const primaryMissing =
    toNullableNumber(usage.usedPercent) == null || toNullableNumber(usage.windowMinutes) == null;
  const secondaryMissing =
    toNullableNumber(usage.secondaryUsedPercent) == null ||
    toNullableNumber(usage.secondaryWindowMinutes) == null;
  if (primaryMissing) return { text: "用量缺失", level: "bad" };
  if (primaryExhausted) return { text: "限流", level: "bad" };
  if (!secondarySignal) return { text: secondaryOnly ? "仅7天额度" : "7天窗口未提供", level: "ok" };
  if (secondaryMissing) return { text: "用量缺失", level: "bad" };
  if (secondaryExhausted) return { text: "限流", level: "bad" };
  return { text: "可用", level: "ok" };
}

function isLowQuotaUsage(usage?: AccountUsage | null): boolean {
  const buckets = getUsageDisplayBuckets(usage);
  const primaryRemain = buckets.primaryRemainPercent;
  const secondaryRemain = buckets.secondaryRemainPercent;
  return (
    (primaryRemain != null && primaryRemain > 0 && primaryRemain <= 20) ||
    (secondaryRemain != null && secondaryRemain > 0 && secondaryRemain <= 20)
  );
}

function canParticipateInRouting(level: string): boolean {
  return level !== "warn" && level !== "bad";
}

export function normalizeUsageSnapshot(payload: unknown): AccountUsage | null {
  const source = asObject(payload);
  const accountId = firstString(source, ["accountId", "account_id"]);
  if (!accountId) return null;
  return {
    accountId,
    availabilityStatus: firstString(source, ["availabilityStatus", "availability_status"]) || null,
    usedPercent: firstNumber(source, ["usedPercent", "used_percent"]),
    windowMinutes: firstNumber(source, ["windowMinutes", "window_minutes"]),
    resetsAt: firstNumber(source, ["resetsAt", "resets_at"]),
    secondaryUsedPercent: firstNumber(source, [
      "secondaryUsedPercent",
      "secondary_used_percent",
    ]),
    secondaryWindowMinutes: firstNumber(source, [
      "secondaryWindowMinutes",
      "secondary_window_minutes",
    ]),
    secondaryResetsAt: firstNumber(source, ["secondaryResetsAt", "secondary_resets_at"]),
    creditsJson: firstString(source, ["creditsJson", "credits_json"]) || null,
    capturedAt: firstNumber(source, ["capturedAt", "captured_at"]),
  };
}

export function normalizeUsageList(payload: unknown): AccountUsage[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload)
    .map((item) => normalizeUsageSnapshot(item))
    .filter((item): item is AccountUsage => Boolean(item));
}

function buildUsageMap(usages: AccountUsage[]): Map<string, AccountUsage> {
  return new Map(usages.map((item) => [item.accountId, item]));
}

function normalizeAccount(item: unknown, usage?: AccountUsage | null): AccountSummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;
  const label = firstString(source, ["label", "name"], id);
  const status = asString(source.status);
  const statusReason = firstString(source, ["statusReason", "status_reason"]);
  const usageFromSource = normalizeUsageSnapshot(source.usage) || usage || null;
  const availability = calcAvailability(usageFromSource, { status, statusReason });
  const usageBuckets = getUsageDisplayBuckets(usageFromSource);
  const hasSubscription =
    toNullableBoolean(source.hasSubscription ?? source.has_subscription) ?? null;
  const subscriptionExpiresAt = firstNumber(source, [
    "subscriptionExpiresAt",
    "subscription_expires_at",
  ]);
  const isSubscriptionExpired =
    subscriptionExpiresAt != null && subscriptionExpiresAt <= Math.floor(Date.now() / 1000);
  const isSubscriptionInactive = hasSubscription === false || isSubscriptionExpired;
  const rawPlanType =
    firstString(source, ["planType", "plan_type", "subscriptionPlan", "subscription_plan"]) || null;

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
    planType: isSubscriptionInactive ? "free" : rawPlanType,
    planTypeRaw: firstString(source, ["planTypeRaw", "plan_type_raw"]) || null,
    hasSubscription: isSubscriptionInactive ? false : hasSubscription,
    subscriptionPlan: isSubscriptionInactive
      ? null
      : firstString(source, ["subscriptionPlan", "subscription_plan"]) || null,
    subscriptionExpiresAt,
    subscriptionRenewsAt: isSubscriptionInactive
      ? null
      : firstNumber(source, ["subscriptionRenewsAt", "subscription_renews_at"]),
    currentWindowCostUsd: toNumber(source.currentWindowCostUsd ?? source.current_window_cost_usd, 0),
    currentWindowStartedAt: firstNumber(source, [
      "currentWindowStartedAt",
      "current_window_started_at",
    ]),
    currentWindowResetsAt: firstNumber(source, [
      "currentWindowResetsAt",
      "current_window_resets_at",
    ]),
    primaryWindowCostUsd: toNumber(source.primaryWindowCostUsd ?? source.primary_window_cost_usd, 0),
    primaryWindowStartedAt: firstNumber(source, [
      "primaryWindowStartedAt",
      "primary_window_started_at",
    ]),
    primaryWindowResetsAt: firstNumber(source, [
      "primaryWindowResetsAt",
      "primary_window_resets_at",
    ]),
    secondaryWindowCostUsd: toNumber(
      source.secondaryWindowCostUsd ?? source.secondary_window_cost_usd,
      0,
    ),
    secondaryWindowStartedAt: firstNumber(source, [
      "secondaryWindowStartedAt",
      "secondary_window_started_at",
    ]),
    secondaryWindowResetsAt: firstNumber(source, [
      "secondaryWindowResetsAt",
      "secondary_window_resets_at",
    ]),
    note: firstString(source, ["note"]) || null,
    tags: asStringArray(source.tags),
    isAvailable: canParticipateInRouting(availability.level),
    isLowQuota: isLowQuotaUsage(usageFromSource),
    availabilityText: availability.text,
    availabilityLevel: availability.level,
    primaryRemainPercent: usageBuckets.primaryRemainPercent,
    secondaryRemainPercent: usageBuckets.secondaryRemainPercent,
    lastRefreshAt: usageFromSource?.capturedAt ?? firstNumber(source, ["lastRefreshAt", "last_refresh_at"]),
    usage: usageFromSource,
  };
}

export function normalizeAccountList(payload: unknown, usages: AccountUsage[] = []): AccountListResult {
  const source = asObject(payload);
  const usageMap = buildUsageMap(usages);
  const items = asArray(source.items ?? payload)
    .map((item) => normalizeAccount(item, usageMap.get(asString(asObject(item).id))))
    .filter((item): item is AccountSummary => Boolean(item));

  return {
    items,
    total: toNullableNumber(source.total) ?? items.length,
    page: toNullableNumber(source.page) ?? 1,
    pageSize: toNullableNumber(source.pageSize ?? source.page_size) ?? items.length,
  };
}

export function attachUsagesToAccounts(
  accounts: AccountSummary[],
  usages: AccountUsage[],
): AccountSummary[] {
  const usageMap = buildUsageMap(usages);
  return accounts.map((account) => normalizeAccount(account, usageMap.get(account.id)) || account);
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
