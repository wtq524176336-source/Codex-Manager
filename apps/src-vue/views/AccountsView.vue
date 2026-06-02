<template>
  <div class="page accounts-page">
    <div class="page-hero">
      <div>
        <h2 class="page-hero__title">账号管理</h2>
        <p class="page-hero__desc">
          管理 ChatGPT 账号、刷新用量、导入导出账号文件，并按状态批量清理不可用账号。
        </p>
      </div>
      <div class="table-actions">
        <el-button
          :disabled="!activeApiKey"
          :loading="switchingApiKeyMode"
          @click="toggleActiveApiKeyMode"
        >
          密钥模式：{{ activeApiKeyModeLabel }}
        </el-button>
        <el-button :loading="loading" @click="loadData">刷新列表</el-button>
        <el-dropdown trigger="click" @command="handleAccountCommand">
          <el-button type="primary">
            账号操作
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="login">添加账号</el-dropdown-item>
              <el-dropdown-item command="json">按 JSON 导入</el-dropdown-item>
              <el-dropdown-item command="file">按文件导入</el-dropdown-item>
              <el-dropdown-item command="directory">导入文件夹</el-dropdown-item>
              <el-dropdown-item command="export">导出账号</el-dropdown-item>
              <el-dropdown-item command="warmup">预热账号</el-dropdown-item>
              <el-dropdown-item divided command="cleanup">按状态清理</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">今日 Token</div>
        <div class="summary-card__value">{{ compactNumber(tokenStats.todayTokens) }}</div>
        <div class="summary-card__hint">输入 + 输出合计</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">缓存 Token</div>
        <div class="summary-card__value">{{ compactNumber(tokenStats.cachedInputTokens) }}</div>
        <div class="summary-card__hint">上下文缓存命中</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">推理 Token</div>
        <div class="summary-card__value">{{ compactNumber(tokenStats.reasoningOutputTokens) }}</div>
        <div class="summary-card__hint">大模型思考过程</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">预计费用</div>
        <div class="summary-card__value summary-card__value--small">{{ formatUsd(tokenStats.estimatedCost) }}</div>
        <div class="summary-card__hint">今日请求日志估算</div>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">账号总数</div>
        <div class="summary-card__value">{{ accounts.length }}</div>
        <div class="summary-card__hint">当前列表</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">可用账号</div>
        <div class="summary-card__value">{{ availableCount }}</div>
        <div class="summary-card__hint">可参与轮转</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">异常账号</div>
        <div class="summary-card__value">{{ unavailableCount }}</div>
        <div class="summary-card__hint">不可用 / 封禁 / 受限</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">已选择</div>
        <div class="summary-card__value">{{ selectedIds.length }}</div>
        <div class="summary-card__hint">批量操作对象</div>
      </div>
    </div>

    <div class="page-card">
      <div class="page-card__body">
        <div class="filter-bar accounts-filter">
          <el-input v-model="keyword" clearable placeholder="搜索账号名 / 编号 / 标签" />
          <el-select v-model="planFilter" placeholder="全部类型">
            <el-option label="全部类型" value="all" />
            <el-option v-for="plan in planTypes" :key="plan" :label="plan" :value="plan" />
          </el-select>
          <el-select v-model="statusFilter" placeholder="全部状态">
            <el-option label="全部状态" value="all" />
            <el-option label="可用" value="available" />
            <el-option label="异常" value="unavailable" />
            <el-option label="低额度" value="limited" />
            <el-option label="封禁" value="banned" />
          </el-select>
          <div class="table-actions">
            <el-button :loading="refreshing" @click="refreshUsage()">刷新用量</el-button>
            <el-button :loading="refreshingTokens" @click="refreshTokens()">刷新 AT/RT</el-button>
            <el-button
              type="danger"
              :disabled="!selectedIds.length"
              :loading="deleting"
              @click="confirmDeleteSelected"
            >
              删除选中
            </el-button>
          </div>
        </div>

        <div class="table-scroll">
          <el-table
            v-loading="loading"
            :data="pagedAccounts"
            class="data-table"
            row-key="id"
            @selection-change="handleSelectionChange"
          >
            <el-table-column type="selection" width="44" />
            <el-table-column label="账号 / 标签" min-width="260">
              <template #default="{ row }">
                <div class="name-cell">
                  <strong>
                    <el-tag v-if="row.preferred" size="small" effect="plain">首选</el-tag>
                    {{ row.label || row.name || row.id }}
                  </strong>
                  <span class="mono">{{ row.id }}</span>
                  <span v-if="row.tags?.length" class="pill-list">
                    <el-tag v-for="tag in row.tags" :key="tag" size="small" type="info">
                      {{ tag }}
                    </el-tag>
                  </span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="150">
              <template #default="{ row }">
                <el-tag effect="light">{{ row.planType || row.subscriptionPlan || "unknown" }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="150">
              <template #default="{ row }">
                <el-tag :type="row.isAvailable === false ? 'danger' : 'success'" effect="light">
                  {{ formatAccountStatus(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="主额度" width="180">
              <template #default="{ row }">
                <el-progress
                  :percentage="readUsedPercent(row)"
                  :stroke-width="8"
                  :show-text="false"
                  :status="readUsedPercent(row) >= 90 ? 'exception' : undefined"
                />
                <span class="muted">{{ readUsedPercent(row) }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="备注" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.note || "-" }}</template>
            </el-table-column>
            <el-table-column label="最后刷新" width="170">
              <template #default="{ row }">{{ formatTime(row.lastRefreshAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="230" fixed="right" align="right">
              <template #default="{ row }">
                <el-button link type="primary" :loading="rowLoadingId === row.id" @click="refreshUsage(row.id)">
                  刷新
                </el-button>
                <el-button link type="primary" @click="openEditor(row)">编辑</el-button>
                <el-dropdown trigger="click" @command="handleRowCommand($event, row)">
                  <el-button link type="primary">更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="rt">刷新 AT/RT</el-dropdown-item>
                      <el-dropdown-item command="preferred">
                        {{ row.preferred ? "取消首选" : "设为首选" }}
                      </el-dropdown-item>
                      <el-dropdown-item command="warmup">预热此账号</el-dropdown-item>
                      <el-dropdown-item divided command="delete">删除账号</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="table-footer">
          <span>共 {{ filteredAccounts.length }} 个账号，当前页 {{ pagedAccounts.length }} 个</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="filteredAccounts.length"
            layout="sizes, prev, pager, next"
            small
          />
        </div>
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
import { ArrowDown } from "@element-plus/icons-vue";
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
const planTypes = computed(() =>
  Array.from(new Set(accounts.value.map((item) => item.planType).filter(Boolean) as string[])),
);
const filteredAccounts = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  return accounts.value.filter((item) => {
    const matchKeyword =
      !value ||
      [item.id, item.name, item.label, item.note, ...(item.tags || [])].some((part) =>
        String(part || "").toLowerCase().includes(value),
      );
    const matchPlan = planFilter.value === "all" || item.planType === planFilter.value;
    const statusText = `${item.status} ${item.statusReason} ${item.availabilityText}`.toLowerCase();
    const matchStatus =
      statusFilter.value === "all" ||
      (statusFilter.value === "available" && item.isAvailable !== false) ||
      (statusFilter.value === "unavailable" && item.isAvailable === false) ||
      (statusFilter.value === "limited" && (item.isLowQuota || statusText.includes("limit"))) ||
      (statusFilter.value === "banned" && statusText.includes("ban"));
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

watch([keyword, planFilter, statusFilter, pageSize], () => {
  page.value = 1;
});

function readUsedPercent(row: AccountSummary): number {
  const value = row.usage?.usedPercent;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function formatAccountStatus(row: AccountSummary): string {
  if (row.availabilityText) return row.availabilityText;
  if (row.statusReason) return row.statusReason;
  if (row.status) return row.status;
  return row.isAvailable === false ? "异常" : "正常";
}

function cleanupStatusOf(row: AccountSummary) {
  const statusText = `${row.status} ${row.statusReason} ${row.availabilityText}`.toLowerCase();
  if (statusText.includes("ban")) return "banned";
  if (row.isLowQuota || statusText.includes("limit")) return "limited";
  if (row.isAvailable === false) return "unavailable";
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
    const [result, keys, todaySummary] = await Promise.all([
      listAccounts({ page: 1, pageSize: 1000 }),
      listApiKeys().catch(() => []),
      getRequestLogTodaySummary().catch(() => tokenStats.value),
    ]);
    accounts.value = result.items || [];
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
      void runDirectoryImport();
      break;
    case "export":
      exportDialogOpen.value = true;
      break;
    case "warmup":
      void runWarmup(selectedIds.value);
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
    .accounts-filter {
      grid-template-columns: 1fr;
    }
  }
}
</style>
