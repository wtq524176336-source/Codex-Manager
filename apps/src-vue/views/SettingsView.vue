<template>
  <div class="page settings-page">
    <div class="page-hero">
      <div>
        <h2 class="page-hero__title">系统设置</h2>
        <p class="page-hero__desc">
          管理应用行为、网关策略及后台任务
        </p>
      </div>
      <div class="table-actions">
        <el-button :loading="loading" @click="loadData">刷新</el-button>
        <el-button type="primary" :loading="saving" @click="saveGeneral">保存基础设置</el-button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">服务地址</div>
        <div class="summary-card__value summary-card__value--small">{{ form.serviceAddr || "-" }}</div>
        <div class="summary-card__hint">Tauri RPC addr</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">监听模式</div>
        <div class="summary-card__value summary-card__value--small">{{ listen.mode || "-" }}</div>
        <div class="summary-card__hint">{{ listen.requiresRestart ? "保存后需重启" : "即时生效" }}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">路由策略</div>
        <div class="summary-card__value summary-card__value--small">{{ route.strategy || "-" }}</div>
        <div class="summary-card__hint">账号选路</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">外观</div>
        <div class="summary-card__value summary-card__value--small">{{ form.theme || "default" }}</div>
        <div class="summary-card__hint">{{ form.lowTransparency ? "低透明模式" : "玻璃模式" }}</div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="通用" name="general">
        <div class="page-card">
          <div class="page-card__body form-grid">
            <el-input v-model="form.serviceAddr" label="服务地址" placeholder="localhost:48760">
              <template #prepend>服务地址</template>
            </el-input>
            <el-input v-model="form.language" placeholder="zh-CN">
              <template #prepend>语言</template>
            </el-input>
            <el-input v-model="form.codexHome" placeholder="Codex Home，可空">
              <template #prepend>Codex Home</template>
            </el-input>
            <el-input v-model="form.webPassword" show-password placeholder="Web 密码，可空">
              <template #prepend>Web 密码</template>
            </el-input>
            <div class="setting-row">
              <span>关闭窗口时最小化到托盘</span>
              <el-switch v-model="form.closeToTrayOnClose" />
            </div>
            <div class="setting-row">
              <span>Codex CLI 引导</span>
              <el-switch v-model="form.codexCliGuideEnabled" />
            </div>
          </div>
        </div>

        <div class="page-card">
          <div class="page-card__body">
            <h3>应用更新</h3>
            <div class="update-panel">
              <div class="name-cell">
                <strong>{{ updateTitle }}</strong>
                <span>{{ updateDescription }}</span>
                <span v-if="updateStatus.lastError" class="danger-text">
                  {{ updateStatus.lastError }}
                </span>
              </div>
              <div class="table-actions">
                <el-button :loading="checkingUpdate" @click="runCheckUpdate">检查更新</el-button>
                <el-button
                  v-if="canPrepareUpdate"
                  type="primary"
                  :loading="preparingUpdate"
                  @click="runPrepareUpdate"
                >
                  下载更新
                </el-button>
                <el-button
                  v-if="preparedUpdate"
                  type="danger"
                  :loading="applyingUpdate"
                  @click="runApplyUpdate"
                >
                  {{ preparedUpdate.isPortable ? "替换更新" : "启动安装器" }}
                </el-button>
                <el-button v-if="lastUpdateCheck" @click="openReleasePage">发布页</el-button>
                <el-button v-if="preparedUpdate" @click="openLogsDir">日志目录</el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="page-card">
          <div class="page-card__body">
            <h3>服务监听</h3>
            <div class="form-grid">
              <el-select v-model="listen.mode" placeholder="监听模式">
                <el-option
                  v-for="mode in listen.options"
                  :key="mode"
                  :label="listenLabel(mode)"
                  :value="mode"
                />
              </el-select>
              <el-button type="primary" :loading="savingListen" @click="saveListen">保存监听模式</el-button>
            </div>
            <p class="dialog-hint">`loopback` 仅本机访问，`all_interfaces` 允许局域网设备访问。</p>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="外观" name="appearance">
        <div class="page-card">
          <div class="page-card__body">
            <div class="form-grid">
              <el-select v-model="form.appearancePreset" placeholder="样式版本">
                <el-option
                  v-for="option in appearancePresetOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-select v-model="form.theme" placeholder="主题">
                <el-option
                  v-for="option in themeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                >
                  <span class="theme-option">
                    <span class="theme-option__swatch" :style="{ backgroundColor: option.color }"></span>
                    <span>{{ option.label }}</span>
                  </span>
                </el-option>
              </el-select>
              <div class="setting-row">
                <span>低透明性能模式</span>
                <el-switch v-model="form.lowTransparency" />
              </div>
            </div>
            <div class="appearance-preview">
              <div class="preview-card">CodexManager</div>
              <div class="preview-card preview-card--accent">Gateway</div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="网关" name="gateway">
        <div class="page-card">
          <div class="page-card__body">
            <h3>网关策略</h3>
            <div class="form-grid">
              <el-select v-model="route.strategy" placeholder="路由策略">
                <el-option
                  v-for="option in route.options"
                  :key="option"
                  :label="routeLabel(option)"
                  :value="option"
                />
              </el-select>
              <el-button type="primary" :loading="savingRoute" @click="saveRoute">保存路由策略</el-button>
              <el-input v-model="proxy.proxyUrl" placeholder="上游代理 URL，可空">
                <template #prepend>上游代理</template>
              </el-input>
              <el-button type="primary" :loading="savingProxy" @click="saveProxy">保存代理</el-button>
            </div>
          </div>
        </div>

        <div class="page-card">
          <div class="page-card__body">
            <h3>传输参数</h3>
            <div class="form-grid">
              <el-input-number
                v-model="transport.sseKeepaliveIntervalMs"
                :min="0"
                controls-position="right"
                placeholder="SSE Keepalive ms"
              />
              <el-input-number
                v-model="transport.upstreamStreamTimeoutMs"
                :min="0"
                controls-position="right"
                placeholder="流式超时 ms"
              />
              <el-input-number
                v-model="transport.upstreamTotalTimeoutMs"
                :min="0"
                controls-position="right"
                placeholder="总超时 ms"
              />
              <el-button type="primary" :loading="savingTransport" @click="saveTransport">
                保存传输参数
              </el-button>
            </div>
          </div>
        </div>

        <div class="page-card">
          <div class="page-card__body">
            <h3>高级网关行为</h3>
            <div class="form-grid">
              <el-select v-model="form.freeAccountMaxModel" placeholder="Free 账号使用模型">
                <el-option
                  v-for="model in freeAccountModelOptions"
                  :key="model"
                  :label="freeAccountModelLabel(model)"
                  :value="model"
                />
              </el-select>
              <el-select v-model="form.gatewayResidencyRequirement" placeholder="区域驻留要求">
                <el-option label="不限制" value="" />
                <el-option
                  v-for="option in form.gatewayResidencyRequirementOptions"
                  :key="option"
                  :label="residencyLabel(option)"
                  :value="option"
                />
              </el-select>
              <el-input v-model="form.gatewayOriginator" placeholder="Codex Originator">
                <template #prepend>Originator</template>
              </el-input>
              <el-input v-model="form.trustedAuthOrigin" placeholder="可信 Auth Origin，可空">
                <template #prepend>Trusted Auth</template>
              </el-input>
              <el-input
                v-model="form.modelForwardRules"
                class="gateway-rules"
                type="textarea"
                :autosize="{ minRows: 5, maxRows: 12 }"
                placeholder="spark*=gpt-5.4-mini&#10;claude-sonnet-4*=gpt-5.4"
              />
              <div class="settings-help">
                <strong>模型转发规则</strong>
                <span>一行一条，格式为 源模型=目标模型，支持 * 通配；平台密钥未强绑模型时先应用这里。</span>
                <span>默认 Originator：{{ form.gatewayOriginatorDefault || "-" }}</span>
              </div>
              <el-button type="primary" :loading="savingGatewayAdvanced" @click="saveGatewayAdvanced">
                保存高级网关行为
              </el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="任务" name="tasks">
        <div class="page-card">
          <div class="page-card__body">
            <h3>后台任务配置</h3>
            <div class="worker-mode">
              <el-radio-group v-model="workerMode" :disabled="recommendingWorkers" @change="applyWorkerMode">
                <el-radio-button label="recommended">推荐</el-radio-button>
                <el-radio-button label="light">省资源</el-radio-button>
                <el-radio-button label="performance">高吞吐</el-radio-button>
                <el-radio-button label="custom">自定义</el-radio-button>
              </el-radio-group>
              <div class="worker-mode__summary">
                <span>{{ workerModeSummary }}</span>
                <el-button size="small" :loading="recommendingWorkers" @click="applyRecommendedWorkerMode">
                  系统推导
                </el-button>
              </div>
            </div>
            <div class="task-grid">
              <div class="task-card" v-for="task in taskRows" :key="task.enabledKey">
                <div>
                  <strong>{{ task.label }}</strong>
                  <span>{{ task.helper }}</span>
                </div>
                <el-switch v-model="taskForm[task.enabledKey]" />
                <el-input-number
                  v-model="taskForm[task.intervalKey]"
                  :min="1"
                  controls-position="right"
                />
              </div>
            </div>
            <div class="form-grid worker-grid">
              <el-input-number v-model="taskForm.usageRefreshWorkers" :min="1" controls-position="right">
                <template #prefix>后台巡检并发</template>
              </el-input-number>
              <el-input-number v-model="taskForm.httpWorkerFactor" :min="1" controls-position="right">
                <template #prefix>普通请求倍率</template>
              </el-input-number>
              <el-input-number v-model="taskForm.httpWorkerMin" :min="1" controls-position="right">
                <template #prefix>普通请求保底</template>
              </el-input-number>
              <el-input-number v-model="taskForm.httpStreamWorkerFactor" :min="1" controls-position="right">
                <template #prefix>流式请求倍率</template>
              </el-input-number>
              <el-input-number v-model="taskForm.httpStreamWorkerMin" :min="1" controls-position="right">
                <template #prefix>流式请求保底</template>
              </el-input-number>
            </div>
            <el-input
              v-model="backgroundTasksDraft"
              type="textarea"
              :autosize="{ minRows: 12, maxRows: 20 }"
              placeholder="后台任务 JSON"
            />
            <div class="table-footer">
              <span>保留旧版后台任务线程、轮询间隔和运行模式配置入口。</span>
              <el-button type="primary" :loading="savingTasks" @click="saveTasks">保存后台任务</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="环境" name="env">
        <div class="page-card">
          <div class="page-card__body">
            <div class="filter-bar env-filter">
              <el-input v-model="envKeyword" clearable placeholder="搜索环境变量 / 设置项" />
              <el-button
                :disabled="!hasCustomizedEnvOverrides"
                :loading="savingEnv"
                @click="resetAllEnvOverrides"
              >
                全部恢复默认
              </el-button>
            </div>
            <div class="env-catalog-layout">
              <div class="env-list">
                <button
                  v-for="item in filteredEnvCatalog"
                  :key="item.key"
                  type="button"
                  class="env-list__item"
                  :class="{ 'env-list__item--active': selectedEnvKey === item.key }"
                  @click="selectedEnvKey = item.key"
                >
                  <span>
                    <strong>{{ item.label }}</strong>
                    <code>{{ item.key }}</code>
                  </span>
                  <el-tag size="small" :type="riskTagType(item.riskLevel)" effect="light">
                    {{ riskLabel(item.riskLevel) }}
                  </el-tag>
                </button>
              </div>

              <div v-if="selectedEnvItem" class="env-editor">
                <div class="env-editor__head">
                  <div>
                    <h3>{{ selectedEnvItem.label }}</h3>
                    <code>{{ selectedEnvItem.key }}</code>
                  </div>
                  <div class="env-editor__tags">
                    <el-tag :type="riskTagType(selectedEnvItem.riskLevel)" effect="light">
                      {{ riskLabel(selectedEnvItem.riskLevel) }}
                    </el-tag>
                    <el-tag effect="plain">{{ effectScopeLabel(selectedEnvItem.effectScope) }}</el-tag>
                    <el-tag effect="plain">{{ selectedEnvItem.applyMode || "runtime" }}</el-tag>
                  </div>
                </div>
                <p class="env-editor__note">{{ selectedEnvItem.safetyNote || envDescription(selectedEnvItem) }}</p>
                <el-input v-model="selectedEnvValue" class="env-editor__input" placeholder="输入变量值" />
                <div class="env-editor__default">
                  默认值：<span class="mono">{{ selectedEnvItem.defaultValue || "空" }}</span>
                </div>
                <div class="table-actions">
                  <el-button
                    :loading="savingEnv"
                    type="primary"
                    @click="saveSelectedEnvOverride"
                  >
                    保存当前变量
                  </el-button>
                  <el-button :loading="savingEnv" @click="resetSelectedEnvOverride">恢复默认</el-button>
                </div>
              </div>
              <div v-else class="empty-hint">没有匹配的环境配置项</div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref, watch } from "vue";

