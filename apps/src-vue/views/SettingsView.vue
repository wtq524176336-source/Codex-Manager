<template>
  <div class="page">
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">服务地址</div>
        <div class="summary-card__value summary-card__value--small">
          {{ serviceAddr }}
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">路由策略</div>
        <div class="summary-card__value summary-card__value--small">
          {{ settings.routeStrategy || "-" }}
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">语言</div>
        <div class="summary-card__value summary-card__value--small">
          {{ settings.locale || "-" }}
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">当前状态</div>
        <div class="summary-card__value">{{ loading ? "加载中" : "就绪" }}</div>
      </div>
    </div>

    <div class="page-card">
      <div class="page-card__body">
        <div class="page-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索设置项" />
          <div class="table-actions">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button type="primary">保存设置</el-button>
          </div>
        </div>

        <el-table v-loading="loading" :data="filteredRows" class="data-table">
          <el-table-column prop="key" label="设置项" width="260" />
          <el-table-column label="值" min-width="320">
            <template #default="{ row }">
              <code>{{ row.value }}</code>
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
import { readSettings } from "@/api/settings";

type SettingsMap = Record<string, unknown>;

const settings = ref<SettingsMap>({});
const keyword = ref("");
const loading = ref(false);

const serviceAddr = computed(() => String(settings.value.serviceAddr || "-"));
const rows = computed(() =>
  Object.entries(settings.value).map(([key, value]) => ({
    key,
    value: formatValue(value),
  })),
);
const filteredRows = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) return rows.value;
  return rows.value.filter((row) => row.key.toLowerCase().includes(value));
});

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function loadData() {
  loading.value = true;
  try {
    settings.value = await readSettings();
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

  code {
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
  }
}
</style>
