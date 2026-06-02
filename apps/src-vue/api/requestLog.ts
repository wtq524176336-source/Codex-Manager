import { invoke, withAddr } from "@/api/transport";
import {
  normalizeGatewayErrorLogList,
  normalizeRequestLogList,
  normalizeRequestLogListResult,
  normalizeRequestLogSummary,
  asObject,
  toNumber,
} from "@/api/normalize";

export interface RequestLogListParams {
  query?: string;
  statusFilter?: string;
  page?: number;
  pageSize?: number;
  startTs?: number | null;
  endTs?: number | null;
}

export async function listRequestLogs(params: RequestLogListParams = {}) {
  const result = await invoke<unknown>(
    "service_requestlog_list",
    withAddr({
      query: params.query || "",
      statusFilter: params.statusFilter || "all",
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      startTs: params.startTs ?? null,
      endTs: params.endTs ?? null,
    }),
  );
  return normalizeRequestLogList(result);
}

export async function listRequestLogPage(params: RequestLogListParams = {}) {
  const result = await invoke<unknown>(
    "service_requestlog_list",
    withAddr({
      query: params.query || "",
      statusFilter: params.statusFilter || "all",
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      startTs: params.startTs ?? null,
      endTs: params.endTs ?? null,
    }),
  );
  return normalizeRequestLogListResult(result);
}

export async function getRequestLogSummary(params: RequestLogListParams = {}) {
  const result = await invoke<unknown>(
    "service_requestlog_summary",
    withAddr({
      query: params.query || "",
      statusFilter: params.statusFilter || "all",
      startTs: params.startTs ?? null,
      endTs: params.endTs ?? null,
    }),
  );
  return normalizeRequestLogSummary(result);
}

export interface RequestLogTodaySummary {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  todayTokens: number;
  estimatedCost: number;
}

export async function getRequestLogTodaySummary() {
  const result = await invoke<unknown>("service_requestlog_today_summary", withAddr());
  const source = asObject(result);
  return {
    inputTokens: toNumber(source.inputTokens ?? source.input_tokens, 0),
    cachedInputTokens: toNumber(source.cachedInputTokens ?? source.cached_input_tokens, 0),
    outputTokens: toNumber(source.outputTokens ?? source.output_tokens, 0),
    reasoningOutputTokens: toNumber(
      source.reasoningOutputTokens ?? source.reasoning_output_tokens,
      0,
    ),
    todayTokens: toNumber(source.todayTokens ?? source.today_tokens, 0),
    estimatedCost: toNumber(source.estimatedCost ?? source.estimated_cost, 0),
  } satisfies RequestLogTodaySummary;
}

export function clearRequestLogs() {
  return invoke("service_requestlog_clear", withAddr());
}

export async function listGatewayErrorLogs(params: {
  page?: number;
  pageSize?: number;
  stageFilter?: string;
} = {}) {
  const result = await invoke<unknown>(
    "service_requestlog_error_list",
    withAddr({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
      stageFilter: params.stageFilter || "all",
    }),
  );
  return normalizeGatewayErrorLogList(result);
}

export function clearGatewayErrorLogs() {
  return invoke("service_requestlog_error_clear", withAddr());
}
