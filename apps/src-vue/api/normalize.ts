import type {
  AccountListResult,
  AccountSummary,
  AggregateApiSummary,
  ApiKeySummary,
  ModelInfo,
  RequestLogSummary,
} from "@/types/common";

function asObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function asArray<T = unknown>(payload: unknown): T[] {
  return Array.isArray(payload) ? payload : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNullableBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function normalizeAccount(item: unknown): AccountSummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;
  const label = asString(source.label ?? source.name) || id;
  const usage = asObject(source.usage);
  const status = asString(source.status);
  const statusReason = asString(source.statusReason ?? source.status_reason);
  const availabilityStatus = asString(usage.availabilityStatus ?? usage.availability_status);
  const isUnavailable = [status, statusReason, availabilityStatus].some((value) =>
    ["error", "disabled", "expired", "unavailable"].includes(value.toLowerCase()),
  );

  return {
    id,
    name: label,
    label,
    status,
    planType:
      asString(source.planType ?? source.plan_type ?? source.subscriptionPlan ?? source.subscription_plan) ||
      null,
    isAvailable: !isUnavailable,
    usage: {
      usedPercent: toNullableNumber(usage.usedPercent ?? usage.used_percent),
      remainPercent: toNullableNumber(usage.remainPercent ?? usage.remain_percent),
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
  };
}

function normalizeAggregateApi(item: unknown): AggregateApiSummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;

  return {
    id,
    supplierName: asString(source.supplierName ?? source.supplier_name) || null,
    providerType: asString(source.providerType ?? source.provider_type) || null,
    protocolMode: asString(source.protocolMode ?? source.protocol_mode) || null,
    url: asString(source.url),
    status: asString(source.status) || "active",
    sort: toNullableNumber(source.sort ?? source.priority) ?? 0,
    lastTestStatus: asString(source.lastTestStatus ?? source.last_test_status) || null,
  };
}

export function normalizeAggregateApiList(payload: unknown): AggregateApiSummary[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload)
    .map((item) => normalizeAggregateApi(item))
    .filter((item): item is AggregateApiSummary => Boolean(item));
}

function normalizeApiKey(item: unknown): ApiKeySummary | null {
  const source = asObject(item);
  const id = asString(source.id);
  if (!id) return null;

  return {
    id,
    name: asString(source.name) || null,
    keyPreview: asString(source.keyPreview ?? source.key_preview) || null,
    status: asString(source.status) || "enabled",
    rotationStrategy: asString(source.rotationStrategy ?? source.rotation_strategy) || null,
    model: asString(source.model ?? source.modelSlug ?? source.model_slug) || null,
  };
}

export function normalizeApiKeyList(payload: unknown): ApiKeySummary[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload)
    .map((item) => normalizeApiKey(item))
    .filter((item): item is ApiKeySummary => Boolean(item));
}

function normalizeModel(item: unknown): ModelInfo | null {
  const source = asObject(item);
  const slug = asString(source.slug);
  if (!slug) return null;
  const updatedAtNumber = toNullableNumber(source.updatedAt ?? source.updated_at);
  const updatedAtText = asString(source.updatedAt ?? source.updated_at);

  return {
    slug,
    displayName: asString(source.displayName ?? source.display_name) || null,
    name: asString(source.name) || null,
    source: asString(source.source) || null,
    sourceKind: asString(source.sourceKind ?? source.source_kind) || null,
    visibility: asString(source.visibility) || null,
    supportedInApi: toNullableBoolean(source.supportedInApi ?? source.supported_in_api),
    updatedAt: updatedAtNumber ?? (updatedAtText || null),
  };
}

export function normalizeModelList(payload: unknown): ModelInfo[] {
  const source = asObject(payload);
  return asArray(source.items ?? source.models ?? payload)
    .map((item) => normalizeModel(item))
    .filter((item): item is ModelInfo => Boolean(item));
}

function normalizeRequestLog(item: unknown): RequestLogSummary | null {
  const source = asObject(item);
  const traceId = asString(source.traceId ?? source.trace_id);
  const requestPath = asString(source.requestPath ?? source.request_path);
  const method = asString(source.method);
  const createdAt = toNullableNumber(source.createdAt ?? source.created_at);
  const id = traceId || [createdAt ?? "", method, requestPath].join("|");
  if (!id) return null;

  return {
    id,
    traceId,
    requestPath,
    path: requestPath,
    method,
    statusCode: toNullableNumber(source.statusCode ?? source.status_code),
    accountId: asString(source.accountId ?? source.account_id) || null,
    upstreamUrl: asString(source.upstreamUrl ?? source.upstream_url) || null,
    aggregateApiSupplierName:
      asString(source.aggregateApiSupplierName ?? source.aggregate_api_supplier_name) || null,
    model: asString(source.model) || null,
    totalTokens: toNullableNumber(source.totalTokens ?? source.total_tokens),
    durationMs: toNullableNumber(
      source.durationMs ??
        source.duration_ms ??
        source.latencyMs ??
        source.latency_ms ??
        source.elapsedMs ??
        source.elapsed_ms,
    ),
    createdAt,
  };
}

export function normalizeRequestLogList(payload: unknown): RequestLogSummary[] {
  const source = asObject(payload);
  return asArray(source.items ?? payload)
    .map((item) => normalizeRequestLog(item))
    .filter((item): item is RequestLogSummary => Boolean(item));
}
