<template>
  <div class="page accounts-page">
    <div class="account-summary-grid">
      <div
        v-for="item in accountMetricCards"
        :key="item.label"
        class="account-metric-card"
      >
        <div class="account-metric-card__head">
          <span>{{ item.label }}</span>
          <el-icon :class="item.iconClass">
            <component :is="item.icon" />
          </el-icon>
        </div>
        <div class="account-metric-card__value">{{ item.value }}</div>
        <div class="account-metric-card__hint">{{ item.hint }}</div>
      </div>
    </div>

    <div class="account-toolbar">
      <div class="account-toolbar__filters">
        <el-input v-model="keyword" clearable placeholder="搜索账号名 / 编号..." />
        <el-select v-model="planFilter" placeholder="全部类型">
          <el-option :label="`全部类型 (${accounts.length})`" value="all" />
          <el-option
            v-for="plan in planTypes"
            :key="plan.value"
            :label="`${formatPlanLabel(plan.value)} (${plan.count})`"
            :value="plan.value"
          />
        </el-select>
        <el-select v-model="statusFilter" placeholder="全部">
          <el-option
            v-for="option in statusFilterOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <div class="account-toolbar__actions">
        <el-button
          class="mode-button"
          :disabled="!activeApiKey"
          :loading="switchingApiKeyMode"
          @click="toggleActiveApiKeyMode"
        >
          <span>当前</span>
          <strong>{{ activeApiKeyModeLabel }}</strong>
          <el-icon><Switch /></el-icon>
        </el-button>
        <el-button :loading="warming" @click="runWarmup(selectedIds)">
          <el-icon><Lightning /></el-icon>
          预热
        </el-button>
        <el-dropdown trigger="click" @command="handleAccountCommand">
          <el-button>
            账号操作
            <el-icon class="el-icon--right"><MoreFilled /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="refresh-usage">刷新账号用量</el-dropdown-item>
              <el-dropdown-item command="refresh-rt">刷新全部 AT/RT</el-dropdown-item>
              <el-dropdown-item command="refresh-list">刷新列表</el-dropdown-item>
              <el-dropdown-item divided command="login">添加账号</el-dropdown-item>
              <el-dropdown-item command="json">按 JSON 导入</el-dropdown-item>
              <el-dropdown-item command="file">按文件导入</el-dropdown-item>
              <el-dropdown-item command="cpa-directory">导入 CPA 格式文件夹</el-dropdown-item>
              <el-dropdown-item command="sub2api-directory">导入 sub2api 格式文件夹</el-dropdown-item>
              <el-dropdown-item command="export">导出账号</el-dropdown-item>
              <el-dropdown-item
                divided
                command="delete-selected"
                :disabled="!selectedIds.length"
              >
                删除选中
              </el-dropdown-item>
              <el-dropdown-item command="cleanup">按状态清理</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="account-table-card" v-loading="loading">
      <div class="account-table account-table--head">
        <div>
          <el-checkbox
            :model-value="allPageSelected"
            :indeterminate="somePageSelected && !allPageSelected"
            @change="togglePageSelection"
          />
        </div>
        <div>账号信息</div>
        <div>是否启用</div>
        <div>额度详情</div>
        <div>账号状态</div>
        <div>操作</div>
      </div>
      <div v-if="pagedAccounts.length" class="account-table__body">
        <div v-for="row in pagedAccounts" :key="row.id" class="account-table account-table--row">
          <div>
            <el-checkbox
              :model-value="selectedIds.includes(row.id)"
              @change="toggleAccountSelection(row.id)"
            />
          </div>
          <div class="account-info">
            <div class="account-info__title">
              <strong>{{ row.label || row.name || row.id }}</strong>
              <span class="account-badge">{{ displayPlan(row) }}</span>
              <span v-if="row.preferred" class="account-badge">启用</span>
            </div>
            <div class="account-info__id">{{ shortAccountId(row.id) }}</div>
            <div class="account-info__meta">最近刷新: {{ formatDateMinute(row.lastRefreshAt) }}</div>
            <div class="account-info__meta">订阅到期: {{ formatDateMinute(row.subscriptionExpiresAt || row.subscriptionRenewsAt) }}</div>
          </div>
          <div>
            <el-switch
              :model-value="Boolean(row.preferred)"
              :disabled="rowLoadingId === row.id || (!row.preferred && row.isAvailable === false)"
              @change="toggleAccountEnabled(row, $event)"
            />
          </div>
          <div class="quota-detail">
            <div class="quota-row">
              <span class="quota-row__label">
                {{ primaryWindowLabel(row) }}
                <template v-if="hasPrimaryCost(row)">（{{ formatQuotaCost(primaryQuotaCost(row)) }}）</template>
              </span>
              <div class="quota-bar">
                <span class="quota-bar__fill quota-bar__fill--green" :style="{ width: `${primaryUsagePercent(row) ?? 0}%` }" />
              </div>
              <span>{{ formatRemainPercent(primaryUsagePercent(row), primaryEmptyText(row)) }}</span>
              <span>{{ resetAfterLabel(row.usage?.resetsAt, primaryEmptyResetText(row)) }}</span>
            </div>
            <div class="quota-row">
              <span class="quota-row__label">
                {{ secondaryWindowLabel(row) }}
                <template v-if="hasSecondaryCost(row)">（{{ formatQuotaCost(row.secondaryWindowCostUsd) }}）</template>
              </span>
              <div class="quota-bar">
                <span class="quota-bar__fill quota-bar__fill--blue" :style="{ width: `${secondaryUsagePercent(row) ?? 0}%` }" />
              </div>
              <span>{{ formatRemainPercent(secondaryUsagePercent(row), secondaryEmptyText(row)) }}</span>
              <span>{{ resetAfterLabel(row.usage?.secondaryResetsAt, secondaryEmptyResetText(row)) }}</span>
            </div>
          </div>
          <div>
            <span
              :class="['account-state', row.isAvailable === false ? 'account-state--danger' : '']"
              :title="row.availabilityText || undefined"
            >
              {{ formatHealthStatus(row) }}
            </span>
          </div>
          <div class="row-actions">
            <el-button link type="danger" :loading="deleting && rowLoadingId === row.id" @click="confirmDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
      <div v-else class="empty-hint">暂无账号</div>
    </div>

    <div class="account-footer">
      <span>共 {{ filteredAccounts.length }} 个账号</span>
      <div class="account-footer__pager">
        <span>每页显示</span>
        <el-select v-model="pageSize" class="page-size-select">
          <el-option :value="10" label="10" />
          <el-option :value="20" label="20" />
          <el-option :value="50" label="50" />
          <el-option :value="100" label="100" />
        </el-select>
        <el-button :disabled="page <= 1" @click="page -= 1">上一页</el-button>
        <strong>第 {{ page }} / {{ totalPages }} 页</strong>
        <el-button :disabled="page >= totalPages" @click="page += 1">下一页</el-button>
      </div>
    </div>

    <el-dialog v-model="importDialogOpen" title="按 JSON 导入账号" width="680px">
      <el-input
        v-model="jsonDraft"
        type="textarea"
        :autosize="{ minRows: 9, maxRows: 16 }"
        placeholder="粘贴账号 JSON；支持数组或对象。"
      />
      <p class="dialog-hint">会调用后端账号导入命令，保留旧版 JSON 导入流程。</p>
      <template #footer>
        <el-button @click="importDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="submitJsonImport">导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="exportDialogOpen" title="导出账号" width="420px">
      <el-radio-group v-model="exportMode">
        <el-radio-button label="multiple">合并 accounts.json</el-radio-button>
        <el-radio-button label="single">每个账号独立文件</el-radio-button>
      </el-radio-group>
      <p class="dialog-hint">
        已选择 {{ selectedIds.length }} 个账号；未选择时导出全部账号。
      </p>
      <template #footer>
        <el-button @click="exportDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="submitExport">开始导出</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cleanupDialogOpen" title="按状态清理账号" width="460px">
      <el-checkbox-group v-model="cleanupStatuses">
        <el-checkbox label="unavailable">不可用</el-checkbox>
        <el-checkbox label="banned">封禁</el-checkbox>
        <el-checkbox label="limited">低额度</el-checkbox>
      </el-checkbox-group>
      <div class="cleanup-summary">
        预计匹配 {{ cleanupMatchedCount }} 个账号
      </div>
      <p class="dialog-hint danger-text">该操作会删除匹配状态的账号，请确认筛选范围。</p>
      <template #footer>
        <el-button @click="cleanupDialogOpen = false">取消</el-button>
        <el-button type="danger" :loading="deleting" @click="submitCleanup">删除匹配账号</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="rtFailureDeleteDialogOpen"
      title="删除 AT/RT 刷新失败账号？"
      width="760px"
      :close-on-click-modal="!deleting"
    >
      <p class="dialog-hint danger-text">
        这些账号刷新 AT/RT 失败或缺少 token，不会自动删除；请勾选后确认。
      </p>
      <div class="failure-toolbar">
        <el-checkbox
          :model-value="allRtFailureDeleteSelected"
          :indeterminate="someRtFailureDeleteSelected && !allRtFailureDeleteSelected"
          :disabled="deleting || !rtFailureDeleteItems.length"
          @change="toggleAllRtFailureDeleteSelection"
        >
          全选失败账号
        </el-checkbox>
        <span>{{ rtFailureDeleteSelectedIds.length }}/{{ rtFailureDeleteItems.length }}</span>
      </div>
      <div class="failure-list">
        <div
          v-for="item in rtFailureDeleteItems"
          :key="item.accountId"
          class="failure-item failure-item--selectable"
        >
          <el-checkbox
            :model-value="rtFailureDeleteSelectedIds.includes(item.accountId)"
            :disabled="deleting"
            @change="toggleRtFailureDeleteSelection(item.accountId)"
          />
          <div class="failure-item__content">
            <strong>{{ item.accountName || item.accountId || "未知账号" }}</strong>
            <span class="mono">{{ item.accountId || "-" }}</span>
            <span>{{ item.reason || "未知原因" }}</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="deleting" @click="rtFailureDeleteDialogOpen = false">取消</el-button>
        <el-button
          type="danger"
          :disabled="!rtFailureDeleteSelectedIds.length"
          :loading="deleting"
          @click="confirmRtFailureDelete"
        >
          删除选中账号 ({{ rtFailureDeleteSelectedIds.length }})
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="warmupFailureDialogOpen" title="预热失败账号" width="760px">
      <p class="dialog-hint danger-text">以下账号预热失败；这里只展示结果，不会自动删除账号。</p>
      <div class="failure-list">
        <div v-for="item in warmupFailureItems" :key="`${item.accountId}-${item.reason}`" class="failure-item">
          <strong>{{ item.accountName || item.accountId || "未知账号" }}</strong>
          <span class="mono">{{ item.accountId || "-" }}</span>
          <span>{{ item.reason || "未知原因" }}</span>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="warmupFailureDialogOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="addAccountDialogOpen" title="新增账号" width="720px" @closed="resetAddAccountDialog">
      <el-tabs v-model="addAccountTab">
        <el-tab-pane label="登录授权" name="login">
          <div class="form-grid form-grid--single">
            <el-input v-model="loginTags" placeholder="标签，逗号分隔，例如：高频, 团队A" />
            <el-input v-model="loginNote" placeholder="备注/描述，例如：主号 / 测试号" />
            <el-button
              type="primary"
              :loading="loginLoading || pollingLogin"
              @click="startBrowserLogin"
            >
              登录授权
            </el-button>
            <div v-if="loginUrl" class="login-url-box">
              <el-input v-model="loginUrl" readonly />
              <el-button @click="copyText(loginUrl)">复制链接</el-button>
            </div>
            <p v-if="loginHint" class="dialog-hint">{{ loginHint }}</p>
          </div>

          <div class="manual-callback">
            <h3>手动解析回调</h3>
            <p class="dialog-hint">当本地 48760 端口被占用，或浏览器回调没有自动完成时，粘贴完整回调 URL。</p>
            <div class="login-url-box">
              <el-input
                v-model="manualCallback"
                placeholder="粘贴包含 state 和 code 的完整回调 URL"
              />
              <el-button :loading="loginLoading" @click="submitManualCallback">解析</el-button>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="批量导入" name="bulk">
          <el-input
            v-model="bulkDraft"
            type="textarea"
            :autosize="{ minRows: 12, maxRows: 18 }"
            placeholder="粘贴账号数据。普通 Token 可每行一个；完整 JSON / JSON 数组请整段粘贴。"
          />
          <p class="dialog-hint">支持单个 JSON、JSON 数组、多个 JSON 片段、或每行一个普通 Token。</p>
          <div class="dialog-footer-inline">
            <el-button type="primary" :loading="importing" @click="submitBulkImport">开始导入</el-button>
          </div>
        </el-tab-pane>

        <el-tab-pane label="Token 直登" name="tokens">
          <div class="form-grid form-grid--single">
            <el-input v-model="tokenForm.accessToken" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" placeholder="access_token" />
            <el-input v-model="tokenForm.refreshToken" placeholder="refresh_token，可空" />
            <el-input v-model="tokenForm.idToken" placeholder="id_token，可空" />
            <el-input v-model="tokenForm.chatgptAccountId" placeholder="ChatGPT account id，可空" />
            <el-input v-model="tokenForm.workspaceId" placeholder="workspace id，可空" />
            <el-input v-model="tokenForm.chatgptPlanType" placeholder="plan type，可空" />
            <el-button type="primary" :loading="loginLoading" @click="submitTokenLogin">
              导入 Token
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <el-dialog v-model="editorOpen" title="编辑账号信息" width="520px">
      <div class="form-grid form-grid--single">
        <el-input v-model="editor.label" placeholder="显示名称" />
        <el-input v-model="editor.tags" placeholder="标签，逗号分隔" />
        <el-input v-model="editor.note" type="textarea" :autosize="{ minRows: 4, maxRows: 8 }" placeholder="备注" />
      </div>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="savingEditor" @click="saveEditor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Coin, DataLine, Delete, Lightning, Money, MoreFilled, Switch } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import {
  completeLogin,
  deleteAccount,
  deleteAccounts,
  deleteAccountsByStatuses,
  exportAccounts,
  importAccounts,
  importAccountsByDirectory,
  importAccountsByFile,
  getLoginStatus,
  listAccountUsage,
  listAccounts,
  loginWithChatgptAuthTokens,
  refreshAccounts,
  refreshAccountTokens,
  refreshAllAccountTokens,
  startLogin,
  updateAccountProfile,
  warmupAccounts,
  type AccountTokenRefreshAllResult,
  type AccountWarmupResult,
} from "@/api/account";
import { listApiKeys, updateApiKey } from "@/api/apiKey";
import { getErrorMessage } from "@/api/http";
import { attachUsagesToAccounts } from "@/api/normalize";
import { getRequestLogTodaySummary, type RequestLogTodaySummary } from "@/api/requestLog";
import type { AccountSummary, ApiKeySummary } from "@/types/common";

