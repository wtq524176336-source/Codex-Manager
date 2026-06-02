<template>
  <header class="header">
    <div>
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>
    <el-tag :type="serviceReady ? 'success' : 'info'" effect="light">
      {{ serviceText }}
    </el-tag>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

import { useAppStore } from "@/stores/app";

const route = useRoute();
const appStore = useAppStore();
const serviceReady = computed(() => appStore.serviceReady);
const serviceText = computed(() => {
  if (appStore.serviceStatus === "ready") return "服务已连接";
  if (appStore.serviceStatus === "error") return "服务异常";
  return "启动服务";
});
const title = computed(() => String(route.meta.title || "CodexManager"));
const subtitle = computed(() => {
  switch (route.name) {
    case "accounts":
      return "管理账号、用量与状态";
    case "aggregate-api":
      return "管理第三方聚合 API 上游";
    case "apikeys":
      return "管理本地网关平台密钥";
    case "models":
      return "维护模型目录与显示选项";
    case "logs":
      return "查看网关请求与失败链路";
    case "settings":
      return "调整网关、服务与界面配置";
    default:
      return "";
  }
});
</script>

<style scoped lang="scss">
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--header-bg);

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
}

@media (max-width: 860px) {
  .header {
    min-height: 72px;
    padding: 0 16px;

    h1 {
      font-size: 20px;
    }
  }
}
</style>
