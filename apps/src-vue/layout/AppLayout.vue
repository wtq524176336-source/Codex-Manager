<template>
  <div class="app-shell">
    <Sidebar />
    <main class="app-main">
      <Header />
      <section class="app-content">
        <RouterView />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import Header from "@/layout/Header.vue";
import Sidebar from "@/layout/Sidebar.vue";
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