import { getErrorMessage } from "@/api/http";
import {
  getGatewayConcurrencyRecommendation,
  readBackgroundTasks,
  readGatewayTransport,
  readListenConfig,
  readRouteStrategy,
  readSettings,
  readUpstreamProxy,
  saveBackgroundTasks,
  saveGatewayTransport,
  saveListenConfig,
  saveRouteStrategy,
  saveSettings,
  saveUpstreamProxy,
  type GatewayConcurrencyRecommendation,
} from "@/api/settings";
import { setServiceAddr } from "@/api/transport";
import {
  applyPortableUpdate,
  checkUpdate,
  getUpdateStatus,
  launchInstallerUpdate,
  openUpdateLogsDir,
  prepareUpdate,
  type UpdateCheckResult,
  type UpdatePrepareResult,
  type UpdateStatusResult,
} from "@/api/update";
import { openInBrowser } from "@/api/system";
import { useAppStore } from "@/stores/app";
import {
  appearancePresetOptions,
  applyAppearanceSettings,
  normalizeAppearancePresetValue,
  normalizeThemeValue,
  themeOptions,
} from "@/styles/appearance";
import type {
  GatewayRouteStrategySettings,
  GatewayTransportSettings,
  GatewayUpstreamProxySettings,
  ServiceListenConfig,
} from "@/types/common";