const accounts = ref<AccountSummary[]>([]);
const apiKeys = ref<ApiKeySummary[]>([]);
const tokenStats = ref<RequestLogTodaySummary>({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  todayTokens: 0,
  estimatedCost: 0,
});
const keyword = ref("");
const planFilter = ref("all");
const statusFilter = ref("all");
const page = ref(1);
const pageSize = ref(20);
const selectedIds = ref<string[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const refreshingTokens = ref(false);
const warming = ref(false);
const deleting = ref(false);
const switchingApiKeyMode = ref(false);
const importing = ref(false);
const exporting = ref(false);
const rowLoadingId = ref("");
const importDialogOpen = ref(false);
const exportDialogOpen = ref(false);
const cleanupDialogOpen = ref(false);
const addAccountDialogOpen = ref(false);
const editorOpen = ref(false);
const savingEditor = ref(false);
const jsonDraft = ref("");
const bulkDraft = ref("");
const exportMode = ref<"single" | "multiple">("multiple");
const cleanupStatuses = ref<string[]>(["unavailable", "banned"]);
const rtFailureDeleteDialogOpen = ref(false);
const rtFailureDeleteItems = ref<Array<{ accountId: string; accountName: string; reason: string }>>([]);
const rtFailureDeleteSelectedIds = ref<string[]>([]);
const warmupFailureDialogOpen = ref(false);
const warmupFailureItems = ref<Array<{ accountId: string; accountName: string; reason: string }>>([]);
const editingAccountId = ref("");
const editor = ref({ label: "", tags: "", note: "" });
const addAccountTab = ref("login");
const loginTags = ref("");
const loginNote = ref("");
const loginUrl = ref("");
const loginHint = ref("");
const manualCallback = ref("");
const loginLoading = ref(false);
const pollingLogin = ref(false);
const loginPollToken = ref(0);
const tokenForm = ref({
  accessToken: "",
  refreshToken: "",
  idToken: "",
  chatgptAccountId: "",
  workspaceId: "",
  chatgptPlanType: "",
});

const availableCount = computed(
  () => accounts.value.filter((item) => item.isAvailable !== false).length,
);
const unavailableCount = computed(() => accounts.value.length - availableCount.value);
const activeApiKey = computed(
  () => apiKeys.value.find((item) => String(item.status || "").toLowerCase() !== "disabled") || null,
);
const activeApiKeyModeLabel = computed(() => {
  const strategy = activeApiKey.value?.rotationStrategy;
  if (strategy === "aggregate_api_rotation") return "聚合API模式";
  if (strategy === "hybrid_rotation") return "混合模式";
  if (strategy === "account_rotation") return "账号模式";
  return "未启用";
});
const planTypes = computed(() => {
  const counts = new Map<string, number>();
  for (const item of accounts.value) {
    const value = normalizePlanValue(item.planType || item.subscriptionPlan || "unknown");
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
});
const statusCountAccounts = computed(() =>
  accounts.value.filter((item) => {
    const value = keyword.value.trim().toLowerCase();
    const matchKeyword =
      !value ||
      [item.id, item.name, item.label].some((part) =>
        String(part || "").toLowerCase().includes(value),
      );
    const matchPlan = planFilter.value === "all" || normalizePlanValue(item.planType || item.subscriptionPlan) === planFilter.value;
    return matchKeyword && matchPlan;
  }),
);
const statusFilterOptions = computed(() => [
  { value: "all", label: `全部 (${statusCountAccounts.value.length})` },
  {
    value: "available",
    label: `正常 (${statusCountAccounts.value.filter((item) => item.isAvailable !== false).length})`,
  },
  {
    value: "limited",
    label: `限流 (${statusCountAccounts.value.filter((item) => isLimitedAccount(item)).length})`,
  },
  {
    value: "banned",
    label: `封禁 (${statusCountAccounts.value.filter((item) => isBannedAccount(item)).length})`,
  },
]);
const filteredAccounts = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  return accounts.value.filter((item) => {
    const matchKeyword =
      !value ||
      [item.id, item.name, item.label, item.note, ...(item.tags || [])].some((part) =>
        String(part || "").toLowerCase().includes(value),
      );
    const matchPlan = planFilter.value === "all" || normalizePlanValue(item.planType || item.subscriptionPlan) === planFilter.value;
    const matchStatus =
      statusFilter.value === "all" ||
      (statusFilter.value === "available" && item.isAvailable !== false) ||
      (statusFilter.value === "limited" && isLimitedAccount(item)) ||
      (statusFilter.value === "banned" && isBannedAccount(item));
    return matchKeyword && matchPlan && matchStatus;
  });
});
const cleanupMatchedCount = computed(
  () => accounts.value.filter((item) => cleanupStatuses.value.includes(cleanupStatusOf(item))).length,
);
const allRtFailureDeleteSelected = computed(
  () =>
    rtFailureDeleteItems.value.length > 0 &&
    rtFailureDeleteItems.value.every((item) =>
      rtFailureDeleteSelectedIds.value.includes(item.accountId),
    ),
);
const someRtFailureDeleteSelected = computed(() => rtFailureDeleteSelectedIds.value.length > 0);
const pagedAccounts = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredAccounts.value.slice(start, start + pageSize.value);
});
const totalPages = computed(() => Math.max(1, Math.ceil(filteredAccounts.value.length / pageSize.value)));
const allPageSelected = computed(
  () => pagedAccounts.value.length > 0 && pagedAccounts.value.every((item) => selectedIds.value.includes(item.id)),
);
const somePageSelected = computed(() => pagedAccounts.value.some((item) => selectedIds.value.includes(item.id)));
const accountMetricCards = computed(() => [
  {
    label: "今日Token",
    value: formatMetricNumber(tokenStats.value.todayTokens),
    hint: "输入 + 输出合计",
    icon: Lightning,
    iconClass: "account-metric-card__icon account-metric-card__icon--yellow",
  },
  {
    label: "缓存Token",
    value: formatMetricNumber(tokenStats.value.cachedInputTokens),
    hint: "上下文缓存命中",
    icon: Coin,
    iconClass: "account-metric-card__icon account-metric-card__icon--blue",
  },
  {
    label: "推理Token",
    value: formatMetricNumber(tokenStats.value.reasoningOutputTokens),
    hint: "大模型思考过程",
    icon: DataLine,
    iconClass: "account-metric-card__icon account-metric-card__icon--purple",
  },
  {
    label: "预计费用",
    value: formatUsd(tokenStats.value.estimatedCost),
    hint: "按官价估算",
    icon: Money,
    iconClass: "account-metric-card__icon account-metric-card__icon--green",
  },
]);

