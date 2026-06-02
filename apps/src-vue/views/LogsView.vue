<template>
  <div class="page logs-page">
    <div class="page-hero">
      <div>
        <h2 class="page-hero__title">请求日志</h2>
        <p class="page-hero__desc">
          查看网关请求、Token、费用、耗时、路由账号与聚合 API，并排查网关错误诊断事件。
        </p>
      </div>
      <div class="table-actions">
        <el-button :loading="loading" @click="loadRequestData">刷新</el-button>
        <el-button type="danger" @click="confirmClearRequests">清空日志</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="logs-tabs">
      <el-tab-pane label="请求日志" name="requests">
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-card__label">总日志</div>
            <div class="summary-card__value">{{ summary.filteredCount }}</div>
            <div class="summary-card__hint">当前筛选结果</div>
          </div>
          <div class="summary-card">
            <div class="summary-card__label">成功请求</div>
            <div class="summary-card__value">{{ summary.successCount }}</div>
            <div class="summary-card__hint">2xx 响应</div>
          </div>
          <div class="summary-card">
            <div class="summary-card__label">异常请求</div>
            <div class="summary-card__value">{{ summary.errorCount }}</div>
            <div class="summary-card__hint">4xx / 5xx / 错误</div>
          </div>
          <div class="summary-card">
            <div class="summary-card__label">累计 Token</div>
            <div class="summary-card__value summary-card__value--small">
              {{ compact(summary.totalTokens) }}
            </div>
            <div class="summary-card__hint">{{ formatUsd(summary.totalCostUsd) }}</div>
          </div>
        </div>

        <div class="page-card">
          <div class="page-card__body">
            <div class="filter-bar logs-filter">
              <el-input v-model="query" clearable placeholder="搜索 trace / path / account / model / error" />
              <el-select v-model="statusFilter">
                <el-option label="全部状态" value="all" />
                <el-option label="2xx" value="2xx" />
                <el-option label="4xx" value="4xx" />
                <el-option label="5xx" value="5xx" />
              </el-select>
              <el-select v-model="timePreset" @change="applyTimePreset">
                <el-option label="全部时间" value="all" />
                <el-option label="最近30分钟" value="30m" />
                <el-option label="最近2小时" value="2h" />
                <el-option label="最近24小时" value="24h" />
                <el-option label="今天" value="today" />
                <el-option label="自定义" value="custom" />
              </el-select>
              <el-date-picker
                v-model="timeRange"
                type="datetimerange"
                range-separator="至"
                start-placeholder="开始时间"
                end-placeholder="结束时间"
                value-format="x"
              />
              <el-button @click="clearTimeRange">清除时间</el-button>
            </div>
          </div>
        </div>

        <div class="page-card page-card--flush">
          <div class="table-scroll">
            <el-table v-loading="loading" :data="logs" class="logs-table">
              <el-table-column type="expand" width="44">
                <template #default="{ row }">
                  <div class="log-detail">
                    <div>
                      <span>Trace</span>
                      <strong class="mono">{{ row.traceId || row.id || "-" }}</strong>
                    </div>
                    <div>
                      <span>原始路径</span>
                      <strong>{{ row.originalPath || row.requestPath || row.path || "-" }}</strong>
                    </div>
                    <div>
                      <span>适配路径</span>
                      <strong>{{ row.adaptedPath || "-" }}</strong>
                    </div>
                    <div>
                      <span>上游 URL</span>
                      <strong>{{ row.upstreamUrl || row.aggregateApiUrl || "-" }}</strong>
                    </div>
                    <div>
                      <span>账号尝试链</span>
                      <strong>{{ chainText(row.attemptedAccountIds, row.initialAccountId, row.accountId) }}</strong>
                    </div>
                    <div>
                      <span>聚合 API 尝试链</span>
                      <strong>{{ chainText(row.attemptedAggregateApiIds, row.initialAggregateApiId, row.aggregateApiSupplierName) }}</strong>
                    </div>
                    <div>
                      <span>规范来源</span>
                      <strong>{{ textValue(row, "canonicalSource") || "-" }}</strong>
                    </div>
                    <div>
                      <span>大小拒绝阶段</span>
                      <strong>{{ textValue(row, "sizeRejectStage") || "-" }}</strong>
                    </div>
                    <div class="log-detail__wide">
                      <span>错误</span>
                      <strong>{{ row.error || "-" }}</strong>
                    </div>
                    <div v-if="textValue(row, 'compactOutputText')" class="log-detail__wide">
                      <span>压缩输出</span>
                      <strong>{{ textValue(row, "compactOutputText") }}</strong>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="请求" min-width="210">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>
                      <el-tag size="small" :type="requestTypeTag(row)" effect="light">
                        {{ requestTypeLabel(row) }}
                      </el-tag>
                      {{ row.method || "POST" }} {{ friendlyPath(row) }}
                    </strong>
                    <span class="mono">{{ row.traceId || row.id }}</span>
                    <span>{{ fullPath(row) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="模型" min-width="150">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>{{ row.model || "-" }}</strong>
                    <span v-if="row.reasoningEffort">推理 {{ row.reasoningEffort }}</span>
                    <span>
                      <el-tag size="small" :type="serviceTierTag(row)" effect="light">
                        {{ serviceTierText(row) }}
                      </el-tag>
                    </span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="账号 / 上游" min-width="190">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>{{ routeTitle(row) }}</strong>
                    <span>{{ routeSubTitle(row) }}</span>
                    <span class="mono">{{ row.keyId || "-" }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="statusType(displayStatusCode(row))" effect="light">
                    {{ displayStatusCode(row) || "-" }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="耗时" width="120">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>{{ formatDuration(row.durationMs) }}</strong>
                    <span>首响 {{ formatDuration(row.firstResponseMs) }}</span>
                    <span>输出 {{ outputRate(row) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="Token" min-width="180">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>总计 {{ compact(row.totalTokens || 0) }}</strong>
                    <span>输入 {{ compact(row.inputTokens || 0) }} / 输出 {{ compact(row.outputTokens || 0) }}</span>
                    <span>缓存 {{ compact(row.cachedInputTokens || 0) }} / 推理 {{ compact(row.reasoningOutputTokens || 0) }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="费用" width="100">
                <template #default="{ row }">{{ formatUsd(row.estimatedCostUsd || 0) }}</template>
              </el-table-column>
              <el-table-column label="错误" min-width="220" show-overflow-tooltip>
                <template #default="{ row }">{{ row.error || "-" }}</template>
              </el-table-column>
              <el-table-column label="操作" width="170" fixed="right">
                <template #default="{ row }">
                  <div class="row-actions">
                    <el-button link type="primary" @click="copyTrace(row)">Trace</el-button>
                    <el-button link type="primary" @click="copyRequestDetail(row)">详情</el-button>
                    <el-button
                      v-if="textValue(row, 'compactOutputText')"
                      link
                      type="primary"
                      @click="openOutputDetail(row)"
                    >
                      输出
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div class="page-card__body table-footer">
            <span>共 {{ requestTotal }} 条匹配日志</span>
            <el-pagination
              v-model:current-page="requestPage"
              v-model:page-size="requestPageSize"
              :page-sizes="[10, 20, 50, 100]"
              :total="requestTotal"
              layout="sizes, prev, pager, next"
              small
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="网关错误诊断" name="errors">
        <div class="page-card">
          <div class="page-card__body">
            <div class="filter-bar error-filter">
              <el-select v-model="stageFilter">
                <el-option label="全部阶段" value="all" />
                <el-option v-for="stage in errorStages" :key="stage" :label="stage" :value="stage" />
              </el-select>
              <div class="table-actions">
                <el-button :loading="errorLoading" @click="loadErrorData">刷新诊断</el-button>
                <el-button type="danger" @click="confirmClearErrors">清空诊断</el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="page-card page-card--flush">
          <div class="table-scroll">
            <el-table v-loading="errorLoading" :data="errorLogs" class="error-table">
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="请求" min-width="220">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>{{ row.method || "POST" }} {{ row.requestPath || "-" }}</strong>
                    <span class="mono">{{ row.traceId || "-" }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="阶段" width="140" prop="stage" />
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="statusType(row.statusCode)" effect="light">
                    {{ row.statusCode || "-" }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="上游" min-width="220" show-overflow-tooltip prop="upstreamUrl" />
              <el-table-column label="错误" min-width="320">
                <template #default="{ row }">
                  <div class="name-cell">
                    <strong>{{ row.errorKind || "error" }}</strong>
                    <span>{{ row.message || "-" }}</span>
                    <span v-if="row.cfRay">CF-Ray {{ row.cfRay }}</span>
                    <span>
                      压缩 {{ row.compressionEnabled ? "开" : "关" }} /
                      重试 {{ row.compressionRetryAttempted ? "已尝试" : "未尝试" }}
                    </span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="copyGatewayErrorSummary(row)">
                    复制诊断
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div class="page-card__body table-footer">
            <span>共 {{ errorTotal }} 条诊断日志</span>
            <el-pagination
              v-model:current-page="errorPage"
              v-model:page-size="errorPageSize"
              :page-sizes="[10, 20, 50]"
              :total="errorTotal"
              layout="sizes, prev, pager, next"
              small
            />
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="outputDialogOpen" title="输出内容" width="78vw" class="log-output-dialog">
      <div class="log-output-dialog__meta">
        <span>{{ detailLog ? formatTime(detailLog.createdAt) : "-" }}</span>
        <span>{{ detailLog?.model || "-" }}</span>
      </div>
      <pre class="log-output-dialog__content">{{ selectedOutputText || "暂无输出内容" }}</pre>
      <template #footer>
        <el-button :disabled="!selectedOutputText" @click="copyText(selectedOutputText)">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";

import {
  clearGatewayErrorLogs,
  clearRequestLogs,
  getRequestLogSummary,
  listGatewayErrorLogs,
  listRequestLogPage,
} from "@/api/requestLog";
import { getErrorMessage } from "@/api/http";
import type {
  GatewayErrorLog,
  RequestLogFilterSummary,
  RequestLogSummary,
} from "@/types/common";

const activeTab = ref("requests");
const logs = ref<RequestLogSummary[]>([]);
const errorLogs = ref<GatewayErrorLog[]>([]);
const errorStages = ref<string[]>([]);
const query = ref("");
const statusFilter = ref("all");
const stageFilter = ref("all");
const timePreset = ref("all");
const timeRange = ref<[number, number] | null>(null);
const requestPage = ref(1);
const requestPageSize = ref(20);
const requestTotal = ref(0);
const errorPage = ref(1);
const errorPageSize = ref(10);
const errorTotal = ref(0);
const loading = ref(false);
const errorLoading = ref(false);
const outputDialogOpen = ref(false);
const detailLog = ref<RequestLogSummary | null>(null);
const summary = ref<RequestLogFilterSummary>({
  totalCount: 0,
  filteredCount: 0,
  successCount: 0,
  errorCount: 0,
  totalTokens: 0,
  totalCostUsd: 0,
});

const startTs = computed(() =>
  timeRange.value?.[0] ? Math.floor(Number(timeRange.value[0]) / 1000) : null,
);
const endTs = computed(() =>
  timeRange.value?.[1] ? Math.floor(Number(timeRange.value[1]) / 1000) : null,
);
const selectedOutputText = computed(() =>
  detailLog.value ? textValue(detailLog.value, "compactOutputText") : "",
);

watch([query, statusFilter, timeRange, requestPageSize], () => {
  requestPage.value = 1;
  void loadRequestData();
});

watch([requestPage], () => {
  void loadRequestData();
});

watch([stageFilter, errorPageSize], () => {
  errorPage.value = 1;
  void loadErrorData();
});

watch([errorPage], () => {
  void loadErrorData();
});

watch(outputDialogOpen, (open) => {
  if (!open) {
    detailLog.value = null;
  }
});

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function textValue(row: RequestLogSummary, key: string) {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDuration(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value >= 10000) return `${Math.round(value / 1000)}s`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.round(value)}ms`;
}

function outputRate(row: RequestLogSummary) {
  const outputTokens = numericValue(row.outputTokens);
  const durationMs = numericValue(row.durationMs);
  if (outputTokens == null || durationMs == null || durationMs <= 0) return "-";
  const firstResponseMs = Math.max(0, numericValue(row.firstResponseMs) ?? 0);
  const outputDurationMs = firstResponseMs > 0 && durationMs > firstResponseMs
    ? durationMs - firstResponseMs
    : durationMs;
  if (outputDurationMs <= 0) return "-";
  const rate = outputTokens / (outputDurationMs / 1000);
  const value = rate > 0 && rate < 100
    ? rate.toFixed(1).replace(/\.0$/, "")
    : Math.round(rate).toLocaleString("zh-CN");
  return `${value}/s`;
}

function isCompactPath(path: string) {
  const value = path.trim();
  return (
    value === "/v1/responses/compact" ||
    value.startsWith("/v1/responses/compact?") ||
    value === "/responses/compact" ||
    value.startsWith("/responses/compact?") ||
    value === "/backend-api/codex/responses/compact" ||
    value.startsWith("/backend-api/codex/responses/compact?")
  );
}

function requestTypeLabel(row: RequestLogSummary) {
  const value = String(row.requestType || "").trim().toLowerCase();
  if (value === "ws") return "WS";
  if (value === "compact" || isCompactPath(fullPath(row))) return "CMP";
  return "HTTP";
}

function requestTypeTag(row: RequestLogSummary) {
  const label = requestTypeLabel(row);
  if (label === "WS") return "success";
  if (label === "CMP") return "warning";
  return "info";
}

function serviceTierText(row: RequestLogSummary) {
  const value = String(row.effectiveServiceTier || row.serviceTier || "").trim().toLowerCase();
  if (!value || value === "auto") return "auto";
  if (value === "priority") return "fast";
  return value;
}

function serviceTierTag(row: RequestLogSummary) {
  return serviceTierText(row) === "fast" ? "warning" : "info";
}

function fullPath(row: RequestLogSummary) {
  return (
    String(row.upstreamUrl || "").trim() ||
    String(row.adaptedPath || "").trim() ||
    String(row.originalPath || "").trim() ||
    String(row.requestPath || row.path || "").trim() ||
    "-"
  );
}

function friendlyPath(row: RequestLogSummary) {
  const path = String(row.originalPath || row.requestPath || row.path || "").trim();
  if (requestTypeLabel(row) === "CMP" || isCompactPath(path)) return "上下文压缩";
  if (path === "/internal/account/warmup") return "账号预热";
  return path || "-";
}

function routeTitle(row: RequestLogSummary) {
  return row.aggregateApiSupplierName || row.aggregateApiUrl || row.upstreamUrl || row.accountId || "-";
}

function routeSubTitle(row: RequestLogSummary) {
  if (row.aggregateApiSupplierName || row.aggregateApiUrl) {
    return row.aggregateApiUrl || row.upstreamUrl || "-";
  }
  return row.initialAccountId && row.initialAccountId !== row.accountId
    ? `先试 ${row.initialAccountId}`
    : row.upstreamUrl || "-";
}

function arrayText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function chainText(chain: unknown, initial?: string | null, current?: string | null) {
  const values = arrayText(chain);
  if (values.length > 0) return values.join(" -> ");
  return [initial, current].map((item) => String(item || "").trim()).filter(Boolean).join(" -> ") || "-";
}

function displayStatusCode(row: RequestLogSummary) {
  if (row.statusCode == null) return row.error ? 502 : null;
  return row.error && row.statusCode < 400 ? 502 : row.statusCode;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Math.max(0, Number(value) || 0));
}

function formatTime(value?: number | null) {
  if (!value || !Number.isFinite(value)) return "-";
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toLocaleString("zh-CN", { hour12: false });
}

function statusType(statusCode?: number | null) {
  if (!statusCode) return "info";
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (statusCode >= 400 && statusCode < 500) return "warning";
  return "danger";
}

function requestParams() {
  return {
    query: query.value,
    statusFilter: statusFilter.value,
    page: requestPage.value,
    pageSize: requestPageSize.value,
    startTs: startTs.value,
    endTs: endTs.value,
  };
}

async function copyText(text?: string | null) {
  const value = String(text || "").trim();
  if (!value) {
    ElMessage.warning("当前字段为空");
    return;
  }
  await navigator.clipboard.writeText(value);
  ElMessage.success("已复制到剪贴板");
}

function buildRequestDetail(row: RequestLogSummary) {
  return [
    `time=${formatTime(row.createdAt)}`,
    `trace=${row.traceId || row.id || "-"}`,
    `method=${row.method || "POST"}`,
    `type=${requestTypeLabel(row)}`,
    `path=${friendlyPath(row)}`,
    `full_path=${fullPath(row)}`,
    `status=${displayStatusCode(row) ?? "-"}`,
    `model=${row.model || "-"}`,
    `service_tier=${serviceTierText(row)}`,
    `key=${row.keyId || "-"}`,
    `account=${row.accountId || "-"}`,
    `aggregate_api=${row.aggregateApiSupplierName || row.aggregateApiUrl || "-"}`,
    `account_chain=${chainText(row.attemptedAccountIds, row.initialAccountId, row.accountId)}`,
    `aggregate_api_chain=${chainText(
      row.attemptedAggregateApiIds,
      row.initialAggregateApiId,
      row.aggregateApiSupplierName,
    )}`,
    `duration=${formatDuration(row.durationMs)}`,
    `first_response=${formatDuration(row.firstResponseMs)}`,
    `output_rate=${outputRate(row)}`,
    `tokens=${row.totalTokens ?? 0}`,
    `input_tokens=${row.inputTokens ?? 0}`,
    `cached_input_tokens=${row.cachedInputTokens ?? 0}`,
    `output_tokens=${row.outputTokens ?? 0}`,
    `reasoning_output_tokens=${row.reasoningOutputTokens ?? 0}`,
    `cost=${formatUsd(row.estimatedCostUsd || 0)}`,
    `canonical_source=${textValue(row, "canonicalSource") || "-"}`,
    `size_reject_stage=${textValue(row, "sizeRejectStage") || "-"}`,
    `error=${row.error || "-"}`,
    "",
    "raw=",
    JSON.stringify(row, null, 2),
  ].join("\n");
}

function copyTrace(row: RequestLogSummary) {
  void copyText(String(row.traceId || row.id || ""));
}

function copyRequestDetail(row: RequestLogSummary) {
  void copyText(buildRequestDetail(row));
}

function openOutputDetail(row: RequestLogSummary) {
  detailLog.value = row;
  outputDialogOpen.value = true;
}

function copyGatewayErrorSummary(row: GatewayErrorLog) {
  void copyText(
    [
      `time=${formatTime(row.createdAt)}`,
      `stage=${row.stage || "-"}`,
      `path=${row.requestPath || "-"}`,
      `method=${row.method || "-"}`,
      `status=${row.statusCode ?? "-"}`,
      `cf_ray=${row.cfRay || "-"}`,
      `kind=${row.errorKind || "-"}`,
      `compression=${row.compressionEnabled ? "zstd" : "none"}`,
      `retry_without_compression=${row.compressionRetryAttempted ? "yes" : "no"}`,
      `account=${row.accountId || "-"}`,
      `key=${row.keyId || "-"}`,
      `upstream=${row.upstreamUrl || "-"}`,
      `message=${row.message || "-"}`,
      "",
      "raw=",
      JSON.stringify(row, null, 2),
    ].join("\n"),
  );
}

async function loadRequestData() {
  loading.value = true;
  try {
    const [pageResult, summaryResult] = await Promise.all([
      listRequestLogPage(requestParams()),
      getRequestLogSummary(requestParams()),
    ]);
    logs.value = pageResult.items;
    requestTotal.value = pageResult.total;
    summary.value = summaryResult;
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function loadErrorData() {
  errorLoading.value = true;
  try {
    const result = await listGatewayErrorLogs({
      page: errorPage.value,
      pageSize: errorPageSize.value,
      stageFilter: stageFilter.value,
    });
    errorLogs.value = result.items;
    errorTotal.value = result.total;
    errorStages.value = result.stages;
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    errorLoading.value = false;
  }
}

function clearTimeRange() {
  timePreset.value = "all";
  timeRange.value = null;
}

function startOfTodayMs() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function applyTimePreset(value: unknown) {
  const preset = String(value || "all");
  timePreset.value = preset;
  if (preset === "custom") return;
  if (preset === "all") {
    timeRange.value = null;
    return;
  }
  const now = Date.now();
  if (preset === "today") {
    timeRange.value = [startOfTodayMs(), now];
    return;
  }
  const duration =
    preset === "30m"
      ? 30 * 60 * 1000
      : preset === "2h"
        ? 2 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  timeRange.value = [now - duration, now];
}

async function confirmClearRequests() {
  await ElMessageBox.confirm("确定清空全部请求日志吗？", "清空日志", { type: "warning" });
  try {
    await clearRequestLogs();
    ElMessage.success("请求日志已清空");
    await loadRequestData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function confirmClearErrors() {
  await ElMessageBox.confirm("确定清空全部网关错误诊断日志吗？", "清空诊断", { type: "warning" });
  try {
    await clearGatewayErrorLogs();
    ElMessage.success("诊断日志已清空");
    await loadErrorData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(() => {
  void loadRequestData();
  void loadErrorData();
});
</script>

<style scoped lang="scss">
.logs-page {
  .logs-tabs {
    display: grid;
    gap: 16px;
  }

  .logs-filter {
    grid-template-columns: minmax(240px, 1fr) 120px 150px minmax(320px, 420px) auto;
  }

  .error-filter {
    grid-template-columns: 220px auto;
  }

  .logs-table {
    min-width: 1260px;
  }

  .error-table {
    min-width: 1180px;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .log-detail {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
    padding: 14px 18px;
    background: var(--table-section-bg);

    > div {
      display: grid;
      gap: 4px;
      min-width: 0;

      span {
        color: var(--text-secondary);
        font-size: 12px;
      }

      strong {
        min-width: 0;
        overflow: hidden;
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    &__wide {
      grid-column: 1 / -1;

      strong {
        white-space: normal;
      }
    }
  }
}

.log-output-dialog {
  &__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  &__content {
    max-height: 62vh;
    margin: 0;
    overflow: auto;
    padding: 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);
    color: var(--text-primary);
    font-family: "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

@media (max-width: 980px) {
  .logs-page {
    .logs-filter,
    .error-filter {
      grid-template-columns: 1fr;
    }

    .log-detail {
      grid-template-columns: 1fr;
    }
  }
}
</style>
