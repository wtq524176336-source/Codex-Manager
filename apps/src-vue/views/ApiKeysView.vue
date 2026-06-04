<template>
  <div class="page apikey-page">
    <div class="page-hero">
      <div>
        <h2 class="page-hero__title">平台密钥</h2>
        <p class="page-hero__desc">
          创建本地网关密钥，配置绑定模型、协议、轮转策略和聚合 API 模式，并复制调用端点。
        </p>
      </div>
      <div class="table-actions">
        <el-dropdown trigger="click" @command="copyEndpoint">
          <el-button>
            网关端点
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="openai">复制 OpenAI / Codex 端点</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button type="primary" @click="openCreate">创建密钥</el-button>
      </div>
    </div>

    <div class="apikey-summary">
      <div class="summary-card summary-card--with-icon">
        <div class="summary-card__head">
          <span class="summary-card__label">密钥总数</span>
          <span class="summary-card__icon summary-card__icon--primary">
            <el-icon><Key /></el-icon>
          </span>
        </div>
        <div class="summary-card__value">{{ items.length }}</div>
        <div class="summary-card__hint">平台访问凭证</div>
      </div>
      <div class="summary-card summary-card--with-icon">
        <div class="summary-card__head">
          <span class="summary-card__label">启用中</span>
          <span class="summary-card__icon summary-card__icon--success">
            <el-icon><CircleCheck /></el-icon>
          </span>
        </div>
        <div class="summary-card__value">{{ enabledCount }}</div>
        <div class="summary-card__hint">可调用网关</div>
      </div>
      <div class="summary-card summary-card--with-icon">
        <div class="summary-card__head">
          <span class="summary-card__label">总使用 Token</span>
          <span class="summary-card__icon summary-card__icon--warning">
            <el-icon><Lightning /></el-icon>
          </span>
        </div>
        <div class="summary-card__value summary-card__value--small">{{ compact(totalTokens) }}</div>
        <div class="summary-card__hint">按全部平台密钥累计</div>
      </div>
      <div class="summary-card summary-card--with-icon">
        <div class="summary-card__head">
          <span class="summary-card__label">总费用</span>
          <span class="summary-card__icon summary-card__icon--success">
            <el-icon><Money /></el-icon>
          </span>
        </div>
        <div class="summary-card__value summary-card__value--small">{{ formatUsd(totalCost) }}</div>
        <div class="summary-card__hint">按全部平台密钥累计</div>
      </div>
    </div>

    <div class="endpoint-grid">
      <div class="endpoint-card" @click="copyText(openAiEndpoint)">
        <div class="endpoint-card__icon">
          <el-icon><Link /></el-icon>
        </div>
        <div class="endpoint-card__content">
          <strong>OpenAI / Codex 端点</strong>
          <code :title="openAiEndpoint">{{ openAiEndpoint }}</code>
        </div>
        <el-button text type="primary" @click.stop="copyText(openAiEndpoint)">
          <el-icon><CopyDocument /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="page-card page-card--flush">
      <div class="page-card__body">
        <div class="filter-bar apikey-filter">
          <el-input v-model="keyword" clearable placeholder="搜索名称 / ID / 模型 / 协议" />
          <el-select v-model="strategyFilter">
            <el-option label="全部策略" value="all" />
            <el-option label="账号轮转" value="account_rotation" />
            <el-option label="聚合API轮转" value="aggregate_api_rotation" />
            <el-option label="混合轮转" value="hybrid_rotation" />
          </el-select>
          <el-button :loading="loading" @click="loadData">刷新</el-button>
        </div>
      </div>
      <div class="table-scroll">
        <el-table v-loading="loading" :data="filteredItems" class="apikey-table">
          <el-table-column label="密钥 / ID" min-width="250">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ revealedSecrets[row.id] || row.keyPreview || "sk-********" }}</strong>
                <span class="mono">{{ row.id }}</span>
              </div>
              <div class="table-actions row-actions">
                <el-button link type="primary" :loading="loadingSecretId === row.id" @click="toggleSecret(row.id)">
                  {{ revealedSecrets[row.id] ? "隐藏" : "显示" }}
                </el-button>
                <el-button link type="primary" @click="copyText(revealedSecrets[row.id] || row.keyPreview || row.id)">
                  复制
                </el-button>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="名称" min-width="150">
            <template #default="{ row }">{{ row.name || "未命名" }}</template>
          </el-table-column>
          <el-table-column label="协议" width="120">
            <template #default="{ row }">
              <el-tag effect="light">{{ row.protocol || row.clientType || "openai_compat" }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="轮转策略" width="170">
            <template #default="{ row }">{{ rotationLabel(row.rotationStrategy) }}</template>
          </el-table-column>
          <el-table-column label="绑定模型" min-width="170">
            <template #default="{ row }">{{ row.modelSlug || row.model || "跟随请求" }}</template>
          </el-table-column>
          <el-table-column label="Token / 金额" width="150">
            <template #default="{ row }">
              <div class="name-cell">
                <strong class="mono">{{ compact(row.totalTokens || 0) }}</strong>
                <span>{{ formatUsd(row.estimatedCostUsd || 0) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-switch
                :model-value="isEnabled(row)"
                :loading="togglingId === row.id"
                @change="toggleStatus(row, $event)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="178" fixed="right" align="center">
            <template #default="{ row }">
              <div class="icon-actions">
                <el-tooltip content="切换策略" placement="top">
                  <el-button
                    text
                    :loading="switchingId === row.id"
                    @click="switchRotation(row)"
                  >
                    <el-icon><RefreshRight /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="编辑配置" placement="top">
                  <el-button text @click="openEdit(row)">
                    <el-icon><Setting /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="导入 ccswitch" placement="top">
                  <el-button
                    text
                    :loading="ccSwitchImportingId === row.id"
                    @click="importToCcSwitch(row)"
                  >
                    <el-icon><Position /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-dropdown trigger="click" @command="handleRowCommand($event, row)">
                  <el-button text>
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="switch">
                        {{ row.rotationStrategy === "aggregate_api_rotation" ? "切换为账号轮转" : "切换为聚合API轮转" }}
                      </el-dropdown-item>
                      <el-dropdown-item command="edit">设置模型与推理</el-dropdown-item>
                      <el-dropdown-item command="ccswitch">导入 ccswitch</el-dropdown-item>
                      <el-dropdown-item command="delete" class="danger-item">删除密钥</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="modalOpen" :title="editingId ? '编辑密钥' : '创建密钥'" width="720px">
      <div class="form-grid">
        <el-input v-model="form.name" placeholder="密钥名称" />
        <el-select v-model="form.modelSlug" filterable clearable placeholder="绑定模型">
          <el-option label="跟随请求" value="" />
          <el-option
            v-for="model in modelOptions"
            :key="model.value"
            :label="model.label"
            :value="model.value"
          />
        </el-select>
        <el-select v-model="form.rotationStrategy" placeholder="轮转策略">
          <el-option label="账号轮转" value="account_rotation" />
          <el-option label="聚合API轮转" value="aggregate_api_rotation" />
          <el-option label="混合轮转（账号优先）" value="hybrid_rotation" />
        </el-select>
        <el-select
          v-if="usesAggregateApi"
          v-model="form.aggregateApiId"
          clearable
          placeholder="指定聚合 API"
        >
          <el-option label="不指定" value="" />
          <el-option
            v-for="api in aggregateApis"
            :key="api.id"
            :label="api.supplierName || api.url"
            :value="api.id"
          />
        </el-select>
        <div v-else class="field-hint">账号轮转不指定聚合 API</div>
        <el-select v-model="form.reasoningEffort" clearable placeholder="推理等级">
          <el-option label="跟随请求" value="" />
          <el-option label="low" value="low" />
          <el-option label="medium" value="medium" />
          <el-option label="high" value="high" />
          <el-option label="xhigh" value="xhigh" />
        </el-select>
        <el-select v-model="form.serviceTier" clearable placeholder="服务等级">
          <el-option label="跟随请求" value="" />
          <el-option label="fast" value="fast" />
        </el-select>
        <el-select v-model="form.protocolType" placeholder="协议类型">
          <el-option label="OpenAI / Codex 兼容" value="openai_compat" />
        </el-select>
        <el-select v-if="usesAccountPlanFilter" v-model="form.accountPlanFilter" placeholder="账号类型过滤">
          <el-option label="全部账号" value="all" />
          <el-option label="Free" value="free" />
          <el-option label="Go" value="go" />
          <el-option label="Plus/Team" value="plus/team" />
          <el-option label="Pro" value="pro" />
          <el-option label="Business" value="business" />
          <el-option label="Enterprise" value="enterprise" />
          <el-option label="Edu" value="edu" />
          <el-option label="未知计划" value="unknown" />
        </el-select>
        <div v-else class="field-hint">聚合 API 轮转不使用账号类型过滤</div>
      </div>
      <div class="form-grid form-grid--single form-extra">
        <el-input v-model="form.upstreamBaseUrl" placeholder="上游 Base URL，可空" />
        <el-input
          v-model="form.staticHeadersJson"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="静态请求头 JSON，可空"
        />
      </div>
      <template #footer>
        <el-button @click="modalOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveApiKey">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createdSecretOpen" title="新密钥已创建" width="560px">
      <el-input :model-value="createdSecret" readonly />
      <p class="dialog-hint">请立即保存密钥明文；关闭后只能通过“显示”重新读取。</p>
      <template #footer>
        <el-button @click="copyText(createdSecret)">复制密钥</el-button>
        <el-button type="primary" @click="createdSecretOpen = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowDown,
  CircleCheck,
  CopyDocument,
  Key,
  Lightning,
  Link,
  Money,
  MoreFilled,
  Position,
  RefreshRight,
  Setting,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";

import { listAggregateApis } from "@/api/aggregateApi";
import {
  createApiKey,
  deleteApiKey,
  disableApiKey,
  enableApiKey,
  listApiKeyModels,
  listApiKeyUsageStats,
  listApiKeys,
  readApiKeySecret,
  updateApiKey,
  type ApiKeyPayload,
} from "@/api/apiKey";
import { getErrorMessage } from "@/api/http";
import { openInBrowser } from "@/api/system";
import { useAppStore } from "@/stores/app";
import type { AggregateApiSummary, ApiKeySummary } from "@/types/common";

const plusTeamPlanFilter = "plus/team";

const appStore = useAppStore();
const items = ref<ApiKeySummary[]>([]);
const aggregateApis = ref<AggregateApiSummary[]>([]);
const rawModels = ref<unknown[]>([]);
const keyword = ref("");
const strategyFilter = ref("all");
const loading = ref(false);
const saving = ref(false);
const togglingId = ref("");
const switchingId = ref("");
const ccSwitchImportingId = ref("");
const loadingSecretId = ref("");
const modalOpen = ref(false);
const createdSecretOpen = ref(false);
const createdSecret = ref("");
const editingId = ref("");
const revealedSecrets = ref<Record<string, string>>({});
const form = reactive({
  name: "",
  modelSlug: "",
  reasoningEffort: "",
  serviceTier: "",
  protocolType: "openai_compat",
  upstreamBaseUrl: "",
  staticHeadersJson: "",
  rotationStrategy: "account_rotation",
  aggregateApiId: "",
  accountPlanFilter: "all",
});

const modelOptions = computed(() =>
  rawModels.value
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const value = String(row.slug || row.id || "").trim();
      const label = String(row.displayName || row.name || row.slug || "").trim();
      const supportedInApi = row.supportedInApi ?? row.supported_in_api;
      const isSupported = typeof supportedInApi === "boolean" ? supportedInApi : true;
      return value ? { value, label: label || value, isSupported } : null;
    })
    .filter((item): item is { value: string; label: string; isSupported: boolean } => {
      if (!item) return false;
      return item.isSupported || item.value === form.modelSlug;
    }),
);
const filteredItems = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  return items.value.filter((item) => {
    const matchKeyword =
      !value ||
      [item.id, item.name, item.modelSlug, item.model, item.protocol, item.rotationStrategy].some(
        (part) => String(part || "").toLowerCase().includes(value),
      );
    const matchStrategy =
      strategyFilter.value === "all" || item.rotationStrategy === strategyFilter.value;
    return matchKeyword && matchStrategy;
  });
});
const enabledCount = computed(() => items.value.filter((item) => isEnabled(item)).length);
const totalTokens = computed(() =>
  items.value.reduce((sum, item) => sum + Math.max(0, Number(item.totalTokens) || 0), 0),
);
const totalCost = computed(() =>
  items.value.reduce((sum, item) => sum + Math.max(0, Number(item.estimatedCostUsd) || 0), 0),
);
const usesAggregateApi = computed(
  () =>
    form.rotationStrategy === "aggregate_api_rotation" ||
    form.rotationStrategy === "hybrid_rotation",
);
const usesAccountPlanFilter = computed(
  () =>
    form.rotationStrategy === "account_rotation" ||
    form.rotationStrategy === "hybrid_rotation",
);
const gatewayOrigin = computed(() => {
  const addr = appStore.serviceAddr || "localhost:48760";
  const value = addr.startsWith("http://") || addr.startsWith("https://") ? addr : `http://${addr}`;
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path.endsWith("/v1") ? path : `${path || ""}/v1`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:48760/v1";
  }
});
const openAiEndpoint = computed(() => gatewayOrigin.value);