watch([keyword, planFilter, statusFilter, pageSize], () => {
  page.value = 1;
});

watch(totalPages, (value) => {
  if (page.value > value) page.value = value;
});

function readPercent(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : null;
}

function hasPrimaryUsageSignal(row: AccountSummary): boolean {
  return readPercent(row.usage?.usedPercent) != null || row.usage?.windowMinutes != null;
}

function hasSecondaryUsageSignal(row: AccountSummary): boolean {
  return readPercent(row.usage?.secondaryUsedPercent) != null || row.usage?.secondaryWindowMinutes != null;
}

function isLongWindow(minutes: unknown): boolean {
  const numeric = Number(minutes);
  return Number.isFinite(numeric) && numeric > 24 * 60 + 3;
}

function isSecondaryOnlyUsage(row: AccountSummary): boolean {
  return (
    hasPrimaryUsageSignal(row) &&
    !hasSecondaryUsageSignal(row) &&
    (isLongWindow(row.usage?.windowMinutes) ||
      String(row.planType || row.subscriptionPlan || "").toLowerCase() === "free")
  );
}

function isPrimaryOnlyUsage(row: AccountSummary): boolean {
  return hasPrimaryUsageSignal(row) && !hasSecondaryUsageSignal(row) && !isSecondaryOnlyUsage(row);
}

