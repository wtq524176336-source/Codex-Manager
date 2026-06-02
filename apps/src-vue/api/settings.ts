import { invoke, withAddr } from "@/api/transport";
import {
  asObject,
  normalizeGatewayRouteStrategy,
  normalizeGatewayTransport,
  normalizeGatewayUpstreamProxy,
  normalizeServiceListenConfig,
  toNumber,
} from "@/api/normalize";
import type {
  BackgroundTaskSettings,
  GatewayTransportSettings,
  GatewayUpstreamProxySettings,
} from "@/types/common";

export function readSettings() {
  return invoke<Record<string, unknown>>("app_settings_get");
}

export function saveSettings(patch: Record<string, unknown>) {
  return invoke<Record<string, unknown>>("app_settings_set", { patch });
}

export async function readListenConfig() {
  const result = await invoke<unknown>("service_listen_config_get", withAddr());
  return normalizeServiceListenConfig(result);
}

export async function saveListenConfig(mode: string) {
  const result = await invoke<unknown>("service_listen_config_set", withAddr({ mode }));
  return normalizeServiceListenConfig(result);
}

export async function readRouteStrategy() {
  const result = await invoke<unknown>("service_gateway_route_strategy_get", withAddr());
  return normalizeGatewayRouteStrategy(result);
}

export function saveRouteStrategy(strategy: string) {
  return invoke("service_gateway_route_strategy_set", withAddr({ strategy }));
}

export async function readUpstreamProxy() {
  const result = await invoke<unknown>("service_gateway_upstream_proxy_get", withAddr());
  return normalizeGatewayUpstreamProxy(result);
}

export async function saveUpstreamProxy(settings: Partial<GatewayUpstreamProxySettings>) {
  const result = await invoke<unknown>(
    "service_gateway_upstream_proxy_set",
    withAddr({ proxyUrl: settings.proxyUrl || "" }),
  );
  return normalizeGatewayUpstreamProxy(result);
}

export async function readGatewayTransport() {
  const result = await invoke<unknown>("service_gateway_transport_get", withAddr());
  return normalizeGatewayTransport(result);
}

export function saveGatewayTransport(settings: Partial<GatewayTransportSettings>) {
  return invoke(
    "service_gateway_transport_set",
    withAddr({
      sseKeepaliveIntervalMs: settings.sseKeepaliveIntervalMs,
      upstreamStreamTimeoutMs: settings.upstreamStreamTimeoutMs,
      upstreamTotalTimeoutMs: settings.upstreamTotalTimeoutMs,
    }),
  );
}

export function readBackgroundTasks() {
  return invoke<Record<string, unknown>>("service_gateway_background_tasks_get", withAddr());
}

export function saveBackgroundTasks(settings: BackgroundTaskSettings) {
  return invoke("service_gateway_background_tasks_set", withAddr(settings));
}

export interface GatewayConcurrencyRecommendation {
  cpuCores: number;
  memoryMib: number;
  usageRefreshWorkers: number;
  httpWorkerFactor: number;
  httpWorkerMin: number;
  httpStreamWorkerFactor: number;
  httpStreamWorkerMin: number;
  queueWaitTimeoutMs: number;
}

export async function getGatewayConcurrencyRecommendation() {
  const result = await invoke<unknown>("service_gateway_concurrency_recommend_get", withAddr());
  const source = asObject(result);
  return {
    cpuCores: toNumber(source.cpuCores ?? source.cpu_cores, 1),
    memoryMib: toNumber(source.memoryMib ?? source.memory_mib, 1),
    usageRefreshWorkers: toNumber(source.usageRefreshWorkers ?? source.usage_refresh_workers, 4),
    httpWorkerFactor: toNumber(source.httpWorkerFactor ?? source.http_worker_factor, 4),
    httpWorkerMin: toNumber(source.httpWorkerMin ?? source.http_worker_min, 8),
    httpStreamWorkerFactor: toNumber(
      source.httpStreamWorkerFactor ?? source.http_stream_worker_factor,
      1,
    ),
    httpStreamWorkerMin: toNumber(source.httpStreamWorkerMin ?? source.http_stream_worker_min, 2),
    queueWaitTimeoutMs: toNumber(source.queueWaitTimeoutMs ?? source.queue_wait_timeout_ms, 100),
  } satisfies GatewayConcurrencyRecommendation;
}
