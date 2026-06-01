<template>
  <div class="page">
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">模型总数</div>
        <div class="summary-card__value">{{ models.length }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">API 可用</div>
        <div class="summary-card__value">{{ apiEnabledCount }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">自定义模型</div>
        <div class="summary-card__value">{{ customCount }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">当前状态</div>
        <div class="summary-card__value">{{ loading ? "加载中" : "就绪" }}</div>
      </div>
    </div>

    <div class="page-card">
      <div class="page-card__body">
        <div class="page-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索模型名称 / Slug" />
          <div class="table-actions">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button type="primary">添加模型</el-button>
          </div>
        </div>

        <el-table v-loading="loading" :data="filteredModels" class="data-table">
          <el-table-column label="模型" min-width="260">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ row.displayName || row.name || row.slug }}</strong>
                <span>{{ row.slug }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="140">
            <template #default="{ row }">
              {{ row.sourceKind || row.source || "内置" }}
            </template>
          </el-table-column>
          <el-table-column prop="visibility" label="可见性" width="120" />
          <el-table-column label="API" width="100">
            <template #default="{ row }">
              <el-tag :type="row.supportedInApi === false ? 'info' : 'success'" effect="light">
                {{ row.supportedInApi === false ? "关闭" : "启用" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="right">
            <template #default>
              <el-button link type="primary">编辑</el-button>
              <el-button link type="primary">复制</el-button>
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
import { listModels } from "@/api/model";
import type { ModelInfo } from "@/types/common";

const models = ref<ModelInfo[]>([]);
const keyword = ref("");
const loading = ref(false);

const apiEnabledCount = computed(
  () => models.value.filter((item) => item.supportedInApi !== false).length,
);
const customCount = computed(
  () => models.value.filter((item) => item.sourceKind === "custom" || item.source === "custom").length,
);
const filteredModels = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) return models.value;
  return models.value.filter((item) =>
    [item.slug, item.displayName, item.name].some((part) =>
      String(part || "").toLowerCase().includes(value),
    ),
  );
});

async function loadData() {
  loading.value = true;
  try {
    models.value = await listModels();
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
