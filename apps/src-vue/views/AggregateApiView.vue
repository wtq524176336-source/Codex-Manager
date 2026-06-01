<template>
  <div class="page">
    <div class="page-card">
      <div class="page-card__body">
        <div class="page-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索供应商 / URL" />
          <div class="table-actions">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button type="primary">新建聚合 API</el-button>
          </div>
        </div>

        <el-table v-loading="loading" :data="filteredItems">
          <el-table-column label="供应商" min-width="180">
            <template #default="{ row }">
              <strong>{{ row.supplierName || row.id }}</strong>
            </template>
          </el-table-column>
          <el-table-column prop="providerType" label="类型" width="120" />
          <el-table-column prop="protocolMode" label="协议" width="140" />
          <el-table-column prop="url" label="URL" min-width="260" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'" effect="light">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" align="right">
            <template #default>
              <el-button link type="primary">测试</el-button>
              <el-button link type="primary">编辑</el-button>
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

import { listAggregateApis } from "@/api/aggregateApi";
import { getErrorMessage } from "@/api/http";
import type { AggregateApiSummary } from "@/types/common";

const items = ref<AggregateApiSummary[]>([]);
const keyword = ref("");
const loading = ref(false);

const filteredItems = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  if (!value) return items.value;
  return items.value.filter((item) =>
    [item.supplierName, item.url, item.id].some((part) =>
      String(part || "").toLowerCase().includes(value),
    ),
  );
});

async function loadData() {
  loading.value = true;
  try {
    items.value = await listAggregateApis();
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
    max-width: 360px;
  }
}
</style>
