<template>
  <div class="page aggregate-page">
    <div class="page-hero">
      <div>
        <h2 class="page-hero__title">聚合API</h2>
        <p class="page-hero__desc">
          管理第三方聚合 API 上游、密钥、协议模式和连通性，供平台密钥按策略轮转调用。
        </p>
      </div>
      <div class="table-actions">
        <el-button :loading="testingAll" @click="testAll">测试全部</el-button>
        <el-button type="primary" @click="openCreate">新建聚合 API</el-button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">上游总数</div>
        <div class="summary-card__value">{{ items.length }}</div>
        <div class="summary-card__hint">已配置供应商</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">启用中</div>
        <div class="summary-card__value">{{ enabledCount }}</div>
        <div class="summary-card__hint">参与轮转</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">连通成功</div>
        <div class="summary-card__value">{{ successCount }}</div>
        <div class="summary-card__hint">最近一次测试</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">累计费用</div>
        <div class="summary-card__value summary-card__value--small">
          {{ formatUsd(totalCost) }}
        </div>
        <div class="summary-card__hint">请求日志估算</div>
      </div>
    </div>

    <div class="page-card page-card--flush">
      <div class="page-card__body">
        <div class="filter-bar aggregate-filter">
          <el-input v-model="keyword" clearable placeholder="搜索供应商 / URL / 模型" />
          <el-select v-model="providerFilter">
            <el-option label="全部类型" value="all" />
            <el-option label="Codex" value="codex" />
            <el-option label="Claude" value="claude" />
            <el-option label="Gemini" value="gemini" />
          </el-select>
          <el-button :loading="loading" @click="loadData">刷新</el-button>
        </div>
      </div>

      <div class="table-scroll">
        <el-table v-loading="loading" :data="filteredItems" class="aggregate-table">
          <el-table-column label="供应商 / URL" min-width="280">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ row.supplierName || row.id }}</strong>
                <span>{{ row.url }}</span>
                <span v-if="row.modelOverride">模型覆写：{{ row.modelOverride }}</span>
                <span v-if="row.createdAt">创建时间：{{ formatDateTime(row.createdAt) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="110" align="center">
            <template #default="{ row }">
              <el-tag effect="light">{{ providerLabel(row.providerType) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="协议" width="150">
            <template #default="{ row }">{{ protocolLabel(row.protocolMode, row.providerType) }}</template>
          </el-table-column>
          <el-table-column label="密钥" min-width="180">
            <template #default="{ row }">
              <div class="secret-cell">
                <span class="mono">{{ secretPreview(row) }}</span>
                <el-button link type="primary" :loading="loadingSecretId === row.id" @click="toggleSecret(row.id)">
                  {{ revealedSecrets[row.id] ? "隐藏" : "显示" }}
                </el-button>
                <el-dropdown v-if="revealedSecrets[row.id]" trigger="click" @command="copySecret(row.id, $event)">
                  <el-button link type="primary">复制</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="key" :disabled="!revealedSecrets[row.id]?.key">复制密钥</el-dropdown-item>
                      <el-dropdown-item command="username" :disabled="!revealedSecrets[row.id]?.username">复制用户名</el-dropdown-item>
                      <el-dropdown-item command="password" :disabled="!revealedSecrets[row.id]?.password">复制密码</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="顺序" width="80" align="center" prop="sort" />
          <el-table-column label="费用统计" width="130">
            <template #default="{ row }">
              <span class="mono">{{ formatUsd(row.estimatedCostUsd || 0) }}</span>
              <el-button link type="primary" @click="confirmReset(row)">重置</el-button>
            </template>
          </el-table-column>
          <el-table-column label="连通性" width="150">
            <template #default="{ row }">
              <el-tag :type="testTagType(row.lastTestStatus)" effect="light">
                {{ testLabel(row.lastTestStatus) }}
              </el-tag>
              <el-button link type="primary" :loading="testingId === row.id" @click="testOne(row.id)">
                测试
              </el-button>
              <div v-if="row.lastTestError" class="muted error-line">{{ row.lastTestError }}</div>
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
          <el-table-column label="操作" width="118" fixed="right" align="center">
            <template #default="{ row }">
              <div class="icon-actions">
                <el-tooltip content="编辑配置" placement="top">
                  <el-button text @click="openEdit(row)">
                    <el-icon><Setting /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-dropdown trigger="click" @command="handleRowCommand($event, row)">
                  <el-button text>
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">编辑聚合 API</el-dropdown-item>
                      <el-dropdown-item command="prioritize" :disabled="prioritizingId === row.id">
                        设为优先
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" class="danger-item">删除聚合 API</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="modalOpen" :title="editingId ? '编辑聚合 API' : '新建聚合 API'" width="720px">
      <div class="form-grid">
        <el-input v-model="form.supplierName" placeholder="供应商名称" />
        <el-input-number v-model="form.sort" :min="0" controls-position="right" placeholder="顺序" />
        <el-select v-model="form.providerType" placeholder="供应商类型">
          <el-option label="Codex" value="codex" />
          <el-option label="Claude" value="claude" />
          <el-option label="Gemini" value="gemini" />
        </el-select>
        <el-select v-if="form.providerType === 'codex'" v-model="form.protocolMode" placeholder="协议模式">
          <el-option label="OpenAI 兼容" value="openai_compat" />
          <el-option label="Codex CLI 兼容" value="codex_cli" />
          <el-option label="Responses 官方" value="responses" />
          <el-option label="Codex Responses" value="codex_responses" />
        </el-select>
        <div v-else class="field-hint">Claude / Gemini 使用原生协议，不需要协议模式</div>
        <el-input v-model="form.url" placeholder="上游 URL" />
        <el-input v-model="form.modelOverride" placeholder="模型覆写，可空" />
        <el-select v-model="form.authType" placeholder="鉴权类型">
          <el-option label="APIKey" value="apikey" />
          <el-option label="账号密码" value="userpass" />
        </el-select>
        <el-select v-model="form.status" placeholder="状态">
          <el-option label="启用" value="active" />
          <el-option label="禁用" value="disabled" />
        </el-select>
      </div>
      <div class="form-grid form-grid--single aggregate-secret-form">
        <el-input
          v-if="form.authType === 'apikey'"
          v-model="form.key"
          show-password
          :placeholder="editingId ? '密钥；编辑时留空表示不修改' : '请输入密钥'"
        />
        <div v-else class="inline-grid">
          <el-input v-model="form.username" placeholder="账号；编辑时留空表示不修改" />
          <el-input v-model="form.password" show-password placeholder="密码；编辑时留空表示不修改" />
        </div>
        <div class="option-panel">
          <div class="option-panel__head">
            <div>
              <strong>自定义认证参数</strong>
              <span>关闭时 APIKey 默认走 Bearer，账号密码默认走 HTTP Basic。</span>
            </div>
            <el-switch v-model="form.authCustomEnabled" />
          </div>
          <div v-if="form.authCustomEnabled && form.authType === 'apikey'" class="inline-grid">
            <el-select v-model="form.apiKeyLocation" placeholder="位置">
              <el-option label="Header" value="header" />
              <el-option label="Query" value="query" />
            </el-select>
            <el-input v-model="form.apiKeyName" placeholder="参数名，例如 authorization / api_key" />
            <el-select v-if="form.apiKeyLocation === 'header'" v-model="form.apiKeyHeaderValueFormat" placeholder="Header 格式">
              <el-option label="Bearer" value="bearer" />
              <el-option label="Raw" value="raw" />
            </el-select>
          </div>
          <div v-if="form.authCustomEnabled && form.authType === 'userpass'" class="inline-grid">
            <el-select v-model="form.userpassMode" placeholder="发送模式">
              <el-option label="HTTP Basic" value="basic" />
              <el-option label="Header 双字段" value="headerPair" />
              <el-option label="Query 双字段" value="queryPair" />
            </el-select>
            <el-input
              v-if="form.userpassMode !== 'basic'"
              v-model="form.userpassUsernameName"
              placeholder="账号字段名"
            />
            <el-input
              v-if="form.userpassMode !== 'basic'"
              v-model="form.userpassPasswordName"
              placeholder="密码字段名"
            />
          </div>
        </div>
        <div class="option-panel">
          <div class="option-panel__head">
            <div>
              <strong>自定义 action</strong>
              <span>用于覆盖转发 path，例如 /v1/responses、/responses 或 /api/paas/v4/responses。</span>
            </div>
            <el-switch v-model="form.actionCustomEnabled" />
          </div>
          <el-input
            v-if="form.actionCustomEnabled"
            v-model="form.action"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder="例如：/v1/responses 或 /api/paas/v4/responses"
          />
        </div>
        <p v-if="form.providerType === 'codex'" class="dialog-hint">
          Responses 模式用于支持 /v1/responses、/responses 以及 compact 请求；需要特殊路径时打开自定义 action。
        </p>
      </div>
      <template #footer>
        <el-button @click="modalOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAggregateApi">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { MoreFilled, Setting } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";

import {
  createAggregateApi,
  deleteAggregateApi,
  listAggregateApis,
  readAggregateApiSecret,
  resetAggregateApiUsage,
  testAggregateApiConnection,
  updateAggregateApi,
  type AggregateApiPayload,
} from "@/api/aggregateApi";
import { getErrorMessage } from "@/api/http";
import type { AggregateApiSecretResult, AggregateApiSummary } from "@/types/common";

const items = ref<AggregateApiSummary[]>([]);
const keyword = ref("");
const providerFilter = ref("all");
const loading = ref(false);
const saving = ref(false);
const testingId = ref("");
const testingAll = ref(false);
const togglingId = ref("");
const prioritizingId = ref("");
const loadingSecretId = ref("");
const modalOpen = ref(false);
const editingId = ref("");
const revealedSecrets = ref<Record<string, AggregateApiSecretResult>>({});
const form = reactive({
  supplierName: "",
  providerType: "codex",
  protocolMode: "openai_compat",
  url: "",
  key: "",
  authType: "apikey",
  authCustomEnabled: false,
  apiKeyLocation: "header",
  apiKeyName: "authorization",
  apiKeyHeaderValueFormat: "bearer",
  userpassMode: "basic",
  userpassUsernameName: "username",
  userpassPasswordName: "password",
  username: "",
  password: "",
  actionCustomEnabled: false,
  action: "",
  modelOverride: "",
  sort: 5,
  status: "active",
});

const filteredItems = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  return items.value.filter((item) => {
    const matchKeyword =
      !value ||
      [item.supplierName, item.url, item.providerType, item.modelOverride].some((part) =>
        String(part || "").toLowerCase().includes(value),
      );
    const matchProvider =
      providerFilter.value === "all" || item.providerType === providerFilter.value;
    return matchKeyword && matchProvider;
  });
});
const enabledCount = computed(() => items.value.filter((item) => isEnabled(item)).length);
const successCount = computed(
  () => items.value.filter((item) => item.lastTestStatus === "success").length,
);
const totalCost = computed(() =>
  items.value.reduce((sum, item) => sum + Math.max(0, Number(item.estimatedCostUsd) || 0), 0),
);

function providerLabel(value?: string | null) {
  if (value === "gemini") return "Gemini";
  if (value === "claude") return "Claude";
  return "Codex";
}

function protocolLabel(value?: string | null, providerType?: string | null) {
  if (providerType && providerType !== "codex") return "-";
  if (value === "codex_responses") return "Codex Responses";
  if (value === "responses") return "Responses";
  if (value === "codex_cli") return "Codex CLI";
  return "OpenAI 兼容";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 10 ? 1 : 4,
    maximumFractionDigits: value >= 10 ? 1 : 4,
  }).format(Math.max(0, Number(value) || 0));
}

