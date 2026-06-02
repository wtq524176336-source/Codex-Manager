import { invoke, withAddr } from "@/api/transport";
import {
  asObject,
  asString,
  normalizeApiKeyCreateResult,
  normalizeApiKeyList,
  normalizeApiKeyUsageStats,
} from "@/api/normalize";

export interface ApiKeyPayload {
  name?: string | null;
  modelSlug?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  protocolType?: string | null;
  upstreamBaseUrl?: string | null;
  staticHeadersJson?: string | null;
  rotationStrategy?: string | null;
  aggregateApiId?: string | null;
  accountPlanFilter?: string | null;
}

export async function listApiKeys() {
  const result = await invoke<unknown>("service_apikey_list", withAddr());
  return normalizeApiKeyList(result);
}

function toRpcPayload(params: ApiKeyPayload) {
  return {
    name: params.name || null,
    modelSlug: params.modelSlug || null,
    reasoningEffort: params.reasoningEffort || null,
    serviceTier: params.serviceTier || null,
    protocolType: normalizeProtocolType(params.protocolType),
    upstreamBaseUrl: params.upstreamBaseUrl || null,
    staticHeadersJson: params.staticHeadersJson || null,
    rotationStrategy: params.rotationStrategy || null,
    aggregateApiId: params.aggregateApiId || null,
    accountPlanFilter: params.accountPlanFilter || null,
  };
}

function normalizeProtocolType(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "codex" || normalized === "claude_code" || normalized === "openai") {
    return "openai_compat";
  }
  if (normalized === "anthropic") return "anthropic_native";
  if (normalized === "gemini") return "gemini_native";
  return normalized;
}

export async function createApiKey(params: ApiKeyPayload) {
  const result = await invoke<unknown>("service_apikey_create", withAddr(toRpcPayload(params)));
  return normalizeApiKeyCreateResult(result);
}

export function updateApiKey(keyId: string, params: ApiKeyPayload) {
  return invoke("service_apikey_update_model", withAddr({ keyId, ...toRpcPayload(params) }));
}

export function deleteApiKey(keyId: string) {
  return invoke("service_apikey_delete", withAddr({ keyId }));
}

export function enableApiKey(keyId: string) {
  return invoke("service_apikey_enable", withAddr({ keyId }));
}

export function disableApiKey(keyId: string) {
  return invoke("service_apikey_disable", withAddr({ keyId }));
}

export async function readApiKeySecret(keyId: string) {
  const result = await invoke<unknown>("service_apikey_read_secret", withAddr({ keyId }));
  const source = asObject(result);
  return asString(source.key ?? result);
}

export async function listApiKeyUsageStats() {
  const result = await invoke<unknown>("service_apikey_usage_stats", withAddr());
  return normalizeApiKeyUsageStats(result);
}

export async function listApiKeyModels(refreshRemote = false) {
  const result = await invoke<unknown>("service_apikey_models", withAddr({ refreshRemote }));
  const source = asObject(result);
  return Array.isArray(source.models) ? source.models : Array.isArray(result) ? result : [];
}