interface EnvCatalogItem {
  key: string;
  label: string;
  scope: string;
  applyMode: string;
  defaultValue: string;
  riskLevel: string;
  effectScope: string;
  safetyNote: string;
}

const appStore = useAppStore();
const settingsTabs = ["general", "appearance", "gateway", "tasks", "env"] as const;
const settingsActiveTabKey = "codexmanager.settings.active-tab";

function readInitialSettingsTab() {
  const savedTab = window.sessionStorage.getItem(settingsActiveTabKey);
  if (savedTab && settingsTabs.includes(savedTab as (typeof settingsTabs)[number])) {
    return savedTab;
  }
  return "general";
}

const activeTab = ref(readInitialSettingsTab());
const loading = ref(false);
const saving = ref(false);
const savingListen = ref(false);
const savingRoute = ref(false);
const savingProxy = ref(false);
const savingTransport = ref(false);
const savingGatewayAdvanced = ref(false);
const savingTasks = ref(false);
const savingEnv = ref(false);
const recommendingWorkers = ref(false);
const checkingUpdate = ref(false);
const preparingUpdate = ref(false);
const applyingUpdate = ref(false);
const envKeyword = ref("");
const backgroundTasksDraft = ref("{}");
const envOverrides = ref<Record<string, string>>({});
const envCatalog = ref<EnvCatalogItem[]>([]);
const selectedEnvKey = ref("");
const envDrafts = ref<Record<string, string>>({});
const rawSettings = ref<Record<string, unknown>>({});
const lastUpdateCheck = ref<UpdateCheckResult | null>(null);
const preparedUpdate = ref<UpdatePrepareResult | null>(null);
const updateStatus = reactive<UpdateStatusResult>({
  repo: "",
  mode: "",
  isPortable: false,
  currentVersion: "",
  currentExePath: "",
  portableMarkerPath: "",
  pending: null,
  lastCheck: null,
  lastError: null,
});
const form = reactive({
  serviceAddr: "localhost:48760",
  language: "zh-CN",
  codexHome: "",
  webPassword: "",
  closeToTrayOnClose: false,
  codexCliGuideEnabled: false,
  appearancePreset: "classic",
  theme: "tech",
  lowTransparency: false,
  freeAccountMaxModel: "auto",
  freeAccountMaxModelOptions: [] as string[],
  modelForwardRules: "",
  gatewayOriginator: "",
  gatewayOriginatorDefault: "",
  trustedAuthOrigin: "",
  gatewayResidencyRequirement: "",
  gatewayResidencyRequirementOptions: [] as string[],
});
const listen = reactive<ServiceListenConfig>({
  mode: "loopback",
  options: ["loopback", "all_interfaces"],
  requiresRestart: true,
});
const route = reactive<GatewayRouteStrategySettings>({
  strategy: "ordered",
  options: ["ordered", "balanced"],
  manualPreferredAccountId: "",
});
const proxy = reactive<GatewayUpstreamProxySettings>({
  proxyUrl: "",
  envKey: "",
  requiresRestart: false,
});
const transport = reactive<GatewayTransportSettings>({
  sseKeepaliveIntervalMs: 15000,
  upstreamStreamTimeoutMs: 300000,
  upstreamTotalTimeoutMs: 0,
});
const taskForm = reactive<Record<string, number | boolean>>({
  usagePollingEnabled: true,
  usagePollIntervalSecs: 900,
  gatewayKeepaliveEnabled: true,
  gatewayKeepaliveIntervalSecs: 300,
  tokenRefreshPollingEnabled: true,
  tokenRefreshPollIntervalSecs: 900,
  usageRefreshWorkers: 4,
  httpWorkerFactor: 4,
  httpWorkerMin: 8,
  httpStreamWorkerFactor: 1,
  httpStreamWorkerMin: 2,
});
const workerMode = ref("custom");
const workerRecommendation = ref<GatewayConcurrencyRecommendation | null>(null);
const defaultFreeAccountModelOptions = [
  "auto",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4-mini",
  "gpt-5.4",
];
const workerPresets = {
  recommended: {
    usageRefreshWorkers: 4,
    httpWorkerFactor: 4,
    httpWorkerMin: 8,
    httpStreamWorkerFactor: 1,
    httpStreamWorkerMin: 2,
  },
  light: {
    usageRefreshWorkers: 2,
    httpWorkerFactor: 2,
    httpWorkerMin: 4,
    httpStreamWorkerFactor: 1,
    httpStreamWorkerMin: 1,
  },
  performance: {
    usageRefreshWorkers: 6,
    httpWorkerFactor: 6,
    httpWorkerMin: 12,
    httpStreamWorkerFactor: 2,
    httpStreamWorkerMin: 4,
  },
} as const;
const taskRows = [
  {
    label: "用量轮询线程",
    helper: "定时刷新账号用量和额度状态。",
    enabledKey: "usagePollingEnabled",
    intervalKey: "usagePollIntervalSecs",
  },
  {
    label: "网关保活线程",
    helper: "维持网关后台保活和健康巡检。",
    enabledKey: "gatewayKeepaliveEnabled",
    intervalKey: "gatewayKeepaliveIntervalSecs",
  },
  {
    label: "令牌刷新轮询",
    helper: "定时刷新 ChatGPT AT/RT。",
    enabledKey: "tokenRefreshPollingEnabled",
    intervalKey: "tokenRefreshPollIntervalSecs",
  },
] as const;

