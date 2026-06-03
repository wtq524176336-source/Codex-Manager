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

    <section class="plugin-market-card">
      <div class="plugin-market-card__head">
        <div>
          <h3>市场层</h3>
          <p>只保留内置精选和自定义源两种模式。内置模式完全隔离自定义 URL，自定义模式才显示并加载远程 JSON 市场。</p>
        </div>
      </div>
      <div class="market-mode-grid">
        <button
          type="button"
          :class="['market-mode-card', marketMode === 'builtin' ? 'market-mode-card--active' : '']"
          @click="marketMode = 'builtin'"
        >
          <span>内置精选</span>
          <small>默认使用官方精选插件，适合开箱即用。</small>
          <el-tag v-if="marketMode === 'builtin'" size="small">已选</el-tag>
        </button>
        <button
          type="button"
          :class="['market-mode-card', marketMode === 'custom' ? 'market-mode-card--active' : '']"
          @click="marketMode = 'custom'"
        >
          <span>自定义源</span>
          <small>加载你自己的 JSON 市场文件，适合团队内部分发。</small>
          <el-tag v-if="marketMode === 'custom'" size="small">已选</el-tag>
        </button>
      </div>
      <div v-if="marketMode === 'custom'" class="market-source-row">
        <el-input v-model="sourceUrl" placeholder="https://example.com/plugin-market.json" />
        <el-button type="primary" :loading="savingMarket" @click="saveMarketSettings">保存</el-button>
        <el-button :loading="loading" @click="loadData(true)">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
      <div class="market-source-hint">
        {{ marketMode === "custom" ? customMarketHint : "当前使用内置精选市场，默认只显示官方内置脚本插件。" }}
      </div>
    </section>

    <section class="plugin-list-card">
      <div class="plugin-list-card__head">
        <div>
          <h3>插件列表</h3>
          <p>一个面板统一查看插件。未安装看当前市场，已安装看本地插件，更新只显示当前市场里有新版本的已安装插件。</p>
        </div>
        <div class="plugin-filter-row">
          <button
            v-for="option in pluginViewFilterOptions"
            :key="option.value"
            type="button"
            :class="['plugin-filter-button', catalogFilter === option.value ? 'plugin-filter-button--active' : '']"
            @click="catalogFilter = option.value"
          >
            <span>{{ option.label }}</span>
            <el-tag size="small" effect="light">{{ pluginFilterCount(option.value) }}</el-tag>
          </button>
        </div>
      </div>

      <div v-loading="loading" class="plugin-grid">
        <template v-if="catalogFilter === 'installed'">
          <div v-for="item in installed" :key="item.pluginId" class="plugin-card">
            <div class="plugin-card__head">
              <div>
                <h3>{{ item.name }}</h3>
                <p>{{ item.description || "暂无描述" }}</p>
              </div>
              <div class="plugin-card__status">
                <el-tag effect="light">v{{ item.version }}</el-tag>
                <el-tag v-if="updatableVersionByPluginId[item.pluginId]" type="primary" effect="light">
                  可更新 {{ updatableVersionByPluginId[item.pluginId] }}
                </el-tag>
                <el-tag effect="plain">已安装</el-tag>
                <el-tag :type="item.status === 'enabled' ? 'success' : item.status === 'broken' ? 'danger' : 'warning'">
                  {{ formatPluginStatus(item.status) }}
                </el-tag>
              </div>
            </div>
            <div class="plugin-card__meta">
              <span v-if="item.author">作者：{{ item.author }}</span>
              <span>权限 {{ item.permissions?.length || 0 }}</span>
              <span>任务 {{ item.enabledTaskCount || 0 }}/{{ item.taskCount || 0 }}</span>
              <el-tag v-if="item.category" size="small" effect="plain">{{ formatMarketCategory(item.category) }}</el-tag>
              <el-tag size="small" effect="plain">{{ formatRuntimeKind(item.runtimeKind) }}</el-tag>
            </div>
            <div class="plugin-card__footer">
              <span>{{ formatInstalledSource(item.sourceUrl) }}</span>
              <div class="plugin-card__actions">
                <el-button size="small" @click="openInstalledDetail(item)">详情</el-button>
                <el-button
                  v-if="updatableVersionByPluginId[item.pluginId]"
                  size="small"
                  type="primary"
                  :loading="operatingId === item.pluginId"
                  @click="updateInstalledPlugin(item.pluginId)"
                >
                  更新
                </el-button>
                <el-button v-else size="small" :loading="operatingId === item.pluginId" @click="togglePlugin(item)">
                  {{ item.status === "enabled" ? "停用" : "启用" }}
                </el-button>
              </div>
            </div>
          </div>
          <div v-if="!installed.length" class="empty-hint">还没有安装任何插件</div>
        </template>

        <template v-else-if="catalogFilter === 'update'">
          <div v-for="item in updatableInstalledItems" :key="item.pluginId" class="plugin-card">
            <div class="plugin-card__head">
              <div>
                <h3>{{ item.name }}</h3>
                <p>{{ item.description || "暂无描述" }}</p>
              </div>
              <div class="plugin-card__status">
                <el-tag effect="light">v{{ item.version }}</el-tag>
                <el-tag type="primary" effect="light">可更新 {{ updatableVersionByPluginId[item.pluginId] }}</el-tag>
                <el-tag :type="item.status === 'enabled' ? 'success' : item.status === 'broken' ? 'danger' : 'warning'">
                  {{ formatPluginStatus(item.status) }}
                </el-tag>
              </div>
            </div>
            <div class="plugin-card__meta">
              <span v-if="item.author">作者：{{ item.author }}</span>
              <span>权限 {{ item.permissions?.length || 0 }}</span>
              <span>任务 {{ item.enabledTaskCount || 0 }}/{{ item.taskCount || 0 }}</span>
              <el-tag size="small" effect="plain">{{ formatRuntimeKind(item.runtimeKind) }}</el-tag>
            </div>
            <div class="plugin-card__footer">
              <span>{{ formatInstalledSource(item.sourceUrl) }}</span>
              <div class="plugin-card__actions">
                <el-button size="small" @click="openInstalledDetail(item)">详情</el-button>
                <el-button size="small" type="primary" :loading="operatingId === item.pluginId" @click="updateInstalledPlugin(item.pluginId)">
                  更新
                </el-button>
              </div>
            </div>
          </div>
          <div v-if="!updatableInstalledItems.length" class="empty-hint">当前市场没有可更新插件</div>
        </template>

        <template v-else>
          <div v-for="item in notInstalledCatalogItems" :key="item.id" class="plugin-card">
            <div class="plugin-card__head">
              <div>
                <h3>{{ item.name }}</h3>
                <p>{{ item.description || "暂无描述" }}</p>
              </div>
              <el-tag effect="light">v{{ item.version }}</el-tag>
            </div>
            <div class="plugin-card__meta">
              <span v-if="item.author">作者：{{ item.author }}</span>
              <span>权限 {{ item.permissions?.length || 0 }}</span>
              <span>任务 {{ item.tasks?.length || 0 }}</span>
              <el-tag v-if="item.category" size="small" effect="plain">{{ formatMarketCategory(item.category) }}</el-tag>
              <el-tag size="small" effect="plain">{{ formatRuntimeKind(item.runtimeKind) }}</el-tag>
            </div>
            <div class="plugin-card__footer">
              <span>{{ formatCatalogSource(item.sourceUrl) }}</span>
              <div class="plugin-card__actions">
                <el-button size="small" @click="openCatalogDetail(item)">详情</el-button>
                <el-button size="small" type="primary" :loading="operatingId === item.id" @click="installCatalogPlugin(item.id)">
                  安装
                </el-button>
              </div>
            </div>
          </div>
          <div v-if="!notInstalledCatalogItems.length" class="empty-hint">
            {{ marketMode === "custom" && !sourceUrl ? "当前还没有配置自定义源，所以这里不会显示未安装插件。" : "暂无未安装插件" }}
          </div>
        </template>
      </div>
    </section>

    <el-dialog
      v-model="detailOpen"
      :title="selectedDetail?.name || '插件详情'"
      width="860px"
      class="plugin-detail-dialog"
    >
      <div v-if="selectedDetail" class="plugin-detail">
        <div class="plugin-detail__head">
          <div>
            <div class="plugin-detail__title">
              <strong>{{ selectedDetail.name }}</strong>
              <el-tag effect="light">v{{ selectedDetail.version }}</el-tag>
              <el-tag v-if="selectedInstalledItem" :type="selectedInstalledItem.status === 'enabled' ? 'success' : 'info'">
                {{ formatPluginStatus(selectedInstalledItem.status) }}
              </el-tag>
            </div>
            <p>{{ selectedDetail.description || "暂无描述" }}</p>
          </div>
        </div>

        <div class="plugin-detail__meta">
          <span v-if="selectedDetail.author">作者：{{ selectedDetail.author }}</span>
          <span>来源：{{ formatSource(selectedDetail.sourceUrl) }}</span>
          <span>运行时：{{ formatRuntimeKind(selectedDetail.runtimeKind) }}</span>
          <span>清单版本：{{ selectedDetail.manifestVersion || "-" }}</span>
          <span v-if="selectedDetail.category">分类：{{ formatMarketCategory(selectedDetail.category) }}</span>
          <span v-if="selectedTags.length">标签：{{ selectedTags.join(" / ") }}</span>
        </div>

        <section class="plugin-detail__section">
          <h4>权限</h4>
          <div v-if="selectedPermissions.length" class="plugin-card__badges">
            <el-tag v-for="permission in selectedPermissions" :key="permission" size="small" effect="plain">
              {{ formatPermissionLabel(permission) }}
            </el-tag>
          </div>
          <p v-else>无需额外权限</p>
        </section>

        <section class="plugin-detail__section">
          <h4>任务</h4>
          <div v-if="selectedTaskRows.length" class="plugin-detail__list">
            <div v-for="task in selectedTaskRows" :key="task.id" class="plugin-detail__item">
              <div>
                <strong>{{ task.name }}</strong>
                <span>{{ task.description || formatSchedule(task) }}</span>
                <span v-if="task.entrypoint">入口：{{ task.entrypoint }}</span>
              </div>
              <div class="plugin-detail__item-actions">
                <el-tag effect="light">{{ task.enabled === false ? "停用" : "启用" }}</el-tag>
                <el-button
                  v-if="selectedInstalledItem"
                  size="small"
                  :loading="operatingId === task.id"
                  @click="runTask(task.id)"
                >
                  运行
                </el-button>
              </div>
            </div>
          </div>
          <p v-else>暂无任务</p>
        </section>

        <section v-if="selectedInstalledItem" class="plugin-detail__section">
          <h4>最近运行</h4>
          <div v-if="selectedLogRows.length" class="plugin-detail__list">
            <div v-for="log in selectedLogRows" :key="log.id" class="plugin-detail__item">
              <div>
                <strong>{{ log.taskName || log.taskId || log.runType || "未知任务" }}</strong>
                <span>{{ formatTime(log.startedAt) }} · {{ formatDuration(log.durationMs) }}</span>
                <span v-if="log.error" class="plugin-error">{{ log.error }}</span>
                <span v-else-if="log.output">{{ stringifyOutput(log.output) }}</span>
              </div>
              <el-tag :type="log.status === 'success' || log.status === 'ok' ? 'success' : 'danger'">
                {{ log.status }}
              </el-tag>
            </div>
          </div>
          <p v-else>暂无日志</p>
        </section>
      </div>
      <template #footer>
        <el-button @click="detailOpen = false">关闭</el-button>
        <el-button
          v-if="selectedCatalogItem && !selectedInstalledItem"
          type="primary"
          :loading="operatingId === selectedCatalogItem.id"
          @click="installCatalogPlugin(selectedCatalogItem.id)"
        >
          安装
        </el-button>
        <el-button
          v-if="selectedCatalogItem && selectedInstalledItem && hasSelectedUpdate"
          type="primary"
          :loading="operatingId === selectedCatalogItem.id"
          @click="updateInstalledPlugin(selectedCatalogItem.id)"
        >
          更新到 v{{ selectedCatalogItem.version }}
        </el-button>
        <el-button
          v-if="selectedInstalledItem"
          :loading="operatingId === selectedInstalledItem.pluginId"
          @click="togglePlugin(selectedInstalledItem)"
        >
          {{ selectedInstalledItem.status === "enabled" ? "停用" : "启用" }}
        </el-button>
        <el-button
          v-if="selectedInstalledItem"
          type="danger"
          :loading="operatingId === selectedInstalledItem.pluginId"
          @click="removePlugin(selectedInstalledItem)"
        >
          卸载
        </el-button>
      </template>
    </el-dialog>
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
import { readSettings, saveSettings } from "@/api/settings";
import type { InstalledPluginSummary, PluginCatalogEntry, PluginRunLogSummary, PluginTaskSummary } from "@/types/common";