function secondaryUsagePercent(row: AccountSummary): number | null {
  const remainPercent = readPercent(row.secondaryRemainPercent);
  if (remainPercent != null) return remainPercent;
  const usedPercent = readPercent(row.usage?.secondaryUsedPercent);
  if (usedPercent != null) return Math.max(0, 100 - usedPercent);
  return isSecondaryOnlyUsage(row) ? readPercent(row.primaryRemainPercent) : null;
}

function primaryUsagePercent(row: AccountSummary): number | null {
  const remainPercent = readPercent(row.primaryRemainPercent);
  if (remainPercent != null) return remainPercent;
  const usedPercent = readPercent(row.usage?.usedPercent);
  return usedPercent == null ? null : Math.max(0, 100 - usedPercent);
}

function primaryEmptyText(row: AccountSummary): string {
  return isSecondaryOnlyUsage(row) ? "未提供" : "--";
}

function secondaryEmptyText(row: AccountSummary): string {
  return isPrimaryOnlyUsage(row) ? "未提供" : "--";
}

function primaryEmptyResetText(row: AccountSummary): string {
  return isSecondaryOnlyUsage(row) ? "未提供" : "未知";
}

function secondaryEmptyResetText(row: AccountSummary): string {
  return isPrimaryOnlyUsage(row) ? "未提供" : "未知";
}

function formatRemainPercent(value: number | null, emptyText: string): string {
  return value == null ? emptyText : `${value}%`;
}

function displayPlan(row: AccountSummary): string {
  return formatPlanLabel(row.planType || row.subscriptionPlan || "unknown");
}

function normalizePlanValue(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "unknown";
}

function formatPlanLabel(value: unknown): string {
  const normalized = normalizePlanValue(value);
  switch (normalized) {
    case "free":
      return "FREE";
    case "go":
      return "GO";
    case "plus":
      return "PLUS";
    case "plus/team":
      return "PLUS/TEAM";
    case "pro":
      return "PRO";
    case "team":
      return "TEAM";
    case "business":
      return "BUSINESS";
    case "enterprise":
      return "ENTERPRISE";
    case "edu":
      return "EDU";
    case "unknown":
      return "未知";
    default:
      return normalized.toUpperCase();
  }
}

function isLimitedAccount(row: AccountSummary): boolean {
  return String(row.status || "").trim().toLowerCase() === "limited";
}

function isBannedAccount(row: AccountSummary): boolean {
  const status = String(row.status || "").trim().toLowerCase();
  const reason = String(row.statusReason || "").trim().toLowerCase();
  return (
    status === "banned" ||
    (status === "unavailable" &&
      ["account_deactivated", "workspace_deactivated", "deactivated_workspace"].includes(reason))
  );
}