const filteredEnvCatalog = computed(() => {
  const value = envKeyword.value.trim().toLowerCase();
  const rows = value
    ? envCatalog.value.filter((row) =>
        [row.key, row.label, row.scope, row.applyMode].some((part) =>
          part.toLowerCase().includes(value),
        ),
      )
    : envCatalog.value;
  return [...rows].sort(compareEnvCatalogItems);
});
const selectedEnvItem = computed(
  () => envCatalog.value.find((item) => item.key === selectedEnvKey.value) || null,
);
const selectedEnvValue = computed({
  get() {
    const item = selectedEnvItem.value;
    if (!item) return "";
    if (Object.prototype.hasOwnProperty.call(envDrafts.value, item.key)) {
      return envDrafts.value[item.key];
    }
    return envOverrides.value[item.key] ?? item.defaultValue ?? "";
  },
  set(value: string) {
    const item = selectedEnvItem.value;
    if (!item) return;
    envDrafts.value = { ...envDrafts.value, [item.key]: value };
  },
});
const hasCustomizedEnvOverrides = computed(() =>
  envCatalog.value.some((item) => {
    const effectiveValue = Object.prototype.hasOwnProperty.call(envDrafts.value, item.key)
      ? envDrafts.value[item.key]
      : envOverrides.value[item.key] ?? item.defaultValue ?? "";
    return effectiveValue !== (item.defaultValue ?? "");
  }),
);
const canPrepareUpdate = computed(
  () => Boolean(lastUpdateCheck.value?.hasUpdate && lastUpdateCheck.value.canPrepare && !preparedUpdate.value),
);
const workerModeSummary = computed(() => {
  if (workerMode.value === "recommended" && workerRecommendation.value) {
    return `按当前机器 ${workerRecommendation.value.cpuCores} 核 / ${formatMemoryMib(
      workerRecommendation.value.memoryMib,
    )} 推导后台和网关并发。`;
  }
  if (workerMode.value === "light") return "省资源档适合低配机器或小规模使用。";
  if (workerMode.value === "performance") return "高吞吐档适合资源充足和高峰值请求。";
  return "当前配置来自自定义参数或高级 JSON。";
});
const updateTitle = computed(() => {
  if (preparedUpdate.value) {
    return `更新已下载：${preparedUpdate.value.latestVersion || preparedUpdate.value.releaseTag}`;
  }
  if (lastUpdateCheck.value?.hasUpdate) {
    return `发现新版本：${lastUpdateCheck.value.latestVersion || lastUpdateCheck.value.releaseTag}`;
  }
  if (lastUpdateCheck.value) {
    return `当前版本：${lastUpdateCheck.value.currentVersion || updateStatus.currentVersion || "未知"}`;
  }
  return `当前版本：${updateStatus.currentVersion || "未知"}`;
});
const updateDescription = computed(() => {
  if (preparedUpdate.value) {
    return `更新包：${preparedUpdate.value.assetName || preparedUpdate.value.assetPath || "-"}`;
  }
  if (lastUpdateCheck.value?.reason) {
    return lastUpdateCheck.value.reason;
  }
  if (lastUpdateCheck.value?.publishedAt) {
    return `发布时间：${lastUpdateCheck.value.publishedAt}`;
  }
  return "可手动检查 GitHub Release 更新。";
});
const freeAccountModelOptions = computed(() =>
  form.freeAccountMaxModelOptions.length ? form.freeAccountMaxModelOptions : defaultFreeAccountModelOptions,
);

