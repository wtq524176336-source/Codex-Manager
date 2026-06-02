import { invoke, withAddr } from "@/api/transport";
import {
  normalizeAggregateApiList,
  normalizeAggregateApiSecret,
  normalizeAggregateApiTest,
} from "@/api/normalize";

export interface AggregateApiPayload {
  providerType?: string | null;
  protocolMode?: string | null;
  supplierName?: string | null;
  sort?: number | null;
  status?: string | null;
  url?: string | null;
  key?: string | null;
  authType?: string | null;
  authCustomEnabled?: boolean | null;
  authParams?: Record<string, unknown> | null;
  actionCustomEnabled?: boolean | null;
  action?: string | null;
  modelOverride?: string | null;
  username?: string | null;
  password?: string | null;
}

export async function listAggregateApis() {
  const result = await invoke<unknown>("service_aggregate_api_list", withAddr());
  return normalizeAggregateApiList(result);
}

function toRpcPayload(params: AggregateApiPayload) {
  return {
    providerType: params.providerType || null,
    protocolMode: params.protocolMode || null,
    supplierName: params.supplierName || null,
    sort: typeof params.sort === "number" ? params.sort : null,
    status: params.status || null,
    url: params.url || null,
    key: params.key || null,
    authType: params.authType || null,
    authCustomEnabled:
      typeof params.authCustomEnabled === "boolean" ? params.authCustomEnabled : null,
    authParams: params.authParams || null,
    actionCustomEnabled:
      typeof params.actionCustomEnabled === "boolean" ? params.actionCustomEnabled : null,
    action: params.action ?? null,
    modelOverride: typeof params.modelOverride === "string" ? params.modelOverride : null,
    username: params.username || null,
    password: params.password || null,
  };
}

export function createAggregateApi(params: AggregateApiPayload) {
  return invoke("service_aggregate_api_create", withAddr(toRpcPayload(params)));
}

export function updateAggregateApi(id: string, params: AggregateApiPayload) {
  return invoke("service_aggregate_api_update", withAddr({ id, ...toRpcPayload(params) }));
}

export function deleteAggregateApi(id: string) {
  return invoke("service_aggregate_api_delete", withAddr({ id }));
}

export function resetAggregateApiUsage(id: string) {
  return invoke("service_aggregate_api_reset_usage", withAddr({ id }));
}

export async function readAggregateApiSecret(id: string) {
  const result = await invoke<unknown>("service_aggregate_api_read_secret", withAddr({ id }));
  return normalizeAggregateApiSecret(result);
}

export async function testAggregateApiConnection(id: string) {
  const result = await invoke<unknown>("service_aggregate_api_test_connection", withAddr({ id }));
  return normalizeAggregateApiTest(result);
}
