import { asObject, asString, normalizeModelList } from "@/api/normalize";
import { invoke, isDesktopRuntime, withAddr } from "@/api/transport";
import type { ModelInfo } from "@/types/common";

export async function listModels(refreshRemote = false) {
  const result = await invoke<unknown>(
    "service_model_catalog_list",
    withAddr({ refreshRemote }),
  );
  return normalizeModelList(result);
}

function serializeModel(model: ModelInfo) {
  return {
    ...model,
    slug: model.slug,
    displayName: model.displayName || model.name || model.slug,
    description: model.description || null,
    defaultReasoningLevel: model.defaultReasoningLevel || null,
    supportedReasoningLevels: Array.isArray(model.supportedReasoningLevels)
      ? model.supportedReasoningLevels
      : [],
    sourceKind: model.sourceKind || "custom",
    visibility: model.visibility || "list",
    supportedInApi: model.supportedInApi !== false,
    priority: typeof model.priority === "number" ? model.priority : 0,
  };
}

export function saveModel(model: ModelInfo, previousSlug?: string | null) {
  return invoke(
    "service_model_catalog_save",
    withAddr({
      payload: {
        previousSlug: previousSlug || null,
        userEdited: typeof model.userEdited === "boolean" ? model.userEdited : true,
        sortIndex: typeof model.sortIndex === "number" ? model.sortIndex : 0,
        ...serializeModel(model),
      },
    }),
  );
}

export function deleteModel(slug: string) {
  return invoke("service_model_catalog_delete", withAddr({ slug }));
}

export interface CodexModelsCacheSyncResult {
  cachePath: string;
  clientVersion: string;
  modelsCount: number;
  mode: "desktop" | "browser";
}

const knownModelFieldKeys = new Set([
  "slug",
  "displayName",
  "display_name",
  "name",
  "description",
  "defaultReasoningLevel",
  "default_reasoning_level",
  "supportedReasoningLevels",
  "supported_reasoning_levels",
  "shellType",
  "shell_type",
  "visibility",
  "supportedInApi",
  "supported_in_api",
  "priority",
  "additionalSpeedTiers",
  "additional_speed_tiers",
  "availabilityNux",
  "availability_nux",
  "upgrade",
  "baseInstructions",
  "base_instructions",
  "modelMessages",
  "model_messages",
  "supportsReasoningSummaries",
  "supports_reasoning_summaries",
  "defaultReasoningSummary",
  "default_reasoning_summary",
  "supportVerbosity",
  "support_verbosity",
  "defaultVerbosity",
  "default_verbosity",
  "applyPatchToolType",
  "apply_patch_tool_type",
  "webSearchToolType",
  "web_search_tool_type",
  "truncationPolicy",
  "truncation_policy",
  "supportsParallelToolCalls",
  "supports_parallel_tool_calls",
  "supportsImageDetailOriginal",
  "supports_image_detail_original",
  "contextWindow",
  "context_window",
  "autoCompactTokenLimit",
  "auto_compact_token_limit",
  "effectiveContextWindowPercent",
  "effective_context_window_percent",
  "experimentalSupportedTools",
  "experimental_supported_tools",
  "inputModalities",
  "input_modalities",
  "minimalClientVersion",
  "minimal_client_version",
  "supportsSearchTool",
  "supports_search_tool",
  "availableInPlans",
  "available_in_plans",
  "sourceKind",
  "source_kind",
  "userEdited",
  "user_edited",
  "sortIndex",
  "sort_index",
  "updatedAt",
  "updated_at",
]);

function nullableString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function booleanField(model: ModelInfo, camelKey: string, snakeKey: string, fallback = false) {
  const value = model[camelKey] ?? model[snakeKey];
  return typeof value === "boolean" ? value : fallback;
}

