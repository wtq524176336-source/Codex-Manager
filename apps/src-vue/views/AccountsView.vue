<template>
  <div class="page">
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">账号总数</div>
        <div class="summary-card__value">{{ accounts.length }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">可用账号</div>
        <div class="summary-card__value">{{ availableCount }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">异常账号</div>
        <div class="summary-card__value">{{ unavailableCount }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">当前状态</div>
        <div class="summary-card__value">{{ loading ? "加载中" : "就绪" }}</div>
      </div>
    </div>

    <div class="page-card">
      <div class="page-card__body">
        <div class="page-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索账号名 / 编号" />
          <div class="table-actions">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button type="primary">添加账号</el-button>
          </div>
        </div>

        <el-table v-loading="loading" :data="filteredAccounts" class="data-table">
          <el-table-column prop="name" label="账号" min-width="220">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ row.label || row.name || row.id }}</strong>
                <span>{{ row.id }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="planType" label="类型" width="120" />
          <el-table-column prop="status" label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="row.isAvailable === false ? 'danger' : 'success'" effect="light">
                {{ row.status || (row.isAvailable === false ? "异常" : "正常") }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="用量" width="180">
            <template #default="{ row }">
              <el-progress
                :percentage="readUsedPercent(row)"
                :stroke-width="8"
                :show-text="false"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="right">
            <template #default>
              <el-button link type="primary">详情</el-button>
              <el-button link type="primary">刷新</el-button>
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

import { listAccounts } from "@/api/account";
import { getErrorMessage } from "@/api/http";
import type { AccountSummary } from "@/types/common";

const accounts = ref<AccountSummary[]>([]);
const keyword = ref("");
const loading = ref(false);

const availableCount = computed(
  () => accounts.value.filter((item) => item.isAvailable !== false).length,
);
const unavailableCount = computed(() => accounts.value.length - availableCount.value);
const filteredAccounts = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) return accounts.value;
  return accounts.value.filter((item) =>
    [item.id, item.name, item.label].some((part) =>
      String(part || "").toLowerCase().includes(value),
    ),
  );
});

function readUsedPercent(row: AccountSummary): number {
  const value = row.usage?.usedPercent;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

async function loadData() {
  loading.value = true;
  try {
    const result = await listAccounts();
    accounts.value = result.items || [];
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
    color: var(--text-secondary);
    font-size: 12px;
  }
}
</style>