function compact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Math.max(0, Number(value) || 0));
}

function rotationLabel(value?: string | null) {
  if (value === "aggregate_api_rotation") return "聚合API轮转";
  if (value === "hybrid_rotation") return "混合轮转";
  return "账号轮转";
}

function normalizePlanFilterValue(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "all";
  return normalized === "plus" || normalized === "team" ? plusTeamPlanFilter : normalized;
}

function normalizeEditableServiceTier(value?: string | null) {
  return String(value || "").trim().toLowerCase() === "fast" ? "fast" : "";
}

function normalizeEditableProtocolType(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "openai_compat";
  if (["codex", "openai", "openai_compat"].includes(normalized)) {
    return "openai_compat";
  }
  return "openai_compat";
}

function buildCcSwitchProviderName(name?: string | null, id?: string | null): string {
  const label = String(name || id || "Platform Key").trim();
  return label.toLowerCase().startsWith("codexmanager") ? label : `CodexManager - ${label}`;
}

function buildCcSwitchImportUrl(row: ApiKeySummary, apiKey: string): string {
  const params = new URLSearchParams({
    resource: "provider",
    app: "codex",
    name: buildCcSwitchProviderName(row.name, row.id),
    endpoint: gatewayOrigin.value,
    apiKey,
  });
  const model = String(row.modelSlug || row.model || "").trim();
  if (model) params.set("model", model);
  params.set("enabled", String(isEnabled(row)));
  params.set("notes", "Imported from CodexManager");
  return `ccswitch://v1/import?${params.toString()}`;
}