const catalogFilter = ref("installed");
const loading = ref(false);
const savingMarket = ref(false);
const operatingId = ref("");
const detailOpen = ref(false);
const selectedPluginId = ref("");
const selectedPluginKind = ref<"catalog" | "installed">("catalog");
const marketMode = ref("builtin");
const sourceUrl = ref("");
const catalog = ref<PluginCatalogEntry[]>([]);
const installed = ref<InstalledPluginSummary[]>([]);
const tasks = ref<PluginTaskSummary[]>([]);
const logs = ref<PluginRunLogSummary[]>([]);
const pluginViewFilterOptions = [
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
const catalogMap = computed<Record<string, PluginCatalogEntry>>(() =>
  catalog.value.reduce<Record<string, PluginCatalogEntry>>((result, item) => {
    result[item.id] = item;
    return result;
  }, {}),
);
const installedPluginIds = computed(() => new Set(installed.value.map((item) => item.pluginId)));
const notInstalledCatalogItems = computed(() =>
  catalog.value.filter((item) => !installedPluginIds.value.has(item.id)),
);
const updatableVersionByPluginId = computed<Record<string, string>>(() =>
  installed.value.reduce<Record<string, string>>((result, item) => {
    const catalogItem = catalogMap.value[item.pluginId];
    if (catalogItem && compareVersion(catalogItem.version, item.version) > 0) {
      result[item.pluginId] = catalogItem.version;
    }
    return result;
  }, {}),
);
const updatableInstalledItems = computed(() =>
  installed.value.filter((item) => Boolean(updatableVersionByPluginId.value[item.pluginId])),
);
const selectedCatalogItem = computed(() => catalogMap.value[selectedPluginId.value] || null);
const selectedInstalledItem = computed(() => installedMap.value[selectedPluginId.value] || null);
const selectedDetail = computed<PluginCatalogEntry | InstalledPluginSummary | null>(() =>
  selectedPluginKind.value === "installed"
    ? selectedInstalledItem.value || selectedCatalogItem.value
    : selectedCatalogItem.value || selectedInstalledItem.value,
);
const selectedPermissions = computed(() => selectedDetail.value?.permissions || []);
const selectedTags = computed(() => selectedDetail.value?.tags || []);
const selectedTaskRows = computed<PluginTaskSummary[]>(() => {
  if (selectedInstalledItem.value) {
    return tasks.value.filter((task) => task.pluginId === selectedInstalledItem.value?.pluginId);
  }
  return (selectedCatalogItem.value?.tasks || []).map((task, index) => ({
    id: `${selectedCatalogItem.value?.id || "catalog"}-${task.name || index}`,
    pluginId: selectedCatalogItem.value?.id || "",
    pluginName: selectedCatalogItem.value?.name || "",
    name: task.name || `任务 ${index + 1}`,
    description: task.description || null,
    entrypoint: task.entrypoint || null,
    scheduleKind: task.scheduleKind || null,
    intervalSeconds: task.intervalSeconds || null,
    enabled: true,
  }));
});
const selectedLogRows = computed(() =>
  logs.value.filter((log) => log.pluginId === selectedPluginId.value).slice(0, 5),
);
const hasSelectedUpdate = computed(() => {
  if (!selectedCatalogItem.value || !selectedInstalledItem.value) return false;
  return compareVersion(selectedCatalogItem.value.version, selectedInstalledItem.value.version) > 0;
});
const customMarketHint = computed(() =>
  sourceUrl.value
    ? `当前使用自定义源：${sourceUrl.value}`
    : "当前使用自定义源，适合接入你自己的 JSON 市场文件。",
);

function normalizeMarketMode(value: unknown) {
  return String(value || "").trim() === "custom" ? "custom" : "builtin";
}

function pluginFilterCount(value: string) {
  if (value === "installed") return installed.value.length;
  if (value === "update") return updatableInstalledItems.value.length;
  return notInstalledCatalogItems.value.length;
}

async function loadSettings() {
  try {
    const settings = await readSettings();
    marketMode.value = normalizeMarketMode(settings.pluginMarketMode ?? settings.plugin_market_mode);
    sourceUrl.value = String(settings.pluginMarketSourceUrl ?? settings.plugin_market_source_url ?? "");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function saveMarketSettings() {
  savingMarket.value = true;
  try {
    await saveSettings({
      pluginMarketMode: normalizeMarketMode(marketMode.value),
      pluginMarketSourceUrl: sourceUrl.value,
    });
    ElMessage.success("插件市场设置已保存");
    await loadData(true);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingMarket.value = false;
  }
}

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

async function operate(pluginId: string, action: () => Promise<unknown>, message: string, afterSuccess?: () => void) {
  operatingId.value = pluginId;
  try {
    await action();
    afterSuccess?.();
    ElMessage.success(message);
    await loadData(false);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    operatingId.value = "";
  }
}

function installCatalogPlugin(pluginId: string) {
  void operate(pluginId, () => installPlugin(pluginId), "插件已安装", () => {
    catalogFilter.value = "installed";
  });
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

function openCatalogDetail(item: PluginCatalogEntry) {
  selectedPluginId.value = item.id;
  selectedPluginKind.value = "catalog";
  detailOpen.value = true;
}

function openInstalledDetail(item: InstalledPluginSummary) {
  selectedPluginId.value = item.pluginId;
  selectedPluginKind.value = "installed";
  detailOpen.value = true;
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

function formatSource(value?: string | null) {
  if (!value) return "内置市场";
  if (value === "builtin://codexmanager") return "内置精选市场";
  return value;
}

function formatCatalogSource(value?: string | null) {
  return value === "builtin://codexmanager"
    ? "来源：内置精选市场"
    : value
    ? `来源：${value}`
    : "内置市场";
}

function formatInstalledSource(value?: string | null) {
  return value === "builtin://codexmanager"
    ? "来源：内置精选市场"
    : value
    ? `来源：${value}`
    : "内置安装";
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

function formatDuration(value?: number | null) {
  if (value == null) return "-";
  if (value >= 10_000) return `${Math.round(value / 1000)}s`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.round(value)}ms`;
}

function stringifyOutput(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compareVersion(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

onMounted(() => {
  void loadSettings();
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

  .plugin-market-card,
  .plugin-list-card,
  .market-mode-card,
  .plugin-filter-button,
  .plugin-card,
  .plugin-table-card {
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--card-bg);
    box-shadow: var(--shadow-card);
  }

  .plugin-market-card,
  .plugin-list-card {
    display: grid;
    gap: 16px;
    padding: 18px;

    &__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;

      h3 {
        margin: 0;
        font-size: 17px;
        font-weight: 700;
      }

      p {
        max-width: 760px;
        margin: 6px 0 0;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.7;
      }
    }
  }

  .market-mode-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .market-mode-card {
    position: relative;
    display: grid;
    gap: 6px;
    min-height: 96px;
    padding: 16px;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: 0.2s ease;

    span {
      font-weight: 700;
    }

    small {
      max-width: 520px;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.7;
    }

    .el-tag {
      position: absolute;
      top: 12px;
      right: 12px;
    }

    &--active {
      border-color: rgba(47, 108, 246, 0.35);
      background: rgba(47, 108, 246, 0.08);
    }
  }

  .market-source-row {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) auto auto;
    gap: 10px;
    align-items: center;
  }

  .market-source-hint {
    padding: 14px;
    border: 1px dashed var(--border-subtle);
    border-radius: 12px;
    background: var(--table-section-bg);
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.7;
  }

  .plugin-filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .plugin-filter-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 12px;
    color: var(--text-secondary);
    cursor: pointer;

    &--active {
      border-color: rgba(47, 108, 246, 0.35);
      background: rgba(47, 108, 246, 0.08);
      color: var(--primary);
    }
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

      > div:first-child {
        min-width: 0;
      }

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
    &__badges,
    &__actions,
    &__status {
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

    &__actions {
      justify-content: flex-end;
    }

    &__status {
      justify-content: flex-end;
      flex-shrink: 0;
      max-width: 240px;
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

  .plugin-detail {
    display: grid;
    gap: 16px;

    &__head {
      display: flex;
      justify-content: space-between;
      gap: 16px;

      p {
        margin: 8px 0 0;
        color: var(--text-secondary);
        font-size: 13px;
        line-height: 1.7;
      }
    }

    &__title,
    &__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    &__title {
      strong {
        font-size: 18px;
      }
    }

    &__meta {
      color: var(--text-secondary);
      font-size: 12px;
    }

    &__section {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      background: var(--table-section-bg);

      h4,
      p {
        margin: 0;
      }

      p {
        color: var(--text-secondary);
        font-size: 13px;
      }
    }

    &__list {
      display: grid;
      gap: 10px;
    }

    &__item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--card-bg);

      > div:first-child {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      span {
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.6;
        word-break: break-word;
      }
    }

    &__item-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
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

    .market-mode-grid,
    .market-source-row {
      grid-template-columns: 1fr;
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