function numberField(model: ModelInfo, camelKey: string, snakeKey: string, fallback = 0) {
  const value = model[camelKey] ?? model[snakeKey];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayField(model: ModelInfo, camelKey: string, snakeKey: string): unknown[] {
  const value = model[camelKey] ?? model[snakeKey];
  return Array.isArray(value) ? value : [];
}

function objectField(model: ModelInfo, camelKey: string, snakeKey: string, fallback: Record<string, unknown>) {
  const value = model[camelKey] ?? model[snakeKey];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fallback;
}

function extraModelFields(model: ModelInfo) {
  return Object.fromEntries(
    Object.entries(model).filter(([key]) => !knownModelFieldKeys.has(key)),
  );
}

function serializeReasoningLevels(model: ModelInfo) {
  return arrayField(model, "supportedReasoningLevels", "supported_reasoning_levels").map((item) => {
    const source = asObject(item);
    return {
      ...source,
      effort: asString(source.effort ?? source.level),
      description: asString(source.description),
    };
  });
}

function serializeModelForCodexCache(model: ModelInfo) {
  const slug = String(model.slug || "").trim();
  const displayName = String(model.displayName || model.name || slug).trim() || slug;
  const serialized = {
    ...extraModelFields(model),
    slug,
    display_name: displayName,
    description: nullableString(model.description),
    default_reasoning_level: nullableString(model.defaultReasoningLevel ?? model.default_reasoning_level),
    supported_reasoning_levels: serializeReasoningLevels(model),
    shell_type: nullableString(model.shellType ?? model.shell_type) || "shell_command",
    visibility: nullableString(model.visibility) || "list",
    supported_in_api: model.supportedInApi !== false,
    priority: typeof model.priority === "number" && Number.isFinite(model.priority) ? model.priority : 0,
    additional_speed_tiers: arrayField(model, "additionalSpeedTiers", "additional_speed_tiers"),
    availability_nux: model.availabilityNux ?? model.availability_nux,
    upgrade: model.upgrade,
    base_instructions: String(model.baseInstructions ?? model.base_instructions ?? ""),
    model_messages: model.modelMessages ?? model.model_messages,
    supports_reasoning_summaries: booleanField(
      model,
      "supportsReasoningSummaries",
      "supports_reasoning_summaries",
    ),
    default_reasoning_summary:
      nullableString(model.defaultReasoningSummary ?? model.default_reasoning_summary) || "auto",
    support_verbosity: booleanField(model, "supportVerbosity", "support_verbosity"),
    default_verbosity: model.defaultVerbosity ?? model.default_verbosity,
    apply_patch_tool_type: nullableString(model.applyPatchToolType ?? model.apply_patch_tool_type),
    web_search_tool_type: nullableString(model.webSearchToolType ?? model.web_search_tool_type) || "text",
    truncation_policy: objectField(model, "truncationPolicy", "truncation_policy", {
      mode: "tokens",
      limit: 10000,
    }),
    supports_parallel_tool_calls: booleanField(
      model,
      "supportsParallelToolCalls",
      "supports_parallel_tool_calls",
    ),
    supports_image_detail_original: booleanField(
      model,
      "supportsImageDetailOriginal",
      "supports_image_detail_original",
    ),
    context_window: model.contextWindow ?? model.context_window,
    auto_compact_token_limit: model.autoCompactTokenLimit ?? model.auto_compact_token_limit,
    effective_context_window_percent: numberField(
      model,
      "effectiveContextWindowPercent",
      "effective_context_window_percent",
      95,
    ),
    experimental_supported_tools: arrayField(
      model,
      "experimentalSupportedTools",
      "experimental_supported_tools",
    ),
    input_modalities: arrayField(model, "inputModalities", "input_modalities").length
      ? arrayField(model, "inputModalities", "input_modalities")
      : ["text", "image"],
    minimal_client_version: model.minimalClientVersion ?? model.minimal_client_version,
    supports_search_tool: booleanField(model, "supportsSearchTool", "supports_search_tool"),
    available_in_plans: arrayField(model, "availableInPlans", "available_in_plans"),
  };

  return Object.fromEntries(
    Object.entries(serialized).filter(([, value]) => value !== null && value !== undefined),
  );
}

function modelSortIndex(model: ModelInfo) {
  return typeof model.sortIndex === "number" ? model.sortIndex : Number.MAX_SAFE_INTEGER;
}

function serializeModelsForCodexCache(models: ModelInfo[]) {
  return [...models]
    .sort((left, right) => {
      const priorityDelta = (left.priority || 0) - (right.priority || 0);
      if (priorityDelta !== 0) return priorityDelta;
      const sortDelta = modelSortIndex(left) - modelSortIndex(right);
      if (sortDelta !== 0) return sortDelta;
      return left.slug.localeCompare(right.slug);
    })
    .map(serializeModelForCodexCache);
}

function normalizeCodexModelsCacheSyncResult(payload: unknown): CodexModelsCacheSyncResult {
  const source = asObject(payload);
  return {
    cachePath: asString(source.cachePath ?? source.cache_path),
    clientVersion: asString(source.clientVersion ?? source.client_version),
    modelsCount: Number(source.modelsCount ?? source.models_count) || 0,
    mode: "desktop",
  };
}

function parseCodexCliVersion(userAgent: string): string {
  const match = String(userAgent || "").match(/codex_cli_rs\/([^\s]+)/);
  return match?.[1]?.trim() || "";
}

function downloadJsonFile(fileName: string, content: string) {
  if (typeof document === "undefined") {
    throw new Error("当前环境不支持浏览器导出");
  }
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildCodexModelsCachePayload(
  models: Array<Record<string, unknown>>,
  userAgent: string,
) {
  const clientVersion = parseCodexCliVersion(userAgent);
  if (!clientVersion) {
    throw new Error("无法从 userAgent 解析 Codex CLI 版本");
  }
  return {
    fetched_at: new Date().toISOString(),
    etag: null,
    client_version: clientVersion,
    models,
  };
}

async function readCodexUserAgentAndHome() {
  const result = await invoke<unknown>("service_initialize", withAddr());
  const source = asObject(result);
  const userAgent = asString(source.userAgent ?? source.user_agent);
  if (!userAgent.includes("codex_cli_rs/")) {
    throw new Error("当前服务未返回可用的 Codex CLI 标识");
  }
  return {
    userAgent,
    codexHome: asString(source.codexHome ?? source.codex_home) || null,
  };
}

export async function syncCodexModelsCache(models: ModelInfo[]) {
  const payloadModels = serializeModelsForCodexCache(models);
  if (!payloadModels.length) {
    throw new Error("模型目录为空");
  }
  const { userAgent, codexHome } = await readCodexUserAgentAndHome();

  if (!isDesktopRuntime()) {
    const payload = buildCodexModelsCachePayload(payloadModels, userAgent);
    downloadJsonFile("models_cache.json", `${JSON.stringify(payload, null, 2)}\n`);
    return {
      cachePath: "",
      clientVersion: asString(payload.client_version),
      modelsCount: payloadModels.length,
      mode: "browser",
    } satisfies CodexModelsCacheSyncResult;
  }

  const result = await invoke<unknown>("service_sync_codex_models_cache", {
    userAgent,
    models: payloadModels,
    codexHome,
    etag: null,
    fetchedAt: new Date().toISOString(),
  });
  return { ...normalizeCodexModelsCacheSyncResult(result), mode: "desktop" };
}
