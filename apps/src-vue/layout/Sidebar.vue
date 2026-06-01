<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">CM</div>
      <div class="brand-text">
        <div class="brand-name">CodexManager</div>
        <div class="brand-subtitle">账号池 · 用量管理</div>
      </div>
    </div>

    <nav class="menu">
      <RouterLink
        v-for="item in sidebarMenus"
        :key="item.path"
        :to="item.path"
        class="menu-item"
        active-class="is-active"
      >
        <el-icon class="menu-icon">
          <component :is="item.icon" />
        </el-icon>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { sidebarMenus } from "@/layout/menu";
</script>

<style scoped lang="scss">
.sidebar {
  width: 224px;
  flex: 0 0 224px;
  border-right: 1px solid var(--border-subtle);
  background: var(--sidebar-bg);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 88px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-subtle);
}

.brand-mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-weight: 700;
}

.brand-text {
  min-width: 0;
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
}

.brand-subtitle {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.menu {
  display: grid;
  gap: 6px;
  padding: 16px 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  text-decoration: none;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover,
  &.is-active {
    background: var(--menu-active-bg);
    color: var(--text-primary);
  }
}

.menu-icon {
  font-size: 16px;
}

@media (max-width: 860px) {
  .sidebar {
    width: 100%;
    flex-basis: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .brand {
    height: 64px;
    padding: 0 16px;
  }

  .menu {
    display: flex;
    overflow-x: auto;
    padding: 8px;
  }

  .menu-item {
    flex: 0 0 auto;
  }
}
</style>