function readString(settings: Record<string, unknown>, key: string, fallback = "") {
  const value = settings[key];
  return typeof value === "string" ? value : fallback;
}

function readBoolean(settings: Record<string, unknown>, key: string, fallback = false) {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function readEnvCatalog(settings: Record<string, unknown>) {
  const value = settings.envOverrideCatalog;
  return Array.isArray(value)
    ? value
        .map((item) => {
          const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            key: String(source.key || "").trim(),
            label: String(source.label || source.key || "").trim(),
            scope: String(source.scope || "").trim(),
            applyMode: String(source.applyMode || source.apply_mode || "").trim(),
            defaultValue: String(source.defaultValue ?? source.default_value ?? ""),
            riskLevel: String(source.riskLevel || source.risk_level || "medium").trim(),
            effectScope: String(source.effectScope || source.effect_scope || "runtime-global").trim(),
            safetyNote: String(source.safetyNote || source.safety_note || "").trim(),
          };
        })
        .filter((item) => item.key)
    : [];
}

function riskOrder(value: string) {
  if (value === "high") return 0;
  if (value === "medium") return 1;
  if (value === "low") return 2;
  return 3;
}

function compareEnvCatalogItems(left: EnvCatalogItem, right: EnvCatalogItem) {
  const riskDelta = riskOrder(left.riskLevel) - riskOrder(right.riskLevel);
  return riskDelta || left.key.localeCompare(right.key);
}

function riskLabel(value: string) {
  if (value === "high") return "高风险";
  if (value === "low") return "低风险";
  return "中风险";
}

function riskTagType(value: string) {
  if (value === "high") return "danger";
  if (value === "low") return "success";
  return "warning";
}

function effectScopeLabel(value: string) {
  if (value === "deployment") return "部署级";
  if (value === "request-semantic") return "请求语义";
  return "运行时全局";
}

function envDescription(item: EnvCatalogItem) {
  return `${item.label} 对应环境变量，作用域 ${item.scope || "-"}，应用方式 ${item.applyMode || "runtime"}。`;
}

