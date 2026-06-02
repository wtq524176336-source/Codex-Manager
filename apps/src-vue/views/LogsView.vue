<template>
  <div class="page logs-page">
    <!-- 顶部胶囊页签：标题已由 layout/Header 显示，这里不再重复 -->
    <div class="logs-tabs">
      <button
        type="button"
        class="logs-tabs__item"
        :class="{ 'is-active': activeTab === 'requests' }"
        @click="activeTab = 'requests'"
      >
        <el-icon><Document /></el-icon>
        <span>请求日志</span>
      </button>
      <button
        type="button"
        class="logs-tabs__item"
        :class="{ 'is-active': activeTab === 'errors' }"
        @click="activeTab = 'errors'"
      >
        <el-icon><Warning /></el-icon>
        <span>网关错误诊断</span>
      </button>
    </div>

    <!-- ---------- 请求日志 ---------- -->
    <section v-show="activeTab === 'requests'" class="logs-section">
      <!-- 筛选 + 操作 -->
      <div class="page-card">
        <div class="page-card__body filter-card">
          <el-input
            v-model="query"
            clearable
            placeholder="搜索路径、账号或密钥..."
            class="filter-card__search"
          />
          <div class="segmented">
            <button
              v-for="item in statusOptions"
              :key="item.value"
              type="button"
              class="segmented__item"
              :class="{ 'is-active': statusFilter === item.value }"
              @click="onStatusChange(item.value)"
            >
              {{ item.label }}
            </button>
          </div>
          <div class="filter-card__actions">
            <el-button :loading="loading" @click="loadRequestData">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
            <el-button type="danger" @click="confirmClearRequests">
              <el-icon><Delete /></el-icon>
              清空日志
            </el-button>
          </div>
        </div>

        <div class="page-card__body time-card">
          <div class="time-card__presets">
            <div class="time-card__label">快捷时间</div>
            <div class="segmented">
              <button
                v-for="item in timePresets"
                :key="item.value"
                type="button"
                class="segmented__item"
                :class="{ 'is-active': timePreset === item.value }"
                @click="applyTimePreset(item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
          <div class="time-card__pickers">
            <div class="time-card__picker">
              <div class="time-card__label">开始时间</div>
              <el-date-picker
                v-model="startTime"
                type="datetime"
                placeholder="开始时间"
                value-format="x"
                @change="onCustomTimeChange"
              />
            </div>
            <div class="time-card__picker">
              <div class="time-card__label">结束时间</div>
              <el-date-picker
                v-model="endTime"
                type="datetime"
                placeholder="结束时间"
                value-format="x"
                @change="onCustomTimeChange"
              />
            </div>
          </div>
          <div class="time-card__meta">
            <div class="time-card__meta-line">{{ compactMetaText }}</div>
            <button
              v-if="hasActiveTimeRange"
              type="button"
              class="time-card__clear"
              @click="applyTimePreset('all')"
            >
              清除时间筛选
            </button>
          </div>
        </div>
      </div>

      <!-- 汇总卡片 -->
      <div class="summary-grid">
        <div class="summary-card summary-card--with-icon">
          <div class="summary-card__head">
            <span class="summary-card__label">当前结果</span>
            <span class="summary-card__icon summary-card__icon--primary">
              <el-icon><Lightning /></el-icon>
            </span>
          </div>
          <div class="summary-card__value">{{ summary.filteredCount }}</div>
          <div class="summary-card__hint">总日志 {{ summary.totalCount }} 条</div>
        </div>
        <div class="summary-card summary-card--with-icon">
          <div class="summary-card__head">
            <span class="summary-card__label">2XX 成功</span>
            <span class="summary-card__icon summary-card__icon--success">
              <el-icon><CircleCheckFilled /></el-icon>
            </span>
          </div>
          <div class="summary-card__value">{{ summary.successCount }}</div>
          <div class="summary-card__hint">状态码 200-299</div>
        </div>
        <div class="summary-card summary-card--with-icon">
          <div class="summary-card__head">
            <span class="summary-card__label">异常请求</span>
            <span class="summary-card__icon summary-card__icon--danger">
              <el-icon><WarningFilled /></el-icon>
            </span>
          </div>
          <div class="summary-card__value">{{ summary.errorCount }}</div>
          <div class="summary-card__hint">4xx / 5xx 或显式错误</div>
        </div>
        <div class="summary-card summary-card--with-icon">
          <div class="summary-card__head">
            <span class="summary-card__label">累计Token</span>
            <span class="summary-card__icon summary-card__icon--warning">
              <el-icon><DataLine /></el-icon>
            </span>
          </div>
          <div class="summary-card__value summary-card__value--small">
            {{ compactToken(summary.totalTokens) }}
          </div>
          <div class="summary-card__hint">{{ formatUsd(summary.totalCostUsd) }}</div>
        </div>
      </div>

      <!-- 请求明细表格 -->
      <div class="page-card page-card--flush">
        <div class="page-card__head">
          <div class="page-card__title">
            请求明细 按 <span class="page-card__title-strong">{{ currentFilterLabel }}</span> 展示
          </div>
        </div>
        <div class="table-scroll">
          <el-table v-loading="loading" :data="logs" class="logs-table">
            <el-table-column label="时间" width="160">
              <template #default="{ row }">
                <span class="mono cell-time">{{ formatTime(row.createdAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="类型 / 方法 / 路径" min-width="190">
              <template #default="{ row }">
                <div class="name-cell">
                  <div class="cell-row">
                    <el-tag
                      size="small"
                      :type="requestTypeTag(row)"
                      effect="light"
                      class="cell-tag"
                    >
                      {{ requestTypeLabel(row) }}
                    </el-tag>
                    <strong class="cell-method">{{ row.method || "-" }}</strong>
                  </div>
                  <span class="mono cell-path" :title="fullPath(row)">
                    {{ friendlyPath(row) }}
                  </span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="账号 / 密钥" min-width="200">
              <template #default="{ row }">
                <div class="name-cell">
                  <div class="cell-row">
                    <el-icon class="cell-icon"><component :is="routeIcon(row)" /></el-icon>
                    <strong>{{ routeTitle(row) }}</strong>
                  </div>
                  <span class="mono">{{ compactKeyLabel(row.keyId) }}</span>
                  <span v-if="routeHint(row)" class="cell-hint">{{ routeHint(row) }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="模型 / 推理 / 等级" min-width="170">
              <template #default="{ row }">
                <div class="name-cell">
                  <strong>{{ modelEffortText(row) }}</strong>
                  <el-tag
                    size="small"
                    :type="serviceTierTag(row)"
                    effect="light"
                    class="cell-tag"
                  >
                    {{ serviceTierText(row) }}
                  </el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="statusType(displayStatusCode(row))" effect="light">
                  {{ displayStatusCode(row) ?? "-" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="用时 / 首响" width="120">
              <template #default="{ row }">
                <span class="mono cell-duration">
                  {{ formatDuration(row.durationMs) }}/{{ formatDuration(row.firstResponseMs) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="Token" min-width="240">
              <template #default="{ row }">
                <div class="token-grid">
                  <span>总输入 {{ formatTokenCount(row.inputTokens) }}</span>
                  <span>输出 {{ formatTokenCount(row.outputTokens) }}</span>
                  <span>
                    输入 {{ formatTokenCount(
                      Math.max(0, (row.inputTokens || 0) - (row.cachedInputTokens || 0)),
                    ) }}
                  </span>
                  <span class="token-grid__highlight">速度 {{ outputRate(row) }}</span>
                  <span>缓存 {{ formatTokenCount(row.cachedInputTokens) }}</span>
                  <span />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="费用" width="110">
              <template #default="{ row }">
                <span class="mono">{{ formatRowCost(row.estimatedCostUsd) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="错误" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.error" class="danger-text">{{ row.error }}</span>
                <span v-else class="muted">-</span>
              </template>
            </el-table-column>
            <el-table-column label="详情" width="100" fixed="right">
              <template #default="{ row }">
                <el-button
                  v-if="getOutputText(row)"
                  size="small"
                  @click="openOutputDetail(row)"
                >
                  <el-icon><Document /></el-icon>
                  详情
                </el-button>
                <span v-else class="muted mono">-</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div class="logs-pagination">
        <span class="muted">共 {{ summary.filteredCount }} 条匹配日志</span>
        <el-pagination
          v-model:current-page="requestPage"
          v-model:page-size="requestPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="requestTotal"
          layout="sizes, prev, pager, next"
          small
        />
      </div>
    </section>

    <!-- ---------- 网关错误诊断 ---------- -->
    <section v-show="activeTab === 'errors'" class="logs-section">
      <div class="page-card">
        <div class="page-card__body filter-card filter-card--errors">
          <div class="filter-card__field">
            <div class="filter-card__field-label">阶段筛选</div>
            <el-select v-model="stageFilter" placeholder="全部阶段">
              <el-option label="全部阶段" value="all" />
              <el-option
                v-for="stage in errorStages"
                :key="stage"
                :label="stage"
                :value="stage"
              />
            </el-select>
          </div>
          <div class="filter-card__actions">
            <el-button :loading="errorLoading" @click="loadErrorData">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
            <el-button type="danger" @click="confirmClearErrors">
              <el-icon><Delete /></el-icon>
              清空诊断
            </el-button>
            <span class="muted filter-card__hint">
              当前页 {{ errorLogs.length }} 条 / 共 {{ errorTotal }} 条
            </span>
          </div>
        </div>
      </div>

      <div class="page-card page-card--flush">
        <div class="page-card__head">
          <div class="page-card__title">错误事件明细</div>
          <span class="muted">challenge / retry / transport</span>
        </div>
        <div class="table-scroll">
          <el-table v-loading="errorLoading" :data="errorLogs" class="error-table">
            <el-table-column label="时间" width="160">
              <template #default="{ row }">
                <span class="mono">{{ formatTime(row.createdAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="阶段" min-width="200">
              <template #default="{ row }">
                <div class="name-cell">
                  <strong>{{ row.stage || "-" }}</strong>
                  <span class="mono">{{ row.accountId || row.keyId || "-" }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="方法 / 路径" min-width="160">
              <template #default="{ row }">
                <div class="name-cell">
                  <strong>{{ row.method || "-" }}</strong>
                  <span class="mono">{{ row.requestPath || "-" }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="statusType(row.statusCode)" effect="light">
                  {{ row.statusCode ?? "-" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="上下文" min-width="220">
              <template #default="{ row }">
                <span class="mono">{{ gatewayContext(row) || "-" }}</span>
              </template>
            </el-table-column>
            <el-table-column label="消息" min-width="300" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="name-cell">
                  <span>{{ row.message || "-" }}</span>
                  <span v-if="row.upstreamUrl" class="mono cell-hint">{{ row.upstreamUrl }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="copyGatewayErrorSummary(row)">
                  复制诊断
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div class="logs-pagination">
        <span class="muted">共 {{ errorTotal }} 条匹配诊断日志</span>
        <el-pagination
          v-model:current-page="errorPage"
          v-model:page-size="errorPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="errorTotal"
          layout="sizes, prev, pager, next"
          small
        />
      </div>
    </section>

    <!-- 详情弹窗 -->
    <el-dialog
      v-model="outputDialogOpen"
      title="输出内容"
      width="78vw"
      class="log-output-dialog"
    >
      <div class="log-output-dialog__meta">
        <span>{{ detailLog ? formatTime(detailLog.createdAt) : "-" }}</span>
        <span>{{ detailLog?.model || "-" }}</span>
      </div>
      <pre class="log-output-dialog__content">{{
        selectedOutputText || "暂无输出内容"
      }}</pre>
      <template #footer>
        <el-button
          :disabled="!selectedOutputText"
          @click="copyText(selectedOutputText)"
        >
          复制
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  CircleCheckFilled,
  Connection,
  DataLine,
  Delete,
  Document,
  Key,
  Lightning,
  Refresh,
  Warning,
  WarningFilled,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import { listAccounts } from "@/api/account";
import { listAggregateApis } from "@/api/aggregateApi";
import { listApiKeys } from "@/api/apiKey";
import { getErrorMessage } from "@/api/http";
import {
  clearGatewayErrorLogs,
  clearRequestLogs,
  getRequestLogSummary,
  listGatewayErrorLogs,
  listRequestLogPage,
} from "@/api/requestLog";
import type {
  AccountSummary,
  AggregateApiSummary,
  ApiKeySummary,
  GatewayErrorLog,
  RequestLogFilterSummary,
  RequestLogSummary,
} from "@/types/common";

type StatusFilter = "all" | "2xx" | "4xx" | "5xx";
type TimePreset = "all" | "30m" | "2h" | "24h" | "today" | "custom";

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: "ALL", value: "all" },
  { label: "2XX", value: "2xx" },
  { label: "4XX", value: "4xx" },
  { label: "5XX", value: "5xx" },
];

const timePresets: Array<{ label: string; value: TimePreset }> = [
  { label: "全部时间", value: "all" },
  { label: "最近30分钟", value: "30m" },
  { label: "最近2小时", value: "2h" },
  { label: "最近24小时", value: "24h" },
  { label: "今天", value: "today" },
];

const activeTab = ref<"requests" | "errors">("requests");
const logs = ref<RequestLogSummary[]>([]);
const errorLogs = ref<GatewayErrorLog[]>([]);
const errorStages = ref<string[]>([]);
const query = ref("");
const statusFilter = ref<StatusFilter>("all");
const stageFilter = ref("all");
const timePreset = ref<TimePreset>("all");
const startTime = ref<number | null>(null);
const endTime = ref<number | null>(null);
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

const accountList = ref<AccountSummary[]>([]);
const apiKeyList = ref<ApiKeySummary[]>([]);
const aggregateApiList = ref<AggregateApiSummary[]>([]);

const summary = ref<RequestLogFilterSummary>({
  totalCount: 0,
  filteredCount: 0,
  successCount: 0,
  errorCount: 0,
  totalTokens: 0,
  totalCostUsd: 0,
});

let refreshTimer: number | null = null;

const startTs = computed(() =>
  startTime.value ? Math.floor(Number(startTime.value) / 1000) : null,
);
const endTs = computed(() =>
  endTime.value ? Math.floor(Number(endTime.value) / 1000) : null,
);
const hasActiveTimeRange = computed(
  () => startTime.value != null || endTime.value != null,
);

const accountNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const account of accountList.value) {
    if (account.id) {
      map.set(account.id, account.label || account.name || account.id);
    }
  }
  return map;
});

const apiKeyMap = computed(() => {
  const map = new Map<string, ApiKeySummary>();
  for (const item of apiKeyList.value) {
    if (item.id) map.set(item.id, item);
  }
  return map;
});

const aggregateApiMap = computed(() => {
  const map = new Map<string, AggregateApiSummary>();
  for (const item of aggregateApiList.value) {
    if (item.id) map.set(item.id, item);
  }
  return map;
});

const selectedOutputText = computed(() =>
  detailLog.value ? getOutputText(detailLog.value) : "",
);

const currentFilterLabel = computed(() => {
  switch (statusFilter.value) {
    case "2xx":
      return "成功请求";
    case "4xx":
      return "客户端错误";
    case "5xx":
      return "服务端错误";
    default:
      return "全部状态";
  }
});

const currentTimeRangeLabel = computed(() => {
  switch (timePreset.value) {
    case "30m":
      return "最近30分钟";
    case "2h":
      return "最近2小时";
    case "24h":
      return "最近24小时";
    case "today":
      return "今天";
    case "custom":
      return hasActiveTimeRange.value ? "自定义时间" : "全部时间";
    default:
      return "全部时间";
  }
});

const compactMetaText = computed(
  () =>
    `${summary.value.filteredCount}/${summary.value.totalCount} 条 · ${currentFilterLabel.value} · ${currentTimeRangeLabel.value} · 5 秒刷新`,
);

watch([query, statusFilter, startTime, endTime, requestPageSize], () => {
  requestPage.value = 1;
  void loadRequestData();
});

watch(requestPage, () => {
  void loadRequestData();
});

watch([stageFilter, errorPageSize], () => {
  errorPage.value = 1;
  void loadErrorData();
});

watch(errorPage, () => {
  void loadErrorData();
});

watch(outputDialogOpen, (open) => {
  if (!open) detailLog.value = null;
});

function compactToken(value: number) {
  const normalized = Math.max(0, Number(value) || 0);
  if (normalized < 1000) return normalized.toLocaleString("zh-CN");
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(normalized);
}

function formatTokenCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Math.max(0, Math.round(value)).toLocaleString("zh-CN");
}

function formatDuration(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value >= 10000) return `${Math.round(value / 1000)}s`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.round(value)}ms`;
}

function outputRate(row: RequestLogSummary) {
  const outputTokens =
    typeof row.outputTokens === "number" && Number.isFinite(row.outputTokens)
      ? Math.max(0, row.outputTokens)
      : null;
  const durationMs =
    typeof row.durationMs === "number" && Number.isFinite(row.durationMs)
      ? Math.max(0, row.durationMs)
      : null;
  if (outputTokens == null || durationMs == null || durationMs <= 0) return "-";
  const firstResponseMs =
    typeof row.firstResponseMs === "number" && Number.isFinite(row.firstResponseMs)
      ? Math.max(0, row.firstResponseMs)
      : 0;
  const outputDurationMs =
    firstResponseMs > 0 && durationMs > firstResponseMs
      ? durationMs - firstResponseMs
      : durationMs;
  if (outputDurationMs <= 0) return "-";
  const rate = outputTokens / (outputDurationMs / 1000);
  const formatted =
    rate > 0 && rate < 100
      ? rate.toFixed(1).replace(/\.0$/, "")
      : Math.round(rate).toLocaleString("zh-CN");
  return `${formatted}/s`;
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
  const value = String(row.effectiveServiceTier || row.serviceTier || "")
    .trim()
    .toLowerCase();
  if (!value || value === "auto") return "auto";
  if (value === "priority") return "fast";
  return value;
}

function serviceTierTag(row: RequestLogSummary) {
  return serviceTierText(row) === "fast" ? "warning" : "info";
}

function modelEffortText(row: RequestLogSummary) {
  const model = String(row.model || "").trim();
  const effort = String(row.reasoningEffort || "").trim();
  if (model && effort) return `${model}/${effort}`;
  return model || effort || "-";
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

function fallbackAccountNameFromId(id: string) {
  const raw = id.trim();
  if (!raw) return "";
  const sep = raw.indexOf("::");
  if (sep < 0) return "";
  return raw.slice(sep + 2).trim();
}

function fallbackAccountFromKey(keyId?: string | null) {
  const raw = String(keyId || "").trim();
  if (!raw) return "";
  return `Key ${raw.slice(0, 10)}`;
}

function compactKeyLabel(keyId?: string | null) {
  const value = String(keyId || "").trim();
  if (!value) return "-";
  return value.length <= 12 ? value : `${value.slice(0, 8)}...`;
}

function normalizeAggregateApiUrl(value?: string | null) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function lookupAggregateApi(row: RequestLogSummary): AggregateApiSummary | null {
  const apiKey = apiKeyMap.value.get(String(row.keyId || ""));
  if (apiKey?.aggregateApiId) {
    const direct = aggregateApiMap.value.get(apiKey.aggregateApiId);
    if (direct) return direct;
  }
  const upstream = normalizeAggregateApiUrl(row.upstreamUrl);
  if (!upstream) return null;
  for (const item of aggregateApiList.value) {
    if (normalizeAggregateApiUrl(item.url) === upstream) return item;
  }
  return null;
}

function isAggregateApiRow(row: RequestLogSummary) {
  if (row.aggregateApiSupplierName || row.aggregateApiUrl) return true;
  return lookupAggregateApi(row) != null;
}

function routeIcon(row: RequestLogSummary) {
  return isAggregateApiRow(row) ? Connection : Key;
}

function routeTitle(row: RequestLogSummary) {
  if (isAggregateApiRow(row)) {
    if (row.aggregateApiSupplierName) return row.aggregateApiSupplierName;
    const aggregate = lookupAggregateApi(row);
    if (aggregate?.supplierName) return aggregate.supplierName;
    if (aggregate?.url) return aggregate.url;
    return row.aggregateApiUrl || "-";
  }
  if (row.accountId) {
    const named = accountNameMap.value.get(row.accountId);
    if (named) return named;
    const fallback = fallbackAccountNameFromId(row.accountId);
    if (fallback) return fallback;
    return row.accountId;
  }
  return fallbackAccountFromKey(row.keyId) || "-";
}

function routeHint(row: RequestLogSummary) {
  if (isAggregateApiRow(row)) {
    const attempts = (row.attemptedAggregateApiIds || [])
      .map((id) => {
        const item = aggregateApiMap.value.get(String(id));
        return item?.supplierName || item?.url || id;
      })
      .filter((value) => Boolean(value));
    if (attempts.length > 1 && row.initialAggregateApiId) {
      const initial = aggregateApiMap.value.get(String(row.initialAggregateApiId));
      const label = initial?.supplierName || initial?.url || row.initialAggregateApiId;
      if (label) return `先试 ${label}`;
    }
    return "";
  }
  const attempted = row.attemptedAccountIds || [];
  if (attempted.length > 1 && row.initialAccountId && row.initialAccountId !== row.accountId) {
    const initial =
      accountNameMap.value.get(row.initialAccountId) ||
      fallbackAccountNameFromId(row.initialAccountId) ||
      row.initialAccountId;
    return `先试 ${initial}`;
  }
  return "";
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

function formatRowCost(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-";
  return `$${value.toFixed(6)}`;
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

function getOutputText(row: RequestLogSummary) {
  const value = row["compactOutputText"];
  return typeof value === "string" ? value.trim() : "";
}

function gatewayContext(row: GatewayErrorLog) {
  return [
    row.errorKind ? `kind=${row.errorKind}` : "",
    row.cfRay ? `cf_ray=${row.cfRay}` : "",
    row.compressionEnabled ? "compression=zstd" : "compression=none",
    row.compressionRetryAttempted ? "retry=no-compression" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function onStatusChange(value: StatusFilter) {
  statusFilter.value = value;
}

function onCustomTimeChange() {
  timePreset.value = "custom";
}

function startOfTodayMs() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfTodayMs() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function applyTimePreset(value: TimePreset) {
  timePreset.value = value;
  if (value === "custom") return;
  if (value === "all") {
    startTime.value = null;
    endTime.value = null;
    return;
  }
  if (value === "today") {
    startTime.value = startOfTodayMs();
    endTime.value = endOfTodayMs();
    return;
  }
  const now = Date.now();
  const duration =
    value === "30m"
      ? 30 * 60 * 1000
      : value === "2h"
        ? 2 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  startTime.value = now - duration;
  endTime.value = now;
}

async function loadLookupData() {
  try {
    const [accountResult, apiKeyResult, aggregateApiResult] = await Promise.all([
      listAccounts().catch(() => ({ items: [] as AccountSummary[] })),
      listApiKeys().catch(() => [] as ApiKeySummary[]),
      listAggregateApis().catch(() => [] as AggregateApiSummary[]),
    ]);
    accountList.value = accountResult.items || [];
    apiKeyList.value = apiKeyResult;
    aggregateApiList.value = aggregateApiResult;
  } catch {
    // 查表失败不影响日志主流程
  }
}

async function loadRequestData() {
  loading.value = true;
  try {
    const params = {
      query: query.value,
      statusFilter: statusFilter.value,
      page: requestPage.value,
      pageSize: requestPageSize.value,
      startTs: startTs.value,
      endTs: endTs.value,
    };
    const [pageResult, summaryResult] = await Promise.all([
      listRequestLogPage(params),
      getRequestLogSummary(params),
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

function openOutputDetail(row: RequestLogSummary) {
  detailLog.value = row;
  outputDialogOpen.value = true;
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

async function copyGatewayErrorSummary(row: GatewayErrorLog) {
  await copyText(
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
    ].join("\n"),
  );
}

async function confirmClearRequests() {
  await ElMessageBox.confirm("确定清空全部请求日志吗？", "清空日志", {
    type: "warning",
  });
  try {
    await clearRequestLogs();
    ElMessage.success("请求日志已清空");
    await loadRequestData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function confirmClearErrors() {
  await ElMessageBox.confirm("确定清空全部网关错误诊断日志吗？", "清空诊断", {
    type: "warning",
  });
  try {
    await clearGatewayErrorLogs();
    ElMessage.success("诊断日志已清空");
    await loadErrorData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(() => {
  void loadLookupData();
  void loadRequestData();
  void loadErrorData();
  refreshTimer = window.setInterval(() => {
    if (activeTab.value === "requests") {
      void loadRequestData();
    } else {
      void loadErrorData();
    }
  }, 5000);
});

onUnmounted(() => {
  if (refreshTimer != null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});
</script>

<style scoped lang="scss">
.logs-page {
  display: grid;
  gap: 16px;
}

.logs-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: var(--shadow-card);
  width: fit-content;

  &__item {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 8px 18px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;

    .el-icon {
      font-size: 16px;
    }

    &:hover {
      color: var(--text-primary);
    }

    &.is-active {
      background: var(--card-solid, var(--app-bg));
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
  }
}

.logs-section {
  display: grid;
  gap: 16px;
}

.filter-card {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto auto;
  gap: 12px;
  align-items: center;

  &--errors {
    grid-template-columns: minmax(220px, 320px) 1fr;
  }

  &__search {
    min-width: 0;
  }

  &__actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }

  &__hint {
    font-size: 12px;
  }

  &__field {
    display: grid;
    gap: 4px;
  }

  &__field-label {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
  }
}

.time-card {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
  gap: 16px;
  align-items: end;
  border-top: 1px solid var(--border-subtle);

  &__presets {
    display: grid;
    gap: 6px;
  }

  &__pickers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  &__picker {
    display: grid;
    gap: 4px;

    .el-date-editor {
      width: 100%;
    }
  }

  &__label {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
  }

  &__meta {
    display: grid;
    gap: 4px;
    justify-items: end;
    text-align: right;
  }

  &__meta-line {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
  }

  &__clear {
    border: none;
    background: none;
    color: var(--el-color-primary);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
}

.segmented {
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--app-bg);

  &__item {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      color: var(--text-primary);
    }

    &.is-active {
      background: var(--card-solid, var(--card-bg));
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
  }
}

.summary-card--with-icon {
  display: grid;
  gap: 6px;

  .summary-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .summary-card__label {
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
  }

  .summary-card__value {
    margin-top: 2px;
    font-size: 30px;
    font-weight: 700;
    line-height: 1.1;
  }

  .summary-card__hint {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .summary-card__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    font-size: 16px;

    &--primary {
      background: rgba(47, 108, 246, 0.12);
      color: var(--el-color-primary);
    }

    &--success {
      background: rgba(46, 184, 122, 0.12);
      color: var(--el-color-success);
    }

    &--danger {
      background: rgba(231, 71, 71, 0.12);
      color: var(--el-color-danger);
    }

    &--warning {
      background: rgba(247, 168, 53, 0.14);
      color: var(--el-color-warning);
    }
  }
}

.page-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--table-section-bg);
}

.page-card__title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;

  &-strong {
    color: var(--el-color-primary);
  }
}

.logs-table,
.error-table {
  width: 100%;
  font-size: 12px;
}

.cell-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cell-tag {
  height: 18px;
  line-height: 16px;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.cell-icon {
  font-size: 12px;
  color: var(--text-secondary);
}

.cell-method {
  font-family: "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
  font-weight: 600;
  color: var(--el-color-primary);
}

.cell-path {
  font-size: 11px;
  color: var(--text-secondary);
}

.cell-hint {
  color: var(--el-color-warning);
  font-size: 11px;
}

.cell-time {
  font-size: 11px;
  color: var(--text-secondary);
}

.cell-duration {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
}

.token-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.55;

  &__highlight {
    color: var(--el-color-primary);
    font-weight: 600;
  }
}

.logs-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px;
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

@media (max-width: 1280px) {
  .time-card {
    grid-template-columns: 1fr;
    align-items: start;

    &__meta {
      justify-items: start;
      text-align: left;
    }
  }
}

@media (max-width: 980px) {
  .filter-card {
    grid-template-columns: 1fr;
  }
}
</style>
