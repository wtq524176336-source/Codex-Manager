<template>
  <div class="page">
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">日志条数</div>
        <div class="summary-card__value">{{ logs.length }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">成功请求</div>
        <div class="summary-card__value">{{ successCount }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">异常请求</div>
        <div class="summary-card__value">{{ errorCount }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">平均耗时</div>
        <div class="summary-card__value">{{ averageDuration }}ms</div>
      </div>
    </div>

    <div class="page-card">
      <div class="page-card__body">
        <div class="page-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索路径 / 模型 / 上游" />
          <div class="table-actions">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button>导出</el-button>
          </div>
        </div>

        <el-table v-loading="loading" :data="filteredLogs" class="data-table">
          <el-table-column label="请求" min-width="260">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ row.method || "POST" }} {{ row.requestPath || row.path || "-" }}</strong>
                <span>{{ row.model || row.traceId || "-" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="readStatusType(row.statusCode)" effect="light">
                {{ row.statusCode || "-" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="账号 / 上游" min-width="180">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ row.accountId || "-" }}</strong>
                <span>{{ row.aggregateApiSupplierName || row.upstreamUrl || "-" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="Token" width="100">
            <template #default="{ row }">
              {{ row.totalTokens ?? "-" }}
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="100">
            <template #default="{ row }">
              {{ row.durationMs ?? "-" }}ms
            </template>
          </el-table-column>
          <el-table-column label="时间" width="180">
            <template #default="{ row }">
              {{ formatTime(row.createdAt) }}
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, ref } from "vue";

import { getErrorMessage } from "@/api/http";
import { listRequestLogs } from "@/api/requestLog";
import type { RequestLogSummary } from "@/types/common";

const logs = ref<RequestLogSummary[]>([]);
const keyword = ref("");
const loading = ref(false);

const successCount = computed(
  () => logs.value.filter((item) => item.statusCode && item.statusCode < 400).length,
);
const errorCount = computed(
  () => logs.value.filter((item) => item.statusCode && item.statusCode >= 400).length,
);
const averageDuration = computed(() => {
  const values = logs.value
    .map((item) => item.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
});
const filteredLogs = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) return logs.value;
  return logs.value.filter((item) =>
    [item.requestPath, item.path, item.model, item.accountId, item.upstreamUrl].some((part) =>
      String(part || "").toLowerCase().includes(value),
    ),
  );
});

function readStatusType(statusCode?: number | null) {
  if (!statusCode) return "info";
  if (statusCode >= 500) return "danger";
  if (statusCode >= 400) return "warning";
  return "success";
}

function formatTime(value?: number | null): string {
  if (!value) return "-";
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toLocaleString();
}

async function loadData() {
  loading.value = true;
  try {
    logs.value = await listRequestLogs();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped lang="scss">
.page-toolbar {
  margin-bottom: 16px;

  .el-input {
    max-width: 320px;
  }
}

.data-table {
  width: 100%;
}

.name-cell {
  display: grid;
  gap: 4px;

  span {
    overflow: hidden;
    color: var(--text-secondary);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