function readNumber(source: Record<string, unknown>, key: string, fallback: number) {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatMemoryMib(value: number) {
  if (value >= 1024) {
    return `${Math.round(value / 102.4) / 10} GiB`;
  }
  return `${value} MiB`;
}

function applySettings(settings: Record<string, unknown>) {
  rawSettings.value = settings;
  form.serviceAddr = readString(settings, "serviceAddr", "localhost:48760");
  form.language = readString(settings, "language", "zh-CN");
  form.codexHome = readString(settings, "codexHome");
  form.webPassword = readString(settings, "webPassword");
  form.closeToTrayOnClose = readBoolean(settings, "closeToTrayOnClose");
  form.codexCliGuideEnabled = readBoolean(settings, "codexCliGuideEnabled");
  form.appearancePreset = normalizeAppearancePresetValue(settings.appearancePreset);
  form.theme = normalizeThemeValue(settings.theme);
  form.lowTransparency = readBoolean(settings, "lowTransparency");
  applyAppearanceSettings({
    theme: form.theme,
    appearancePreset: form.appearancePreset,
    lowTransparency: form.lowTransparency,
  });
  form.freeAccountMaxModel = readString(settings, "freeAccountMaxModel", "auto");
  form.freeAccountMaxModelOptions = readStringArray(settings, "freeAccountMaxModelOptions");
  form.modelForwardRules = readString(settings, "modelForwardRules");
  form.gatewayOriginatorDefault = readString(settings, "gatewayOriginatorDefault");
  form.gatewayOriginator = readString(
    settings,
    "gatewayOriginator",
    form.gatewayOriginatorDefault,
  );
  form.trustedAuthOrigin = readString(settings, "trustedAuthOrigin");
  form.gatewayResidencyRequirement = readString(settings, "gatewayResidencyRequirement");
  form.gatewayResidencyRequirementOptions = readStringArray(
    settings,
    "gatewayResidencyRequirementOptions",
  );
  const envOverrideSource =
    settings.envOverrides && typeof settings.envOverrides === "object"
      ? (settings.envOverrides as Record<string, unknown>)
      : {};
  const nextEnvOverrides = Object.fromEntries(
    Object.entries(envOverrideSource).map(([key, value]) => [key, String(value ?? "")]),
  );
  envOverrides.value = nextEnvOverrides;
  envCatalog.value = readEnvCatalog(settings);
  if (!selectedEnvKey.value || !envCatalog.value.some((item) => item.key === selectedEnvKey.value)) {
    selectedEnvKey.value = envCatalog.value[0]?.key || "";
  }
}

function applyBackgroundTasks(settings: Record<string, unknown>) {
  const next = {
    usagePollingEnabled: readBoolean(settings, "usagePollingEnabled", true),
    usagePollIntervalSecs: readNumber(settings, "usagePollIntervalSecs", 900),
    gatewayKeepaliveEnabled: readBoolean(settings, "gatewayKeepaliveEnabled", true),
    gatewayKeepaliveIntervalSecs: readNumber(settings, "gatewayKeepaliveIntervalSecs", 300),
    tokenRefreshPollingEnabled: readBoolean(settings, "tokenRefreshPollingEnabled", true),
    tokenRefreshPollIntervalSecs: readNumber(settings, "tokenRefreshPollIntervalSecs", 900),
    usageRefreshWorkers: readNumber(settings, "usageRefreshWorkers", 4),
    httpWorkerFactor: readNumber(settings, "httpWorkerFactor", 4),
    httpWorkerMin: readNumber(settings, "httpWorkerMin", 8),
    httpStreamWorkerFactor: readNumber(settings, "httpStreamWorkerFactor", 1),
    httpStreamWorkerMin: readNumber(settings, "httpStreamWorkerMin", 2),
  };
  Object.assign(taskForm, next);
  backgroundTasksDraft.value = JSON.stringify({ ...settings, ...next }, null, 2);
  workerMode.value = detectWorkerMode();
}

function detectWorkerMode() {
  const recommendation = workerRecommendation.value;
  if (recommendation && workerPresetKeys.every((key) => Number(taskForm[key]) === recommendation[key])) {
    return "recommended";
  }
  for (const [mode, preset] of Object.entries(workerPresets)) {
    const matched = Object.entries(preset).every(([key, value]) => Number(taskForm[key]) === value);
    if (matched) return mode;
  }
  return "custom";
}

function applyWorkerMode(value: string | number | boolean | undefined) {
  if (String(value) === "recommended") {
    void applyRecommendedWorkerMode();
    return;
  }
  const preset = workerPresets[String(value) as keyof typeof workerPresets];
  if (!preset) {
    workerMode.value = "custom";
    return;
  }
  Object.assign(taskForm, preset);
  workerMode.value = String(value);
  syncBackgroundTasksDraft();
}

const workerPresetKeys = [
  "usageRefreshWorkers",
  "httpWorkerFactor",
  "httpWorkerMin",
  "httpStreamWorkerFactor",
  "httpStreamWorkerMin",
] as const;

function recommendedWorkerPatch(recommendation: GatewayConcurrencyRecommendation) {
  return {
    usageRefreshWorkers: recommendation.usageRefreshWorkers,
    httpWorkerFactor: recommendation.httpWorkerFactor,
    httpWorkerMin: recommendation.httpWorkerMin,
    httpStreamWorkerFactor: recommendation.httpStreamWorkerFactor,
    httpStreamWorkerMin: recommendation.httpStreamWorkerMin,
  };
}

function parseBackgroundTasksDraft() {
  return JSON.parse(backgroundTasksDraft.value || "{}") as Record<string, unknown>;
}

function buildBackgroundTasksPayload(patch: Record<string, unknown> = {}) {
  return { ...parseBackgroundTasksDraft(), ...taskForm, ...patch };
}

function syncBackgroundTasksDraft(patch: Record<string, unknown> = {}) {
  try {
    backgroundTasksDraft.value = JSON.stringify(buildBackgroundTasksPayload(patch), null, 2);
  } catch {
    backgroundTasksDraft.value = JSON.stringify({ ...taskForm, ...patch }, null, 2);
  }
}

async function applyRecommendedWorkerMode() {
  recommendingWorkers.value = true;
  try {
    const recommendation = await getGatewayConcurrencyRecommendation();
    workerRecommendation.value = recommendation;
    const patch = recommendedWorkerPatch(recommendation);
    Object.assign(taskForm, patch);
    workerMode.value = "recommended";
    syncBackgroundTasksDraft(patch);
    ElMessage.success("系统推导已应用到后台任务表单");
  } catch (error) {
    workerMode.value = detectWorkerMode();
    ElMessage.error(getErrorMessage(error));
  } finally {
    recommendingWorkers.value = false;
  }
}

function freeAccountModelLabel(value: string) {
  return !value || value === "auto" ? "跟随请求" : value;
}

function residencyLabel(value: string) {
  if (!value) return "不限制";
  if (value === "us") return "仅美国 (us)";
  return value;
}

function listenLabel(value: string) {
  if (value === "all_interfaces") return "开放给局域网";
  return "仅本机访问";
}

function routeLabel(value: string) {
  if (value === "balanced") return "均衡优先";
  return "顺序优先";
}

async function loadData() {
  loading.value = true;
  try {
    const [
      settings,
      listenResult,
      routeResult,
      proxyResult,
      transportResult,
      tasksResult,
      workerRecommendationResult,
    ] =
      await Promise.all([
        readSettings(),
        readListenConfig().catch(() => listen),
        readRouteStrategy().catch(() => route),
        readUpstreamProxy().catch(() => proxy),
        readGatewayTransport().catch(() => transport),
        readBackgroundTasks().catch(() => ({})),
        getGatewayConcurrencyRecommendation().catch(() => null),
      ]);
    applySettings(settings);
    workerRecommendation.value = workerRecommendationResult;
    Object.assign(listen, listenResult);
    Object.assign(route, routeResult);
    Object.assign(proxy, proxyResult);
    Object.assign(transport, transportResult);
    applyBackgroundTasks(tasksResult || {});
    await loadUpdateStatus();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function saveGatewayAdvanced() {
  savingGatewayAdvanced.value = true;
  try {
    await saveSettings({
      freeAccountMaxModel: form.freeAccountMaxModel || "auto",
      modelForwardRules: form.modelForwardRules,
      gatewayOriginator: form.gatewayOriginator,
      trustedAuthOrigin: form.trustedAuthOrigin,
      gatewayResidencyRequirement: form.gatewayResidencyRequirement,
    });
    ElMessage.success("高级网关行为已保存");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingGatewayAdvanced.value = false;
  }
}

async function loadUpdateStatus() {
  try {
    const status = await getUpdateStatus();
    Object.assign(updateStatus, status);
    lastUpdateCheck.value = status.lastCheck;
    preparedUpdate.value = status.pending;
  } catch {
    // 更新器不可用时不影响设置页其它配置。
  }
}

async function saveGeneral() {
  saving.value = true;
  try {
    await saveSettings({
      serviceAddr: form.serviceAddr,
      language: form.language,
      codexHome: form.codexHome,
      webPassword: form.webPassword,
      closeToTrayOnClose: form.closeToTrayOnClose,
      codexCliGuideEnabled: form.codexCliGuideEnabled,
      appearancePreset: form.appearancePreset,
      theme: form.theme,
      lowTransparency: form.lowTransparency,
    });
    setServiceAddr(form.serviceAddr);
    appStore.serviceAddr = form.serviceAddr;
    applyAppearanceSettings({
      theme: form.theme,
      appearancePreset: form.appearancePreset,
      lowTransparency: form.lowTransparency,
    });
    ElMessage.success("基础设置已保存");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function saveListen() {
  savingListen.value = true;
  try {
    Object.assign(listen, await saveListenConfig(listen.mode));
    ElMessage.success("监听模式已保存");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingListen.value = false;
  }
}

async function saveRoute() {
  savingRoute.value = true;
  try {
    await saveRouteStrategy(route.strategy);
    ElMessage.success("路由策略已保存");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingRoute.value = false;
  }
}

async function saveProxy() {
  savingProxy.value = true;
  try {
    Object.assign(proxy, await saveUpstreamProxy(proxy));
    ElMessage.success("上游代理已保存");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingProxy.value = false;
  }
}

async function saveTransport() {
  savingTransport.value = true;
  try {
    await saveGatewayTransport(transport);
    ElMessage.success("传输参数已保存");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingTransport.value = false;
  }
}

async function saveTasks() {
  savingTasks.value = true;
  try {
    const payload = buildBackgroundTasksPayload();
    await saveBackgroundTasks(payload);
    applyBackgroundTasks(payload);
    ElMessage.success("后台任务已保存");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingTasks.value = false;
  }
}

async function saveSelectedEnvOverride() {
  const item = selectedEnvItem.value;
  if (!item) return;
  savingEnv.value = true;
  try {
    await saveSettings({ envOverrides: { [item.key]: selectedEnvValue.value } });
    envDrafts.value = Object.fromEntries(
      Object.entries(envDrafts.value).filter(([key]) => key !== item.key),
    );
    ElMessage.success("环境变量已保存");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingEnv.value = false;
  }
}

async function resetSelectedEnvOverride() {
  const item = selectedEnvItem.value;
  if (!item) return;
  savingEnv.value = true;
  try {
    await saveSettings({ envOverrides: { [item.key]: "" } });
    envDrafts.value = Object.fromEntries(
      Object.entries(envDrafts.value).filter(([key]) => key !== item.key),
    );
    ElMessage.success("环境变量已恢复默认");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingEnv.value = false;
  }
}

async function resetAllEnvOverrides() {
  if (!envCatalog.value.length) return;
  await ElMessageBox.confirm("确定恢复全部环境配置项为默认值吗？", "恢复环境默认值", {
    type: "warning",
  });
  savingEnv.value = true;
  try {
    const patch = envCatalog.value.reduce<Record<string, string>>((target, item) => {
      target[item.key] = "";
      return target;
    }, {});
    await saveSettings({ envOverrides: patch });
    envDrafts.value = {};
    ElMessage.success("环境变量已全部恢复默认值");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingEnv.value = false;
  }
}

async function runCheckUpdate() {
  checkingUpdate.value = true;
  try {
    const result = await checkUpdate();
    lastUpdateCheck.value = result;
    preparedUpdate.value = null;
    ElMessage.success(
      result.hasUpdate
        ? `发现新版本 ${result.latestVersion || result.releaseTag}`
        : result.reason || "当前已是最新版本",
    );
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    checkingUpdate.value = false;
  }
}

async function runPrepareUpdate() {
  preparingUpdate.value = true;
  try {
    preparedUpdate.value = await prepareUpdate();
    ElMessage.success("更新包已下载完成");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    preparingUpdate.value = false;
  }
}

async function runApplyUpdate() {
  if (!preparedUpdate.value) return;
  await ElMessageBox.confirm(
    preparedUpdate.value.isPortable
      ? "确定立即替换更新并重启应用吗？"
      : "确定启动安装器更新当前应用吗？",
    "应用更新",
    { type: "warning" },
  );
  applyingUpdate.value = true;
  try {
    const result = preparedUpdate.value.isPortable
      ? await applyPortableUpdate()
      : await launchInstallerUpdate();
    ElMessage.success(result.message || "更新流程已启动");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    applyingUpdate.value = false;
  }
}

function buildReleaseUrl(check: UpdateCheckResult | null) {
  const repo = check?.repo || updateStatus.repo || "wtq524176336/Codex-Manager";
  const tag = check?.releaseTag || preparedUpdate.value?.releaseTag || "";
  return tag
    ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
    : `https://github.com/${repo}/releases`;
}

async function openReleasePage() {
  try {
    await openInBrowser(buildReleaseUrl(lastUpdateCheck.value));
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function openLogsDir() {
  try {
    await openUpdateLogsDir(preparedUpdate.value?.assetPath);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

watch(activeTab, (value) => {
  if (value && settingsTabs.includes(value as (typeof settingsTabs)[number])) {
    window.sessionStorage.setItem(settingsActiveTabKey, value);
  }
});

onMounted(loadData);
</script>

<style scoped lang="scss">
.settings-page {
  .settings-tabs {
    display: grid;
    gap: 16px;
  }

  h3 {
    margin: 0 0 14px;
    font-size: 16px;
  }

  .setting-row {
    display: flex;
    min-height: 40px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);
  }

  .update-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
  }

  .appearance-preview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-top: 18px;

    .preview-card {
      min-height: 96px;
      padding: 18px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--card-bg);
      box-shadow: var(--shadow-card);
      font-weight: 700;

      &--accent {
        background: linear-gradient(135deg, rgba(47, 108, 246, 0.12), rgba(16, 185, 129, 0.12));
      }
    }
  }

  .theme-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;

    &__swatch {
      width: 12px;
      height: 12px;
      border: 1px solid rgba(15, 23, 42, 0.16);
      border-radius: 999px;
    }
  }

  .env-filter {
    grid-template-columns: minmax(240px, 1fr) auto;
    margin-bottom: 16px;
  }

  .env-catalog-layout {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .env-list {
    display: grid;
    gap: 8px;
    max-height: 560px;
    overflow-y: auto;
    padding-right: 4px;

    &__item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--table-section-bg);
      color: inherit;
      text-align: left;
      cursor: pointer;

      &--active {
        border-color: rgba(47, 108, 246, 0.45);
        background: rgba(47, 108, 246, 0.08);
      }

      span {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      strong,
      code {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      strong {
        font-size: 13px;
      }

      code {
        color: var(--text-secondary);
        font-size: 11px;
      }
    }
  }

  .env-editor {
    display: grid;
    gap: 16px;
    min-height: 360px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);

    &__head {
      display: grid;
      gap: 10px;

      h3 {
        margin-bottom: 4px;
      }

      code {
        color: var(--text-secondary);
        font-size: 12px;
        overflow-wrap: anywhere;
      }
    }

    &__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    &__note {
      margin: 0;
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
    }

    &__input {
      max-width: 680px;
    }

    &__default {
      color: var(--text-secondary);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
  }

  .gateway-rules {
    grid-column: 1 / -1;
  }

  .settings-help {
    display: grid;
    gap: 6px;
    min-height: 80px;
    padding: 12px;
    border: 1px dashed var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);

    strong {
      color: var(--text-primary);
      font-size: 13px;
    }

    span {
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.6;
    }
  }

  .worker-mode {
    display: grid;
    gap: 10px;
    margin-bottom: 16px;

    &__summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--table-section-bg);

      span {
        min-width: 0;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.6;
      }
    }
  }

  .task-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  .task-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);

    > div {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    strong {
      color: var(--text-primary);
      font-size: 13px;
    }

    span {
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.5;
    }

    .el-input-number {
      grid-column: 1 / -1;
      width: 100%;
    }
  }

  .worker-grid {
    margin-bottom: 16px;
  }
}

@media (max-width: 760px) {
  .settings-page {
    .appearance-preview,
    .env-catalog-layout,
    .env-filter,
    .update-panel,
    .task-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