function isEnabled(row: ApiKeySummary) {
  return String(row.status || "").toLowerCase() !== "disabled";
}

async function loadData() {
  loading.value = true;
  try {
    const [keys, usageStats, apis, models] = await Promise.all([
      listApiKeys(),
      listApiKeyUsageStats().catch(() => []),
      listAggregateApis().catch(() => []),
      listApiKeyModels(false).catch(() => []),
    ]);
    const usageMap = new Map(usageStats.map((item) => [item.keyId, item]));
    items.value = keys.map((item) => {
      const usage = usageMap.get(item.id);
      return {
        ...item,
        totalTokens: usage?.totalTokens ?? item.totalTokens ?? 0,
        estimatedCostUsd: usage?.estimatedCostUsd ?? item.estimatedCostUsd ?? 0,
      };
    });
    aggregateApis.value = apis;
    rawModels.value = models;
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    name: "",
    modelSlug: "",
    reasoningEffort: "",
    serviceTier: "",
    protocolType: "openai_compat",
    upstreamBaseUrl: "",
    staticHeadersJson: "",
    rotationStrategy: "account_rotation",
    aggregateApiId: "",
    accountPlanFilter: "all",
  });
}

function openCreate() {
  editingId.value = "";
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: ApiKeySummary) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name || "",
    modelSlug: row.modelSlug || row.model || "",
    reasoningEffort: row.reasoningEffort || "",
    serviceTier: normalizeEditableServiceTier(row.serviceTier),
    protocolType: normalizeEditableProtocolType(row.protocol || row.clientType),
    upstreamBaseUrl: row.upstreamBaseUrl || "",
    staticHeadersJson: row.staticHeadersJson || "",
    rotationStrategy: row.rotationStrategy || "account_rotation",
    aggregateApiId: row.aggregateApiId || "",
    accountPlanFilter: normalizePlanFilterValue(row.accountPlanFilter),
  });
  modalOpen.value = true;
}