function shortAccountId(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.length > 16 ? `${text.slice(0, 16)}...` : text;
}

function formatDateMinute(value?: number | string | null): string {
  const text = formatTime(value);
  return text === "-" ? "未知" : text.slice(0, 16);
}

function formatMetricNumber(value: number): string {
  const numeric = Number(value) || 0;
  const abs = Math.abs(numeric);
  if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `${(numeric / 1_000).toFixed(2).replace(/\.?0+$/, "")}K`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(numeric);
}

function hasQuotaCost(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0;
}

function primaryQuotaCost(row: AccountSummary): unknown {
  return row.primaryWindowCostUsd ?? row.currentWindowCostUsd;
}

function hasPrimaryCost(row: AccountSummary): boolean {
  return row.primaryWindowStartedAt != null && row.primaryWindowResetsAt != null
    && hasQuotaCost(primaryQuotaCost(row));
}

function hasSecondaryCost(row: AccountSummary): boolean {
  return row.secondaryWindowStartedAt != null && row.secondaryWindowResetsAt != null
    && hasQuotaCost(row.secondaryWindowCostUsd);
}

function formatQuotaCost(value: unknown): string {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: normalized > 0 && normalized < 1 ? 4 : 2,
  }).format(normalized);
}

function primaryWindowLabel(_row: AccountSummary): string {
  return "5小时";
}

function secondaryWindowLabel(_row: AccountSummary): string {
  return "1周";
}

function resetAfterLabel(
  resetsAt?: number | string | null,
  emptyTextOrFallbackAt?: number | string | null,
): string {
  const reset = Number(resetsAt);
  if (!Number.isFinite(reset) || reset <= 0) {
    const emptyText =
      typeof emptyTextOrFallbackAt === "string" ? emptyTextOrFallbackAt : "未知";
    return `${emptyText}后刷新`;
  }
  const resetMs = reset > 10_000_000_000 ? reset : reset * 1000;
  const diffMinutes = Math.max(0, Math.round((resetMs - Date.now()) / 60000));
  const days = Math.floor(diffMinutes / (24 * 60));
  const hours = Math.floor((diffMinutes % (24 * 60)) / 60);
  const minutes = diffMinutes % 60;
  if (days > 0) return `${days}d${hours}h${minutes}min后刷新`;
  if (hours > 0) return `${hours}h${minutes}min后刷新`;
  return `${minutes}min后刷新`;
}

function formatAccountStatus(row: AccountSummary): string {
  if (row.availabilityText) return row.availabilityText;
  if (row.statusReason) return row.statusReason;
  if (row.status) return row.status;
  return row.isAvailable === false ? "异常" : "正常";
}

function formatHealthStatus(row: AccountSummary): string {
  return row.isAvailable === false ? "异常" : "正常";
}

function cleanupStatusOf(row: AccountSummary) {
  if (isBannedAccount(row)) return "banned";
  if (isLimitedAccount(row)) return "limited";
  if (String(row.status || "").trim().toLowerCase() === "unavailable") return "unavailable";
  return "";
}

function formatTime(value?: number | string | null): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!numeric || !Number.isFinite(numeric)) return "-";
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(milliseconds).toLocaleString("zh-CN", { hour12: false });
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    minimumFractionDigits: value < 1000 ? 2 : 0,
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

async function loadData() {
  loading.value = true;
  try {
    const [result, usageRows, keys, todaySummary] = await Promise.all([
      listAccounts({ page: 1, pageSize: 1000 }),
      listAccountUsage().catch(() => []),
      listApiKeys().catch(() => []),
      getRequestLogTodaySummary().catch(() => tokenStats.value),
    ]);
    accounts.value = attachUsagesToAccounts(result.items || [], usageRows);
    apiKeys.value = keys;
    tokenStats.value = todaySummary;
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

function apiKeyPayloadForMode(row: ApiKeySummary, rotationStrategy: string) {
  return {
    name: row.name,
    modelSlug: row.modelSlug || row.model || null,
    reasoningEffort: row.reasoningEffort || null,
    serviceTier: String(row.serviceTier || "").trim().toLowerCase() === "fast" ? "fast" : null,
    protocolType: row.protocol || row.clientType || null,
    upstreamBaseUrl: row.upstreamBaseUrl || null,
    staticHeadersJson: row.staticHeadersJson || null,
    rotationStrategy,
    aggregateApiId: rotationStrategy === "aggregate_api_rotation" ? row.aggregateApiId || null : null,
    accountPlanFilter:
      rotationStrategy === "account_rotation" || rotationStrategy === "hybrid_rotation"
        ? row.accountPlanFilter || null
        : null,
  };
}

async function toggleActiveApiKeyMode() {
  const row = activeApiKey.value;
  if (!row) {
    ElMessage.warning("当前没有启用的平台密钥");
    return;
  }
  const next =
    row.rotationStrategy === "aggregate_api_rotation"
      ? "account_rotation"
      : "aggregate_api_rotation";
  switchingApiKeyMode.value = true;
  try {
    await updateApiKey(row.id, apiKeyPayloadForMode(row, next));
    ElMessage.success(`已切换为${next === "aggregate_api_rotation" ? "聚合API模式" : "账号模式"}`);
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    switchingApiKeyMode.value = false;
  }
}

function handleSelectionChange(rows: AccountSummary[]) {
  selectedIds.value = rows.map((item) => item.id);
}

function toggleAccountSelection(accountId: string) {
  if (selectedIds.value.includes(accountId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== accountId);
    return;
  }
  selectedIds.value = [...selectedIds.value, accountId];
}

function togglePageSelection(checked: string | number | boolean) {
  const pageIds = pagedAccounts.value.map((item) => item.id);
  if (Boolean(checked)) {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...pageIds]));
    return;
  }
  selectedIds.value = selectedIds.value.filter((id) => !pageIds.includes(id));
}

async function toggleAccountEnabled(row: AccountSummary, checked: string | number | boolean) {
  const enabled = Boolean(checked);
  rowLoadingId.value = row.id;
  try {
    await updateAccountProfile(row.id, { preferred: enabled });
    ElMessage.success(enabled ? "账号已启用" : "账号已取消启用");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    rowLoadingId.value = "";
  }
}

async function refreshUsage(accountId?: string) {
  refreshing.value = true;
  rowLoadingId.value = accountId || "";
  try {
    await refreshAccounts(accountId);
    ElMessage.success(accountId ? "账号用量已刷新" : "全部账号用量刷新已触发");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    refreshing.value = false;
    rowLoadingId.value = "";
  }
}

