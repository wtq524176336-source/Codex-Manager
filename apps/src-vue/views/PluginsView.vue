<template>
  <div class="page plugins-page">
    <section class="plugin-hero">
      <div>
        <el-tag effect="plain">插件市场</el-tag>
        <h2>插件管理</h2>
        <p>安装、启停、运行和查看插件任务，保持与 React 版本的市场 / 已安装 / 日志视图一致。</p>
      </div>
      <div class="plugin-hero__actions">
        <el-button :loading="loading" @click="loadData(false)">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button type="primary" :loading="loading" @click="loadData(true)">
          <el-icon><Download /></el-icon>
          刷新市场
        </el-button>
      </div>
    </section>

    <div class="plugin-stats">
      <div class="plugin-stat">
        <span>市场插件</span>
        <strong>{{ catalog.length }}</strong>
        <small>内置精选 / 自定义源</small>
      </div>
      <div class="plugin-stat">
        <span>已安装</span>
        <strong>{{ installed.length }}</strong>
        <small>当前本地插件</small>
      </div>
      <div class="plugin-stat">
        <span>任务数量</span>
        <strong>{{ tasks.length }}</strong>
        <small>手动 / 定时任务</small>
      </div>
      <div class="plugin-stat">
        <span>运行日志</span>
        <strong>{{ logs.length }}</strong>
        <small>最近执行记录</small>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="plugin-tabs">
      <el-tab-pane label="插件市场" name="catalog">
        <div class="plugin-toolbar">
          <el-input v-model="keyword" clearable placeholder="搜索插件名称 / 描述 / 标签" />
          <el-segmented v-model="catalogFilter" :options="catalogFilterOptions" />
        </div>
        <div v-loading="loading" class="plugin-grid">
          <div v-for="item in filteredCatalog" :key="item.id" class="plugin-card">
            <div class="plugin-card__head">
              <div>
                <h3>{{ item.name }}</h3>
                <p>{{ item.description || "暂无描述" }}</p>
              </div>
              <el-tag>{{ formatRuntimeKind(item.runtimeKind) }}</el-tag>
            </div>
            <div class="plugin-card__meta">
              <span>v{{ item.version }}</span>
              <span>{{ formatMarketCategory(item.category) }}</span>
              <span>{{ item.author || "未知作者" }}</span>
            </div>
            <div class="plugin-card__badges">
              <el-tag v-for="tag in item.tags || []" :key="tag" size="small" type="info">
                {{ tag }}
              </el-tag>
              <el-tag v-for="permission in item.permissions || []" :key="permission" size="small" effect="plain">
                {{ formatPermissionLabel(permission) }}
              </el-tag>
            </div>
            <div class="plugin-card__footer">
              <span>{{ item.tasks?.length || 0 }} 个任务</span>
              <el-button
                size="small"
                :type="installedMap[item.id] ? 'default' : 'primary'"
                :loading="operatingId === item.id"
                @click="installedMap[item.id] ? updateInstalledPlugin(item.id) : installCatalogPlugin(item.id)"
              >
                {{ installedMap[item.id] ? "更新" : "安装" }}
              </el-button>
            </div>
          </div>
          <div v-if="!filteredCatalog.length" class="empty-hint">暂无插件</div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="已安装" name="installed">
        <div v-loading="loading" class="plugin-grid">
          <div v-for="item in installed" :key="item.pluginId" class="plugin-card">
            <div class="plugin-card__head">
              <div>
                <h3>{{ item.name }}</h3>
                <p>{{ item.description || "暂无描述" }}</p>
              </div>
              <el-tag :type="item.status === 'enabled' ? 'success' : 'info'">
                {{ formatPluginStatus(item.status) }}
              </el-tag>
            </div>
            <div class="plugin-card__meta">
              <span>v{{ item.version }}</span>
              <span>{{ item.enabledTaskCount || 0 }}/{{ item.taskCount || 0 }} 任务启用</span>
              <span>最后运行 {{ formatTime(item.lastRunAt) }}</span>
            </div>
            <p v-if="item.lastError" class="plugin-error">{{ item.lastError }}</p>
            <div class="plugin-card__footer">
              <el-button size="small" :loading="operatingId === item.pluginId" @click="togglePlugin(item)">
                {{ item.status === "enabled" ? "禁用" : "启用" }}
              </el-button>
              <el-button size="small" type="danger" :loading="operatingId === item.pluginId" @click="removePlugin(item)">
                卸载
              </el-button>
            </div>
          </div>
          <div v-if="!installed.length" class="empty-hint">暂无已安装插件</div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="任务" name="tasks">
        <div class="plugin-table-card">
          <el-table v-loading="loading" :data="tasks" class="plugin-table">
            <el-table-column label="任务" min-width="260">
              <template #default="{ row }">
                <div class="plugin-task-name">
                  <strong>{{ row.name }}</strong>
                  <span>{{ row.pluginName || row.pluginId }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="调度" width="160">
              <template #default="{ row }">{{ formatSchedule(row) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="140">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? "启用" : "停用" }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="下次运行" width="180">
              <template #default="{ row }">{{ formatTime(row.nextRunAt) }}</template>
            </el-table-column>
            <el-table-column label="上次结果" min-width="180">
              <template #default="{ row }">
                <span>{{ row.lastStatus || "-" }}</span>
                <p v-if="row.lastError" class="plugin-error">{{ row.lastError }}</p>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" align="right">
              <template #default="{ row }">
                <el-button link type="primary" :loading="operatingId === row.id" @click="runTask(row.id)">
                  运行
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="运行日志" name="logs">
        <div class="plugin-table-card">
          <el-table v-loading="loading" :data="logs" class="plugin-table">
            <el-table-column label="插件 / 任务" min-width="240">
              <template #default="{ row }">
                <div class="plugin-task-name">
                  <strong>{{ row.pluginName || row.pluginId }}</strong>
                  <span>{{ row.taskName || row.taskId || row.runType }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.status === 'success' ? 'success' : 'danger'">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="开始时间" width="180">
              <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
            </el-table-column>
            <el-table-column label="耗时" width="120">
              <template #default="{ row }">{{ row.durationMs != null ? `${row.durationMs}ms` : "-" }}</template>
            </el-table-column>
            <el-table-column label="错误" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">{{ row.error || "-" }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { Download, Refresh } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";

import {
  enablePlugin,
  installPlugin,
  listInstalledPlugins,
  listPluginCatalog,
  listPluginRunLogs,
  listPluginTasks,
  runPluginTask,
  uninstallPlugin,
  updatePlugin,
} from "@/api/plugin";
import { getErrorMessage } from "@/api/http";
import type { InstalledPluginSummary, PluginCatalogEntry, PluginRunLogSummary, PluginTaskSummary } from "@/types/common";

const activeTab = ref("catalog");
const keyword = ref("");
const catalogFilter = ref("installed");
const loading = ref(false);
const operatingId = ref("");
const catalog = ref<PluginCatalogEntry[]>([]);
const installed = ref<InstalledPluginSummary[]>([]);
const tasks = ref<PluginTaskSummary[]>([]);
const logs = ref<PluginRunLogSummary[]>([]);
const catalogFilterOptions = [
  { label: "已安装", value: "installed" },
  { label: "未安装", value: "not-installed" },
  { label: "更新", value: "update" },
];

const installedMap = computed<Record<string, InstalledPluginSummary>>(() =>
  installed.value.reduce<Record<string, InstalledPluginSummary>>((result, item) => {
    result[item.pluginId] = item;
    return result;
  }, {}),
);
const filteredCatalog = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  return catalog.value.filter((item) => {
    const installedItem = installedMap.value[item.id];
    if (catalogFilter.value === "installed" && !installedItem) return false;
    if (catalogFilter.value === "not-installed" && installedItem) return false;
    if (
      catalogFilter.value === "update" &&
      (!installedItem || compareVersion(item.version, installedItem.version) <= 0)
    ) {
      return false;
    }
    if (!value) return true;
    return [item.id, item.name, item.description, item.author, ...(item.tags || [])].some((part) =>
      String(part || "").toLowerCase().includes(value),
    );
  });
});

