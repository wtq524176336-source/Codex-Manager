<template>
  <aside :class="['sidebar', { 'sidebar--collapsed': !sidebarOpen }]">
    <div class="brand">
      <div class="brand-mark">CM</div>
      <div v-if="sidebarOpen" class="brand-text">
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
        <span v-if="sidebarOpen">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-footer">
      <el-button class="collapse-button" text @click="sidebarOpen = !sidebarOpen">
        <el-icon>
          <component :is="sidebarOpen ? ArrowLeft : ArrowRight" />
        </el-icon>
        <span v-if="sidebarOpen">收起侧边栏</span>
      </el-button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ArrowLeft, ArrowRight } from "@element-plus/icons-vue";
import { ref } from "vue";

import { sidebarMenus } from "@/layout/menu";

const sidebarOpen = ref(true);
</script>

<style scoped lang="scss">
.sidebar {
  display: flex;
  flex-direction: column;
  width: 224px;
  flex: 0 0 224px;
  border-right: 1px solid var(--border-subtle);
  background: var(--sidebar-bg);
  transition:
    width 0.22s ease,
    flex-basis 0.22s ease;

  &--collapsed {
    width: 64px;
    flex-basis: 64px;

    .brand {
      justify-content: center;
      padding: 0 16px;
    }

    .menu-item {
      justify-content: center;
      padding: 0;
    }
  }
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
  flex: 1;
  align-content: flex-start;
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

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--border-subtle);
}

.collapse-button {
  width: 100%;
  justify-content: flex-start;
  gap: 10px;
  min-height: 40px;
  padding: 0 14px;
  color: var(--text-secondary);
}

@media (max-width: 860px) {
  .sidebar {
    width: 100%;
    flex-basis: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);

    &--collapsed {
      width: 100%;
      flex-basis: auto;
    }
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

  .sidebar-footer {
    display: none;
  }
}
</style>