function readPayload(): ApiKeyPayload {
  return {
    name: form.name,
    modelSlug: !form.modelSlug || form.modelSlug === "auto" ? null : form.modelSlug,
    reasoningEffort:
      !form.reasoningEffort || form.reasoningEffort === "auto" ? null : form.reasoningEffort,
    serviceTier: normalizeEditableServiceTier(form.serviceTier),
    protocolType: form.protocolType,
    upstreamBaseUrl: form.upstreamBaseUrl,
    staticHeadersJson: form.staticHeadersJson,
    rotationStrategy: form.rotationStrategy,
    aggregateApiId: usesAggregateApi.value ? form.aggregateApiId : null,
    accountPlanFilter:
      usesAccountPlanFilter.value && form.accountPlanFilter !== "all"
        ? normalizePlanFilterValue(form.accountPlanFilter)
        : null,
  };
}

async function saveApiKey() {
  saving.value = true;
  try {
    if (editingId.value) {
      await updateApiKey(editingId.value, readPayload());
      ElMessage.success("密钥已更新");
    } else {
      const result = await createApiKey(readPayload());
      createdSecret.value = result.key;
      createdSecretOpen.value = Boolean(result.key);
      ElMessage.success("密钥已创建");
    }
    modalOpen.value = false;
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function toggleSecret(id: string) {
  if (revealedSecrets.value[id]) {
    const next = { ...revealedSecrets.value };
    delete next[id];
    revealedSecrets.value = next;
    return;
  }
  loadingSecretId.value = id;
  try {
    const secret = await readApiKeySecret(id);
    if (!secret) throw new Error("后端未返回密钥明文");
    revealedSecrets.value = { ...revealedSecrets.value, [id]: secret };
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loadingSecretId.value = "";
  }
}

async function toggleStatus(row: ApiKeySummary, checked: unknown) {
  const enabled = Boolean(checked);
  togglingId.value = row.id;
  try {
    if (enabled) {
      await enableApiKey(row.id);
    } else {
      await disableApiKey(row.id);
    }
    ElMessage.success(enabled ? "密钥已启用" : "密钥已禁用");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    togglingId.value = "";
  }
}

async function switchRotation(row: ApiKeySummary) {
  switchingId.value = row.id;
  try {
    const next =
      row.rotationStrategy === "aggregate_api_rotation"
        ? "account_rotation"
        : "aggregate_api_rotation";
    await updateApiKey(row.id, {
      name: row.name,
      modelSlug: row.modelSlug || row.model,
      reasoningEffort: row.reasoningEffort,
      serviceTier: normalizeEditableServiceTier(row.serviceTier),
      protocolType: normalizeEditableProtocolType(row.protocol || row.clientType),
      upstreamBaseUrl: row.upstreamBaseUrl,
      staticHeadersJson: row.staticHeadersJson,
      rotationStrategy: next,
      aggregateApiId: next === "aggregate_api_rotation" ? row.aggregateApiId : null,
      accountPlanFilter:
        next === "account_rotation" ? normalizePlanFilterValue(row.accountPlanFilter) : null,
    });
    ElMessage.success(`已切换为${rotationLabel(next)}`);
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    switchingId.value = "";
  }
}

function handleRowCommand(command: string | number | object, row: ApiKeySummary) {
  if (command === "switch") {
    void switchRotation(row);
    return;
  }
  if (command === "edit") {
    openEdit(row);
    return;
  }
  if (command === "ccswitch") {
    void importToCcSwitch(row);
    return;
  }
  if (command === "delete") {
    void confirmDelete(row);
  }
}

async function importToCcSwitch(row: ApiKeySummary) {
  ccSwitchImportingId.value = row.id;
  try {
    const apiKey = revealedSecrets.value[row.id] || (await readApiKeySecret(row.id));
    if (!apiKey) throw new Error("后端未返回密钥明文");
    revealedSecrets.value = { ...revealedSecrets.value, [row.id]: apiKey };
    await openInBrowser(buildCcSwitchImportUrl(row, apiKey));
    ElMessage.success("已打开 CCSwitch 导入链接");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    ccSwitchImportingId.value = "";
  }
}

async function confirmDelete(row: ApiKeySummary) {
  await ElMessageBox.confirm(`确定删除密钥 ${row.name || row.id} 吗？`, "删除密钥", {
    type: "warning",
  });
  try {
    await deleteApiKey(row.id);
    ElMessage.success("密钥已删除");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  ElMessage.success("已复制到剪贴板");
}

function copyEndpoint(command: string | number) {
  void command;
  void copyText(openAiEndpoint.value);
}

onMounted(loadData);
</script>

<style scoped lang="scss">
.apikey-page {
  .apikey-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .summary-card--with-icon {
    .summary-card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .summary-card__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      color: var(--el-color-primary);
      background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);

      &--success {
        color: var(--el-color-success);
        background: color-mix(in srgb, var(--el-color-success) 12%, transparent);
      }

      &--warning {
        color: var(--el-color-warning);
        background: color-mix(in srgb, var(--el-color-warning) 14%, transparent);
      }
    }
  }

  .endpoint-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .endpoint-card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-width: 0;
    padding: 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--card-bg);
    box-shadow: var(--shadow-card);
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      transform 0.18s ease;

    &:hover {
      border-color: color-mix(in srgb, var(--el-color-primary) 34%, var(--border-subtle));
      transform: translateY(-1px);
    }

    &__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      color: var(--el-color-primary);
      background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);

      &--native {
        color: var(--el-color-success);
        background: color-mix(in srgb, var(--el-color-success) 12%, transparent);
      }
    }

    &__content {
      display: grid;
      gap: 5px;
      min-width: 0;

      strong {
        overflow: hidden;
        font-size: 13px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      code {
        overflow: hidden;
        color: var(--text-secondary);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  .apikey-filter {
    grid-template-columns: minmax(260px, 1fr) 180px auto;
  }

  .apikey-table {
    min-width: 1120px;
  }

  .row-actions {
    justify-content: flex-start;
    margin-top: 4px;
  }

  .icon-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 144px;

    .el-button {
      width: 30px;
      height: 30px;
      padding: 0;
    }
  }

  .danger-item {
    color: var(--el-color-danger);
  }

  .form-extra {
    margin-top: 14px;
  }

  .field-hint {
    min-height: 32px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    border: 1px dashed var(--border-subtle);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    background: var(--table-section-bg);
  }
}

@media (max-width: 760px) {
  .apikey-page {
    .apikey-summary,
    .endpoint-grid {
      grid-template-columns: 1fr;
    }

    .apikey-filter {
      grid-template-columns: 1fr;
    }
  }
}

@media (min-width: 761px) and (max-width: 1180px) {
  .apikey-page {
    .apikey-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}
</style>