function formatDateTime(value?: number | null) {
  const numeric = Number(value) || 0;
  if (!numeric) return "-";
  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function isEnabled(row: AggregateApiSummary) {
  return String(row.status || "").toLowerCase() !== "disabled";
}

function secretPreview(row: AggregateApiSummary) {
  const secret = revealedSecrets.value[row.id];
  if (!secret) return row.authType === "userpass" ? "user: ********" : "sk-********";
  if (row.authType === "userpass") {
    return `${secret.username || "username"} / ${secret.password ? "********" : "-"}`;
  }
  return secret.key || "sk-********";
}

function testLabel(value?: string | null) {
  if (value === "success") return "已连通";
  if (value === "failed") return "失败";
  return "未测试";
}

function testTagType(value?: string | null) {
  if (value === "success") return "success";
  if (value === "failed") return "danger";
  return "info";
}

function resetForm() {
  Object.assign(form, {
    supplierName: "",
    providerType: "codex",
    protocolMode: "openai_compat",
    url: "",
    key: "",
    authType: "apikey",
    authCustomEnabled: false,
    apiKeyLocation: "header",
    apiKeyName: "authorization",
    apiKeyHeaderValueFormat: "bearer",
    userpassMode: "basic",
    userpassUsernameName: "username",
    userpassPasswordName: "password",
    username: "",
    password: "",
    actionCustomEnabled: false,
    action: "",
    modelOverride: "",
    sort: Math.max(0, ...items.value.map((item) => Number(item.sort) || 0)) + 5,
    status: "active",
  });
}

async function loadData() {
  loading.value = true;
  try {
    items.value = await listAggregateApis();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = "";
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: AggregateApiSummary) {
  const authParams = asRecord(row.authParams);
  const isUserpass = row.authType === "userpass";
  editingId.value = row.id;
  Object.assign(form, {
    supplierName: row.supplierName || "",
    providerType: row.providerType || "codex",
    protocolMode: row.protocolMode || "openai_compat",
    url: row.url || "",
    key: "",
    authType: isUserpass ? "userpass" : "apikey",
    authCustomEnabled:
      typeof row.authCustomEnabled === "boolean"
        ? row.authCustomEnabled
        : Object.keys(authParams).length > 0,
    apiKeyLocation: authParams.location === "query" ? "query" : "header",
    apiKeyName:
      typeof authParams.name === "string"
        ? authParams.name
        : authParams.location === "query"
          ? "api_key"
          : "authorization",
    apiKeyHeaderValueFormat:
      String(authParams.headerValueFormat || "").toLowerCase() === "raw" ? "raw" : "bearer",
    userpassMode:
      authParams.mode === "headerPair" || authParams.mode === "queryPair"
        ? authParams.mode
        : "basic",
    userpassUsernameName:
      typeof authParams.usernameName === "string" ? authParams.usernameName : "username",
    userpassPasswordName:
      typeof authParams.passwordName === "string" ? authParams.passwordName : "password",
    username: "",
    password: "",
    actionCustomEnabled:
      typeof row.actionCustomEnabled === "boolean"
        ? row.actionCustomEnabled
        : row.action !== null && row.action !== undefined,
    action: row.action || "",
    modelOverride: row.modelOverride || "",
    sort: Number(row.sort) || 0,
    status: row.status || "active",
  });
  modalOpen.value = true;
}

function readPayload(): AggregateApiPayload {
  const authParams =
    form.authCustomEnabled && form.authType === "apikey"
      ? {
          location: form.apiKeyLocation,
          name: form.apiKeyName.trim(),
          headerValueFormat:
            form.apiKeyLocation === "header" ? form.apiKeyHeaderValueFormat : undefined,
        }
      : form.authCustomEnabled && form.authType === "userpass"
        ? {
            mode: form.userpassMode,
            usernameName:
              form.userpassMode === "basic" ? undefined : form.userpassUsernameName.trim(),
            passwordName:
              form.userpassMode === "basic" ? undefined : form.userpassPasswordName.trim(),
          }
        : null;

  return {
    supplierName: form.supplierName,
    providerType: form.providerType,
    protocolMode: form.providerType === "codex" ? form.protocolMode : null,
    url: form.url,
    key: form.authType === "apikey" ? form.key : null,
    authType: form.authType,
    authCustomEnabled: form.authCustomEnabled,
    authParams,
    username: form.authType === "userpass" ? form.username : null,
    password: form.authType === "userpass" ? form.password : null,
    actionCustomEnabled: form.actionCustomEnabled,
    action: form.actionCustomEnabled ? form.action.trim() : null,
    modelOverride: form.modelOverride,
    sort: form.sort,
    status: form.status,
  };
}

async function saveAggregateApi() {
  if (!form.url.trim()) {
    ElMessage.warning("请填写上游 URL");
    return;
  }
  if (!form.supplierName.trim()) {
    ElMessage.warning("请填写供应商名称");
    return;
  }
  if (!editingId.value && form.authType === "apikey" && !form.key.trim()) {
    ElMessage.warning("请填写聚合 API 密钥");
    return;
  }
  if (!editingId.value && form.authType === "userpass" && (!form.username.trim() || !form.password.trim())) {
    ElMessage.warning("请填写账号和密码");
    return;
  }
  if (form.authType === "userpass" && (form.username.trim() || form.password.trim())) {
    if (!form.username.trim() || !form.password.trim()) {
      ElMessage.warning("账号和密码必须同时填写");
      return;
    }
  }
  if (form.authCustomEnabled && form.authType === "apikey" && !form.apiKeyName.trim()) {
    ElMessage.warning("请填写认证参数名");
    return;
  }
  if (
    form.authCustomEnabled &&
    form.authType === "userpass" &&
    form.userpassMode !== "basic" &&
    (!form.userpassUsernameName.trim() || !form.userpassPasswordName.trim())
  ) {
    ElMessage.warning("请填写账号密码字段名");
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await updateAggregateApi(editingId.value, readPayload());
      ElMessage.success("聚合 API 已更新");
    } else {
      await createAggregateApi(readPayload());
      ElMessage.success("聚合 API 已创建");
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
    const secret = await readAggregateApiSecret(id);
    const row = items.value.find((item) => item.id === id);
    const hasSecret =
      row?.authType === "userpass" ? Boolean(secret.username || secret.password) : Boolean(secret.key);
    if (!hasSecret) throw new Error("后端未返回密钥明文");
    revealedSecrets.value = { ...revealedSecrets.value, [id]: secret };
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loadingSecretId.value = "";
  }
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  ElMessage.success("已复制到剪贴板");
}

async function copySecret(id: string, field: unknown) {
  const secret = revealedSecrets.value[id];
  const key = String(field || "key") as keyof AggregateApiSecretResult;
  const value = secret?.[key];
  if (typeof value !== "string" || !value) {
    ElMessage.warning("当前字段为空");
    return;
  }
  await copyText(value);
}

async function testOne(id: string) {
  testingId.value = id;
  try {
    const result = await testAggregateApiConnection(id);
    ElMessage[result.ok ? "success" : "error"](
      result.ok ? "连通性测试通过" : `连通性测试失败：${result.message || "未知原因"}`,
    );
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    testingId.value = "";
  }
}

async function testAll() {
  testingAll.value = true;
  try {
    let ok = 0;
    for (const item of filteredItems.value) {
      const result = await testAggregateApiConnection(item.id);
      if (result.ok) ok += 1;
    }
    ElMessage.success(`测试完成，${ok}/${filteredItems.value.length} 个连通`);
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    testingAll.value = false;
  }
}

async function toggleStatus(row: AggregateApiSummary, checked: unknown) {
  const enabled = Boolean(checked);
  togglingId.value = row.id;
  try {
    await updateAggregateApi(row.id, {
      providerType: row.providerType,
      protocolMode: row.protocolMode,
      supplierName: row.supplierName,
      sort: row.sort,
      status: enabled ? "active" : "disabled",
      url: row.url,
      authType: row.authType,
      action: row.action,
      modelOverride: row.modelOverride,
    });
    ElMessage.success(enabled ? "聚合 API 已启用" : "聚合 API 已禁用");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    togglingId.value = "";
  }
}

async function prioritize(row: AggregateApiSummary) {
  const currentMinSort = items.value.reduce(
    (min, item) => Math.min(min, Number(item.sort) || 0),
    Number(row.sort) || 0,
  );
  const nextSort = (Number(row.sort) || 0) <= currentMinSort ? currentMinSort : currentMinSort - 5;
  if ((Number(row.sort) || 0) === nextSort) {
    ElMessage.info("已是最高优先级");
    return;
  }
  prioritizingId.value = row.id;
  try {
    await updateAggregateApi(row.id, {
      providerType: row.providerType,
      protocolMode: row.protocolMode,
      supplierName: row.supplierName,
      sort: nextSort,
      url: row.url,
      authType: row.authType,
      status: row.status,
    });
    ElMessage.success("已设为优先");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    prioritizingId.value = "";
  }
}

function handleRowCommand(command: string | number | object, row: AggregateApiSummary) {
  if (command === "edit") {
    openEdit(row);
    return;
  }
  if (command === "prioritize") {
    void prioritize(row);
    return;
  }
  if (command === "delete") {
    void confirmDelete(row);
  }
}

async function confirmReset(row: AggregateApiSummary) {
  await ElMessageBox.confirm(`确定重置 ${row.supplierName || row.id} 的费用统计吗？`, "重置费用", {
    type: "warning",
  });
  try {
    await resetAggregateApiUsage(row.id);
    ElMessage.success("费用统计已重置");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function confirmDelete(row: AggregateApiSummary) {
  await ElMessageBox.confirm(`确定删除聚合 API ${row.supplierName || row.id} 吗？`, "删除聚合 API", {
    type: "warning",
  });
  try {
    await deleteAggregateApi(row.id);
    ElMessage.success("聚合 API 已删除");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

onMounted(loadData);
</script>

<style scoped lang="scss">
.aggregate-page {
  .aggregate-filter {
    grid-template-columns: minmax(260px, 1fr) 160px auto;
  }

  .aggregate-table {
    min-width: 1120px;
  }

  .secret-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .error-line {
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;

    .el-button {
      width: 30px;
      height: 30px;
      padding: 0;
    }
  }

  .danger-item {
    color: var(--el-color-danger);
  }

  .aggregate-secret-form {
    margin-top: 14px;
  }

  .inline-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .field-hint {
    display: flex;
    min-height: 32px;
    align-items: center;
    padding: 0 10px;
    border: 1px dashed var(--border-subtle);
    border-radius: 6px;
    background: var(--table-section-bg);
    color: var(--text-secondary);
    font-size: 12px;
  }

  .option-panel {
    display: grid;
    gap: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--table-section-bg);

    &__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;

      > div {
        display: grid;
        gap: 4px;
      }

      strong {
        color: var(--text-primary);
        font-size: 13px;
      }

      span {
        color: var(--text-secondary);
        font-size: 12px;
      }
    }
  }
}

@media (max-width: 760px) {
  .aggregate-page {
    .aggregate-filter {
      grid-template-columns: 1fr;
    }

    .inline-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
