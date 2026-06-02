<template>
  <header class="header">
    <div class="header-title">
      <h1>{{ title }}</h1>
      <el-tag :type="serviceReady ? 'primary' : 'info'" effect="dark" round>
        {{ serviceText }}
      </el-tag>
    </div>
    <div class="header-actions">
      <div class="listen-pill">
        <span>监听端口</span>
        <strong>{{ listenPort }}</strong>
        <el-divider direction="vertical" />
        <el-switch :model-value="serviceReady" disabled />
      </div>
      <el-button @click="goSettings">
        <el-icon><Setting /></el-icon>
        密码
      </el-button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Setting } from "@element-plus/icons-vue";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useAppStore } from "@/stores/app";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const serviceReady = computed(() => appStore.serviceReady);
const serviceText = computed(() => {
  if (appStore.serviceStatus === "ready") return "服务已连接";
  if (appStore.serviceStatus === "error") return "服务异常";
  return "启动服务";
});
const title = computed(() => String(route.meta.title || "CodexManager"));
const listenPort = computed(() => {
  const value = appStore.serviceAddr || "localhost:48760";
  return value.split(":").pop() || "48760";
});

function goSettings() {
  void router.push("/settings");
}
</script>

<style scoped lang="scss">
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--header-bg);

  .header-title {
    display: flex;
    align-items: center;
    gap: 12px;

    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 750;
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .listen-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: var(--card-bg);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
    color: var(--text-secondary);
    font-size: 13px;

    strong {
      color: var(--text-primary);
      font-weight: 700;
    }
  }
}

@media (max-width: 860px) {
  .header {
    min-height: auto;
    flex-wrap: wrap;
    gap: 10px;
    padding: 0 16px;

    .header-title h1 {
      font-size: 20px;
    }

    .header-actions {
      width: 100%;
      justify-content: space-between;
      padding-bottom: 12px;
    }
  }
}
</style>