async function refreshTokens(accountId?: string) {
  refreshingTokens.value = true;
  try {
    if (accountId) {
      await refreshAccountTokens(accountId);
      ElMessage.success("AT/RT 刷新已触发");
    } else {
      const result = await refreshAllAccountTokens();
      const failedItems = buildRtRefreshFailureDeleteItems(result);
      if (failedItems.length) {
        rtFailureDeleteItems.value = failedItems;
        rtFailureDeleteSelectedIds.value = failedItems.map((item) => item.accountId);
        rtFailureDeleteDialogOpen.value = true;
        ElMessage.warning(`AT/RT 刷新完成：成功 ${result.succeeded} 个，失败 ${failedItems.length} 个`);
      } else {
        ElMessage.success(`AT/RT 刷新完成：成功 ${result.succeeded} 个`);
      }
    }
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    refreshingTokens.value = false;
  }
}

function handleAccountCommand(command: string | number) {
  switch (command) {
    case "refresh-usage":
      void refreshUsage();
      break;
    case "refresh-rt":
      void refreshTokens();
      break;
    case "refresh-list":
      void loadData();
      break;
    case "login":
      addAccountTab.value = "login";
      addAccountDialogOpen.value = true;
      break;
    case "json":
      importDialogOpen.value = true;
      break;
    case "file":
      void runFileImport();
      break;
    case "directory":
    case "cpa-directory":
    case "sub2api-directory":
      void runDirectoryImport();
      break;
    case "export":
      exportDialogOpen.value = true;
      break;
    case "warmup":
      void runWarmup(selectedIds.value);
      break;
    case "delete-selected":
      void confirmDeleteSelected();
      break;
    case "cleanup":
      cleanupDialogOpen.value = true;
      break;
  }
}

async function handleRowCommand(command: string | number, row: AccountSummary) {
  if (command === "rt") {
    await refreshTokens(row.id);
    return;
  }
  if (command === "preferred") {
    await setPreferred(row);
    return;
  }
  if (command === "warmup") {
    await runWarmup([row.id]);
    return;
  }
  if (command === "delete") {
    await confirmDelete(row);
  }
}

function formatRtRefreshFailureReason(message: string | null | undefined) {
  const normalized = String(message || "").trim();
  const lower = normalized.toLowerCase();
  if (lower === "missing token" || lower.includes("token not found")) {
    return "缺少账号 token";
  }
  if (lower === "missing refresh_token" || lower.includes("missing refresh token")) {
    return "缺少 refresh_token";
  }
  return normalized || "未知原因";
}

function buildRtRefreshFailureDeleteItems(result: AccountTokenRefreshAllResult) {
  return result.results
    .filter((item) => !item.ok && item.accountId.trim())
    .map((item) => ({
      accountId: item.accountId.trim(),
      accountName: item.accountName.trim() || item.accountId.trim(),
      reason: formatRtRefreshFailureReason(item.message),
    }));
}

function toggleRtFailureDeleteSelection(accountId: string) {
  if (rtFailureDeleteSelectedIds.value.includes(accountId)) {
    rtFailureDeleteSelectedIds.value = rtFailureDeleteSelectedIds.value.filter((id) => id !== accountId);
    return;
  }
  rtFailureDeleteSelectedIds.value = [...rtFailureDeleteSelectedIds.value, accountId];
}

function toggleAllRtFailureDeleteSelection() {
  const allIds = rtFailureDeleteItems.value.map((item) => item.accountId);
  rtFailureDeleteSelectedIds.value = allRtFailureDeleteSelected.value ? [] : allIds;
}

async function setPreferred(row: AccountSummary) {
  try {
    await updateAccountProfile(row.id, { preferred: !row.preferred });
    ElMessage.success(row.preferred ? "已取消首选账号" : "已设为首选账号");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  }
}

async function runWarmup(accountIds: string[]) {
  warming.value = true;
  try {
    const result = await warmupAccounts(accountIds, "hi");
    const failedItems = buildWarmupFailureItems(result);
    if (result.requested <= 0) {
      ElMessage.info("当前没有可预热的账号");
      return;
    }
    if (failedItems.length) {
      warmupFailureItems.value = failedItems;
      warmupFailureDialogOpen.value = true;
      ElMessage.warning(`预热完成：成功 ${result.succeeded} 个，失败 ${failedItems.length} 个`);
      return;
    }
    ElMessage.success(`预热完成：共 ${result.requested} 个账号，成功 ${result.succeeded} 个`);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    warming.value = false;
  }
}

function buildWarmupFailureItems(result: AccountWarmupResult) {
  return result.results
    .filter((item) => !item.ok)
    .map((item) => ({
      accountId: item.accountId.trim(),
      accountName: item.accountName.trim() || item.accountId.trim() || "未知账号",
      reason: item.message.trim() || "未知原因",
    }));
}

async function runFileImport() {
  importing.value = true;
  try {
    await importAccountsByFile();
    ElMessage.success("文件导入已完成");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    importing.value = false;
  }
}

async function runDirectoryImport() {
  importing.value = true;
  try {
    await importAccountsByDirectory();
    ElMessage.success("文件夹导入已完成");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    importing.value = false;
  }
}

async function submitJsonImport() {
  const content = jsonDraft.value.trim();
  if (!content) {
    ElMessage.warning("请先粘贴账号 JSON");
    return;
  }
  importing.value = true;
  try {
    await importAccounts(buildBulkImportContents(content));
    importDialogOpen.value = false;
    jsonDraft.value = "";
    ElMessage.success("账号已导入");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    importing.value = false;
  }
}

function pickImportTokenField(record: unknown, keys: string[]): string {
  const source =
    record && typeof record === "object" && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : null;
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeSingleImportRecord(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const source = record as Record<string, unknown>;
  if (source.tokens && typeof source.tokens === "object" && !Array.isArray(source.tokens)) {
    return record;
  }

  const accessToken = pickImportTokenField(record, ["access_token", "accessToken"]);
  if (!accessToken) return record;
  const idToken = pickImportTokenField(record, ["id_token", "idToken"]);
  const refreshToken = pickImportTokenField(record, ["refresh_token", "refreshToken"]);
  const accountId = pickImportTokenField(record, [
    "account_id",
    "accountId",
    "chatgpt_account_id",
    "chatgptAccountId",
  ]);
  return {
    ...source,
    tokens: {
      access_token: accessToken,
      ...(idToken ? { id_token: idToken } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    },
  };
}

function normalizeImportContentForCompatibility(rawContent: string): string {
  const text = String(rawContent || "").trim();
  if (!text) return text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed.map(normalizeSingleImportRecord));
    }
    if (parsed && typeof parsed === "object") {
      return JSON.stringify(normalizeSingleImportRecord(parsed));
    }
  } catch {
    return text;
  }
  return text;
}

function findJsonValueEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") continue;
    const open = stack[stack.length - 1];
    if ((char === "}" && open !== "{") || (char === "]" && open !== "[")) return -1;
    stack.pop();
    if (!stack.length) return index + 1;
  }
  return -1;
}

function extractJsonImportContents(rawContent: string): string[] {
  const text = String(rawContent || "");
  const contents: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "{" && char !== "[") continue;
    const end = findJsonValueEnd(text, index);
    if (end <= index) continue;
    const candidate = text.slice(index, end).trim();
    try {
      JSON.parse(candidate);
      contents.push(normalizeImportContentForCompatibility(candidate));
      index = end - 1;
    } catch {
      // 继续向后查找下一个 JSON 片段。
    }
  }
  return contents;
}

function buildBulkImportContents(rawContent: string): string[] {
  const text = String(rawContent || "").trim();
  if (!text) return [];
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(text);
      return [normalizeImportContentForCompatibility(text)];
    } catch {
      const extracted = extractJsonImportContents(text);
      if (extracted.length) return extracted;
    }
  }
  const extracted = extractJsonImportContents(text);
  if (extracted.length) return extracted;
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeImportContentForCompatibility(item));
}

async function submitBulkImport() {
  const contents = buildBulkImportContents(bulkDraft.value);
  if (!contents.length) {
    ElMessage.warning("请先粘贴账号数据");
    return;
  }
  importing.value = true;
  try {
    await importAccounts(contents);
    addAccountDialogOpen.value = false;
    ElMessage.success("账号导入完成");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    importing.value = false;
  }
}

