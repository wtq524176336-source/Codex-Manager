<template>
  <div class="page">
    <div class="page-card">
      <div class="page-card__body">
        <div class="page-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索密钥名称" />
          <div class="table-actions">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button type="primary">新建密钥</el-button>
          </div>
        </div>

        <el-table v-loading="loading" :data="filteredItems">
          <el-table-column label="名称" min-width="180">
            <template #default="{ row }">
              <strong>{{ row.name || row.id }}</strong>
            </template>
          </el-table-column>
          <el-table-column prop="keyPreview" label="密钥" min-width="180" />
          <el-table-column prop="rotationStrategy" label="选路策略" width="180" />
          <el-table-column prop="model" label="模型" width="160" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column label="操作" width="160" align="right">
            <template #default>
              <el-button link type="primary">编辑</el-button>
              <el-button link type="danger">删除</el-button>
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

import { listApiKeys } from "@/api/apiKey";
import { getErrorMessage } from "@/api/http";
import type { ApiKeySummary } from "@/types/common";

const items = ref<ApiKeySummary[]>([]);
const keyword = ref("");
const loading = ref(false);

const filteredItems = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) return items.value;
  return items.value.filter((item) =>
    [item.name, item.id, item.keyPreview].some((part) =>
      String(part || "").toLowerCase().includes(value),
    ),
  );
});

async function loadData() {
  loading.value = true;
  try {
    items.value = await listApiKeys();
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
</style>