async function loadData(refreshCatalog = false) {
  loading.value = true;
  try {
    const [catalogResult, installedResult, tasksResult, logsResult] = await Promise.all([
      listPluginCatalog(refreshCatalog),
      listInstalledPlugins(),
      listPluginTasks(),
      listPluginRunLogs({ limit: 50 }),
    ]);
    catalog.value = Array.isArray(catalogResult) ? catalogResult : [];
    installed.value = Array.isArray(installedResult) ? installedResult : [];
    tasks.value = Array.isArray(tasksResult) ? tasksResult : [];
    logs.value = Array.isArray(logsResult) ? logsResult : [];
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function operate(pluginId: string, action: () => Promise<unknown>, message: string) {
  operatingId.value = pluginId;
  try {
    await action();
    ElMessage.success(message);
    await loadData(false);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    operatingId.value = "";
  }
}

function installCatalogPlugin(pluginId: string) {
  void operate(pluginId, () => installPlugin(pluginId), "插件已安装");
}

function updateInstalledPlugin(pluginId: string) {
  void operate(pluginId, () => updatePlugin(pluginId), "插件已更新");
}

function togglePlugin(item: InstalledPluginSummary) {
  const enabled = item.status !== "enabled";
  void operate(item.pluginId, () => enablePlugin(item.pluginId, enabled), enabled ? "插件已启用" : "插件已禁用");
}

async function removePlugin(item: InstalledPluginSummary) {
  try {
    await ElMessageBox.confirm(`确定卸载插件 ${item.name} 吗？`, "卸载插件", { type: "warning" });
  } catch {
    return;
  }
  void operate(item.pluginId, () => uninstallPlugin(item.pluginId), "插件已卸载");
}

function runTask(taskId: string) {
  void operate(taskId, () => runPluginTask(taskId), "任务已运行");
}

function formatPermissionLabel(permission: string) {
  switch (permission) {
    case "accounts:cleanup":
      return "清理封禁账号";
    case "settings:read":
      return "读取设置";
    case "network":
      return "网络访问";
    default:
      return permission;
  }
}

function formatMarketCategory(category?: string | null) {
  switch (category) {
    case "official":
      return "官方精选";
    case "private":
      return "企业私有";
    case "community":
      return "社区插件";
    default:
      return category || "未分类";
  }
}

function formatRuntimeKind(value?: string | null) {
  if (value === "rhai") return "Rhai";
  if (value === "wasm") return "WASM";
  return value || "-";
}

function formatPluginStatus(status: string) {
  if (status === "enabled") return "启用中";
  if (status === "broken") return "异常";
  return "已停用";
}

function formatSchedule(row: PluginTaskSummary) {
  if (row.scheduleKind === "manual") return "手动";
  if (row.intervalSeconds) return `每 ${Math.round(row.intervalSeconds / 60)} 分钟`;
  return row.scheduleKind || "-";
}

function formatTime(value?: number | null) {
  if (!value) return "-";
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toLocaleString("zh-CN", { hour12: false });
}

function compareVersion(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

onMounted(() => {
  void loadData(false);
});
</script>

<style scoped lang="scss">
.plugins-page {
  gap: 18px;

  .plugin-hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;

    h2 {
      margin: 10px 0 6px;
      font-size: 30px;
      font-weight: 760;
    }

    p {
      max-width: 780px;
      margin: 0;
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
    }

    &__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
  }

  .plugin-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .plugin-stat,
  .plugin-card,
  .plugin-table-card {
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--card-bg);
    box-shadow: var(--shadow-card);
  }

  .plugin-stat {
    display: grid;
    gap: 8px;
    padding: 16px;

    span,
    small {
      color: var(--text-secondary);
      font-size: 12px;
    }

    strong {
      font-size: 26px;
    }
  }

  .plugin-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    margin-bottom: 14px;

    .el-input {
      max-width: 340px;
    }
  }

  .plugin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
    min-height: 160px;
  }

  .plugin-card {
    display: grid;
    gap: 12px;
    padding: 16px;

    &__head {
      display: flex;
      gap: 12px;
      justify-content: space-between;

      h3 {
        margin: 0;
        font-size: 16px;
      }

      p {
        margin: 6px 0 0;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.6;
      }
    }

    &__meta,
    &__footer,
    &__badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    &__meta,
    &__footer span {
      color: var(--text-secondary);
      font-size: 12px;
    }

    &__footer {
      justify-content: space-between;
      padding-top: 4px;
    }
  }

  .plugin-error {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
    line-height: 1.6;
  }

  .plugin-table-card {
    overflow: hidden;
  }

  .plugin-task-name {
    display: grid;
    gap: 4px;

    span {
      color: var(--text-secondary);
      font-size: 12px;
    }
  }
}

@media (max-width: 980px) {
  .plugins-page {
    .plugin-hero {
      display: grid;
    }

    .plugin-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}

@media (max-width: 640px) {
  .plugins-page {
    .plugin-stats {
      grid-template-columns: 1fr;
    }
  }
}
</style>