async function startBrowserLogin() {
  loginLoading.value = true;
  loginHint.value = "";
  try {
    const result = await startLogin({
      tags: loginTags.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      note: loginNote.value,
    });
    loginUrl.value = result.authUrl || result.verificationUrl || "";
    loginHint.value = result.userCode
      ? `设备验证码：${result.userCode}，正在等待授权完成...`
      : "已生成登录链接，正在等待授权完成...";
    if (result.loginId) {
      void waitForLogin(result.loginId);
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loginLoading.value = false;
  }
}

async function waitForLogin(loginId: string) {
  const token = loginPollToken.value + 1;
  loginPollToken.value = token;
  pollingLogin.value = true;
  const deadline = Date.now() + 2 * 60 * 1000;
  while (loginPollToken.value === token && Date.now() < deadline) {
    try {
      const result = await getLoginStatus(loginId);
      if (loginPollToken.value !== token) return;
      const status = result.status.trim().toLowerCase();
      if (status === "success") {
        ElMessage.success("登录成功");
        addAccountDialogOpen.value = false;
        await loadData();
        return;
      }
      if (status === "failed") {
        loginHint.value = `登录失败：${result.error || "未知原因"}`;
        ElMessage.error(loginHint.value);
        return;
      }
    } catch {
      // 轮询中偶发失败继续等待。
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
  }
  if (loginPollToken.value === token) {
    loginHint.value = "登录超时，请重试或使用手动解析回调。";
  }
  pollingLogin.value = false;
}

async function submitManualCallback() {
  if (!manualCallback.value.trim()) {
    ElMessage.warning("请先粘贴回调 URL");
    return;
  }
  loginLoading.value = true;
  try {
    const url = new URL(manualCallback.value.trim());
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    if (!state || !code) {
      throw new Error("回调 URL 缺少 state 或 code");
    }
    await completeLogin(state, code, `${url.origin}${url.pathname}`);
    ElMessage.success("登录成功");
    addAccountDialogOpen.value = false;
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loginLoading.value = false;
  }
}

async function submitTokenLogin() {
  const accessToken = tokenForm.value.accessToken.trim();
  if (!accessToken) {
    ElMessage.warning("请填写 access_token");
    return;
  }
  loginLoading.value = true;
  try {
    await loginWithChatgptAuthTokens({
      accessToken,
      refreshToken: tokenForm.value.refreshToken,
      idToken: tokenForm.value.idToken,
      chatgptAccountId: tokenForm.value.chatgptAccountId,
      workspaceId: tokenForm.value.workspaceId,
      chatgptPlanType: tokenForm.value.chatgptPlanType,
    });
    ElMessage.success("Token 已导入");
    addAccountDialogOpen.value = false;
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loginLoading.value = false;
  }
}

async function copyText(text: string) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  ElMessage.success("已复制到剪贴板");
}

function resetAddAccountDialog() {
  loginPollToken.value += 1;
  pollingLogin.value = false;
  loginLoading.value = false;
  loginTags.value = "";
  loginNote.value = "";
  loginUrl.value = "";
  loginHint.value = "";
  manualCallback.value = "";
  bulkDraft.value = "";
  tokenForm.value = {
    accessToken: "",
    refreshToken: "",
    idToken: "",
    chatgptAccountId: "",
    workspaceId: "",
    chatgptPlanType: "",
  };
}

async function submitExport() {
  exporting.value = true;
  try {
    await exportAccounts(selectedIds.value, exportMode.value);
    exportDialogOpen.value = false;
    ElMessage.success("账号已导出");
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    exporting.value = false;
  }
}

async function confirmDeleteSelected() {
  if (!selectedIds.value.length) return;
  await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 个账号吗？`, "删除账号", {
    type: "warning",
  });
  deleting.value = true;
  try {
    await deleteAccounts(selectedIds.value);
    selectedIds.value = [];
    ElMessage.success("选中账号已删除");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    deleting.value = false;
  }
}

async function confirmDelete(row: AccountSummary) {
  await ElMessageBox.confirm(`确定删除账号 ${row.label || row.id} 吗？`, "删除账号", {
    type: "warning",
  });
  deleting.value = true;
  try {
    await deleteAccount(row.id);
    ElMessage.success("账号已删除");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    deleting.value = false;
  }
}

async function submitCleanup() {
  if (!cleanupStatuses.value.length) {
    ElMessage.warning("请选择要清理的状态");
    return;
  }
  deleting.value = true;
  try {
    await deleteAccountsByStatuses(cleanupStatuses.value);
    cleanupDialogOpen.value = false;
    ElMessage.success("状态清理已完成");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    deleting.value = false;
  }
}

async function confirmRtFailureDelete() {
  if (!rtFailureDeleteSelectedIds.value.length) {
    ElMessage.warning("请先勾选要删除的账号");
    return;
  }
  const targetIds = [...rtFailureDeleteSelectedIds.value];
  deleting.value = true;
  try {
    await deleteAccounts(targetIds);
    rtFailureDeleteDialogOpen.value = false;
    rtFailureDeleteItems.value = [];
    rtFailureDeleteSelectedIds.value = [];
    selectedIds.value = selectedIds.value.filter((id) => !targetIds.includes(id));
    ElMessage.success("已删除选中的刷新失败账号");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    deleting.value = false;
  }
}

function openEditor(row: AccountSummary) {
  editingAccountId.value = row.id;
  editor.value = {
    label: row.label || row.name || "",
    tags: (row.tags || []).join(","),
    note: row.note || "",
  };
  editorOpen.value = true;
}

async function saveEditor() {
  savingEditor.value = true;
  try {
    await updateAccountProfile(editingAccountId.value, {
      label: editor.value.label,
      tags: editor.value.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      note: editor.value.note,
    });
    editorOpen.value = false;
    ElMessage.success("账号信息已保存");
    await loadData();
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    savingEditor.value = false;
  }
}

onMounted(loadData);
onUnmounted(() => {
  loginPollToken.value += 1;
});
</script>

<style scoped lang="scss">
.accounts-page {
  gap: 24px;

  .account-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .account-metric-card {
    min-height: 128px;
    padding: 18px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--card-solid);

    &__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 600;
    }

    &__icon {
      font-size: 18px;

      &--yellow {
        color: #f5b400;
      }

      &--blue {
        color: #4f7cff;
      }

      &--purple {
        color: #9a4dff;
      }

      &--green {
        color: #00b578;
      }
    }

    &__value {
      margin-top: 28px;
      color: #111827;
      font-size: 25px;
      font-weight: 800;
      line-height: 1;
    }

    &__hint {
      margin-top: 10px;
      color: var(--text-secondary);
      font-size: 12px;
    }
  }

  .account-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--card-solid);

    &__filters {
      display: grid;
      grid-template-columns: 200px 140px 150px;
      gap: 12px;
      min-width: 0;
    }

    &__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .mode-button {
      min-width: 178px;
      justify-content: space-between;

      span {
        color: var(--text-secondary);
        font-size: 11px;
        line-height: 1;
      }

      strong {
        font-size: 13px;
      }
    }
  }

  .account-table-card {
    overflow-x: auto;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--card-solid);
  }

  .account-table {
    display: grid;
    grid-template-columns: 48px minmax(360px, 1.35fr) 120px minmax(560px, 1.9fr) 150px 100px;
    min-width: 1280px;
    align-items: center;
    column-gap: 16px;
    padding: 0 8px;

    &--head {
      height: 48px;
      color: var(--text-primary);
      font-size: 14px;
      font-weight: 700;
    }

    &--row {
      min-height: 92px;
      border-top: 1px solid var(--border-subtle);
    }

    &__body {
      display: grid;
    }
  }

  .account-info {
    display: grid;
    gap: 4px;
    min-width: 0;

    &__title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;

      strong {
        overflow: hidden;
        color: var(--text-primary);
        font-size: 15px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    &__id,
    &__meta {
      overflow: hidden;
      color: var(--text-secondary);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .account-badge {
    flex: 0 0 auto;
    padding: 2px 8px;
    border-radius: 999px;
    background: #d7f8ee;
    color: #008c61;
    font-size: 10px;
    font-weight: 800;
    line-height: 18px;
  }

  .quota-detail {
    display: grid;
    gap: 10px;
  }

  .quota-row {
    display: grid;
    grid-template-columns: 120px minmax(120px, 1fr) 44px 112px;
    align-items: center;
    gap: 10px;
    color: var(--text-secondary);
    font-size: 12px;

    &__label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .quota-bar {
    overflow: hidden;
    height: 4px;
    border-radius: 999px;
    background: #dbe7ff;

    &__fill {
      display: block;
      height: 100%;
      border-radius: inherit;

      &--green {
        background: #00c853;
      }

      &--blue {
        background: #2f6cf6;
      }
    }
  }

  .account-state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #00a650;
    font-size: 13px;

    &::before {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: currentColor;
      content: "";
    }

    &--danger {
      color: var(--danger);
    }
  }

  .row-actions {
    display: flex;
    justify-content: center;

    .el-button {
      font-size: 17px;
    }
  }

  .account-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 13px;

    &__pager {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--text-primary);
    }

    .page-size-select {
      width: 72px;
    }
  }

  .accounts-filter {
    grid-template-columns: minmax(220px, 1fr) 150px 150px auto;
    margin-bottom: 16px;
  }

  .data-table {
    min-width: 1040px;
  }

  .el-progress {
    margin-bottom: 4px;
  }

  .manual-callback {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border-subtle);

    h3 {
      margin: 0 0 4px;
      font-size: 14px;
    }
  }

  .login-url-box {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  .dialog-footer-inline {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }

  .cleanup-summary {
    margin-top: 12px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .failure-list {
    display: grid;
    gap: 8px;
    max-height: 420px;
    overflow-y: auto;
    margin-top: 14px;
  }

  .failure-item {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(160px, 1fr);
    gap: 4px 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);

    span:last-child {
      grid-column: 1 / -1;
      color: var(--danger);
      font-size: 12px;
    }

    &--selectable {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: flex-start;

      .failure-item__content {
        display: grid;
        gap: 4px;
        min-width: 0;

        strong,
        span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        span:last-child {
          color: var(--danger);
          font-size: 12px;
        }
      }
    }
  }

  .failure-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--table-section-bg);

    span {
      color: var(--text-secondary);
      font-size: 12px;
    }
  }
}

@media (max-width: 980px) {
  .accounts-page {
    .account-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .account-toolbar {
      align-items: stretch;
      flex-direction: column;

      &__filters {
        grid-template-columns: 1fr;
      }

      &__actions {
        justify-content: flex-start;
      }
    }

    .account-footer {
      align-items: flex-start;
      flex-direction: column;

      &__pager {
        flex-wrap: wrap;
      }
    }

    .accounts-filter {
      grid-template-columns: 1fr;
    }
  }
}

@media (max-width: 640px) {
  .accounts-page {
    .account-summary-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
