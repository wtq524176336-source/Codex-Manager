<template>
  <div class="app-shell">
    <Sidebar />
    <main class="app-main">
      <Header />
      <section class="app-content">
        <div v-if="appStore.serviceStarting" class="boot-screen">
          <el-icon class="is-loading">
            <Loading />
          </el-icon>
          <span>正在启动服务</span>
        </div>
        <RouterView v-else />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { Loading } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { onMounted, watch } from "vue";

import Header from "@/layout/Header.vue";
import Sidebar from "@/layout/Sidebar.vue";
import { useAppStore } from "@/stores/app";

const appStore = useAppStore();

onMounted(() => {
  void appStore.bootstrap();
});

watch(
  () => appStore.serviceError,
  (message) => {
    if (message) {
      ElMessage.error(message);
    }
  },
);
</script>

<style scoped lang="scss">
.app-shell {
  display: flex;
  min-height: 100vh;
  background: var(--app-bg);
  color: var(--text-primary);
}

.app-main {
  display: flex;
  height: 100vh;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.app-content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  padding: 24px;
}

.boot-screen {
  display: flex;
  min-height: 240px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 14px;
}

@media (max-width: 860px) {
  .app-shell {
    flex-direction: column;
  }

  .app-main {
    height: auto;
    min-height: 0;
  }

  .app-content {
    padding: 16px;
  }
}
</style>
