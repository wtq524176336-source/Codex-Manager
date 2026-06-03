<template>
  <div class="page models-page">
    <section class="models-intro">
      <el-tag class="models-intro__badge" effect="plain">模型目录</el-tag>
      <div>
        <h2>模型管理</h2>
        <p>
          这里维护本地结构化模型目录。默认绑定模型会优先展示 supportedInApi=true 的模型，而 Codex CLI 仍会拿到完整目录。
        </p>
      </div>
      <div class="models-intro__badges">
        <el-tag round effect="light">完整目录会同步到 Codex CLI</el-tag>
        <el-tag round effect="light">默认绑定优先展示 API 可用模型</el-tag>
        <el-tag round effect="light">远端刷新可与本地覆写共存</el-tag>
      </div>
    </section>

    <div class="page-card page-card--flush models-card">
      <div class="models-card__header">
        <div class="models-card__title-row">
          <div>
            <h3>模型目录明细</h3>
            <p>按 slug、显示名称或描述快速定位，并结合来源与覆写状态查看当前目录。</p>
          </div>
          <div class="models-card__actions">
            <el-button :loading="loading" @click="loadData(false)">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
            <el-button :loading="refreshingRemote" @click="loadData(true)">
              <el-icon><RefreshRight /></el-icon>
              远端并入
            </el-button>
            <el-button :loading="syncingCache" :disabled="!models.length" @click="syncCodexCache">
              <el-icon><Download /></el-icon>
              导出到本地 Codex 缓存
            </el-button>
            <el-button
              :disabled="!selectedSlugs.length"
              :loading="deleting"
              @click="confirmBatchDelete"
            >
              <el-icon><Delete /></el-icon>
              批量删除模型
            </el-button>
            <el-button type="primary" @click="openCreate">
              <el-icon><Plus /></el-icon>
              新增自定义模型
            </el-button>
          </div>
        </div>

        <div class="mini-stat-row">
          <span class="mini-stat">模型总数 <strong>{{ models.length }}</strong></span>
          <span class="mini-stat">API 可用 <strong>{{ apiEnabledCount }}</strong></span>
          <span class="mini-stat">自定义模型 <strong>{{ customCount }}</strong></span>
          <span class="mini-stat">本地覆写 <strong>{{ editedCount }}</strong></span>
          <el-tag round effect="light">当前筛选 {{ currentFilterLabel }}</el-tag>
          <el-tag round effect="light">共 {{ filteredModels.length }} 条</el-tag>
          <el-tag v-if="selectedSlugs.length" round effect="light">已选 {{ selectedSlugs.length }} 项</el-tag>
        </div>

        <div class="models-card__filters">
          <el-input v-model="keyword" clearable placeholder="搜索 slug、显示名称或描述">
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select v-model="filter">
            <el-option label="全部模型" value="all" />
            <el-option label="仅 API 可用" value="api" />
            <el-option label="仅自定义" value="custom" />
            <el-option label="仅本地覆写" value="edited" />
          </el-select>
        </div>

        <div class="models-card__hint">
          保存后会自动同步到 ~/.codex/models_cache.json；如需让 /model 立即看到最新模型与说明，仍需重启正在运行中的 Codex 会话。Web 端可通过上方导出按钮下载同名 models_cache.json，再手动放入本地 ~/.codex/；桌面端继续由本地自动同步。
        </div>
      </div>
      <div class="table-scroll">
        <el-table
          v-loading="loading"
          :data="filteredModels"
          class="models-table"
          row-key="slug"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="44" />
          <el-table-column label="模型" min-width="320">
            <template #default="{ row }">
              <div class="name-cell">
                <strong>{{ row.displayName || row.name || row.slug }}</strong>
                <span class="mono">{{ row.slug }}</span>
                <span>{{ row.description || "无描述" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="来源" width="150">
            <template #default="{ row }">
              <el-tag :type="row.sourceKind === 'custom' ? 'primary' : 'info'" effect="light">
                {{ sourceLabel(row) }}
              </el-tag>
              <el-tag v-if="row.userEdited" class="edited-tag" type="warning" effect="light">
                已覆写
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="API" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.supportedInApi ? 'success' : 'info'" effect="light">
                {{ row.supportedInApi ? "可用" : "隐藏" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="可见性" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.visibility === 'list'" effect="light">list</el-tag>
              <el-tag v-else-if="row.visibility === 'hide'" type="info" effect="plain">hide</el-tag>
              <el-tag v-else type="info" effect="light">未设置</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="推理等级" min-width="160">
            <template #default="{ row }">
              <span v-if="reasoningLevelText(row)">{{ reasoningLevelText(row) }}</span>
              <span v-else-if="row.defaultReasoningLevel">{{ row.defaultReasoningLevel }}</span>
              <span v-else class="muted">未设置</span>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="88" fixed="right" align="right">
            <template #default="{ row }">
              <el-dropdown trigger="click" @command="handleRowCommand($event, row)">
                <el-button text>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑模型</el-dropdown-item>
                    <el-dropdown-item command="delete" class="danger-item">删除模型</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="modalOpen" :title="editingSlug ? '编辑模型' : '新增自定义模型'" width="980px">
      <div class="form-grid">
        <el-input v-model="form.slug" placeholder="slug，例如 gpt-5" />
        <el-input v-model="form.displayName" placeholder="显示名称" />
        <el-select v-model="form.sourceKind" placeholder="来源类型">
          <el-option label="自定义" value="custom" />
          <el-option label="远端同步" value="remote" />
        </el-select>
        <el-input-number v-model="form.sortIndex" :min="0" controls-position="right" placeholder="排序权重" />
        <el-input-number v-model="form.priority" :min="0" controls-position="right" placeholder="优先级" />
        <el-input-number
          v-model="form.contextWindow"
          :min="0"
          controls-position="right"
          placeholder="上下文窗口"
        />
        <el-select v-model="form.visibility" placeholder="可见性">
          <el-option label="list" value="list" />
          <el-option label="hide" value="hide" />
        </el-select>
        <el-select v-model="form.defaultReasoningLevel" clearable placeholder="默认推理等级">
          <el-option label="minimal" value="minimal" />
          <el-option label="low" value="low" />
          <el-option label="medium" value="medium" />
          <el-option label="high" value="high" />
        </el-select>
      </div>
      <div class="form-grid form-grid--single form-extra">
        <el-switch v-model="form.supportedInApi" active-text="API 可用" inactive-text="API 隐藏" />
        <el-switch v-model="form.userEdited" active-text="保留本地覆写" inactive-text="允许远端覆盖" />
        <el-input
          v-model="form.description"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 10 }"
          placeholder="模型说明"
        />
        <el-input
          v-model="form.advancedJson"
          type="textarea"
          :autosize="{ minRows: 12, maxRows: 24 }"
          placeholder='{"inputModalities":["text","image"],"supportedReasoningLevels":[{"effort":"medium","description":"balanced"}]}'
        />
        <p class="dialog-hint">
          高级 JSON 用于维护 supportedReasoningLevels、truncationPolicy、availableInPlans、工具能力等官方模型目录字段。
        </p>
      </div>
      <template #footer>
        <el-button @click="modalOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveModelForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Delete, Download, MoreFilled, Plus, Refresh, RefreshRight, Search } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";

import { deleteModel, listModels, saveModel, syncCodexModelsCache } from "@/api/model";
import { getErrorMessage } from "@/api/http";
import type { ModelInfo } from "@/types/common";

const models = ref<ModelInfo[]>([]);
const keyword = ref("");
const filter = ref("all");
const selectedSlugs = ref<string[]>([]);
const loading = ref(false);
const refreshingRemote = ref(false);
const syncingCache = ref(false);
const saving = ref(false);
const deleting = ref(false);
const modalOpen = ref(false);
const editingSlug = ref("");
const form = reactive({
  slug: "",
  displayName: "",
  description: "",
  sourceKind: "custom",
  userEdited: true,
  sortIndex: 0,
  visibility: "list",
  supportedInApi: true,
  priority: 0,
  contextWindow: 0,
  defaultReasoningLevel: "",
  advancedJson: "",
});

const editableAdvancedKeys = [
  "supportedReasoningLevels",
  "shellType",
  "additionalSpeedTiers",
  "availabilityNux",
  "upgrade",
  "baseInstructions",
  "modelMessages",
  "supportsReasoningSummaries",
  "defaultReasoningSummary",
  "supportVerbosity",
  "defaultVerbosity",
  "applyPatchToolType",
  "webSearchToolType",
  "truncationPolicy",
  "supportsParallelToolCalls",
  "supportsImageDetailOriginal",
  "contextWindow",
  "autoCompactTokenLimit",
  "effectiveContextWindowPercent",
  "experimentalSupportedTools",
  "inputModalities",
  "minimalClientVersion",
  "supportsSearchTool",
  "availableInPlans",
];
const coreModelKeys = [
  "slug",
  "displayName",
  "display_name",
  "name",
  "description",
  "source",
  "sourceKind",
  "source_kind",
  "userEdited",
  "user_edited",
  "supportedInApi",
  "supported_in_api",
  "sortIndex",
  "sort_index",
  "updatedAt",
  "updated_at",
  "priority",
  "visibility",
  "defaultReasoningLevel",
  "default_reasoning_level",
  ...editableAdvancedKeys,
];

const apiEnabledCount = computed(
  () => models.value.filter((item) => item.supportedInApi !== false).length,
);
const customCount = computed(
  () => models.value.filter((item) => item.sourceKind === "custom").length,
);
const editedCount = computed(
  () => models.value.filter((item) => item.userEdited).length,
);
const currentFilterLabel = computed(() => {
  switch (filter.value) {
    case "api":
      return "仅 API 可用";
    case "custom":
      return "仅自定义";
    case "edited":
      return "仅本地覆写";
    default:
      return "全部模型";
  }
});
const filteredModels = computed(() => {
  const value = keyword.value.trim().toLowerCase();
  return models.value.filter((item) => {
    const matchKeyword =
      !value ||
      [item.slug, item.displayName, item.name, item.description].some((part) =>
        String(part || "").toLowerCase().includes(value),
      );
    const matchFilter =
      filter.value === "all" ||
      (filter.value === "api" && item.supportedInApi !== false) ||
      (filter.value === "custom" && item.sourceKind === "custom") ||
      (filter.value === "edited" && item.userEdited);
    return matchKeyword && matchFilter;
  });
});

function sourceLabel(row: ModelInfo) {
  if (row.sourceKind === "custom") return "自定义";
  if (row.sourceKind === "remote") return "远端";
  if (row.sourceKind === "builtin") return "内置";
  return row.sourceKind || row.source || "未知";
}

function compact(value: number) {
  return value
    ? new Intl.NumberFormat("zh-CN", {
        notation: value >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value)
    : "-";
}

function reasoningLevelText(row: ModelInfo) {
  return Array.isArray(row.supportedReasoningLevels)
    ? row.supportedReasoningLevels
        .map((item) => String(item.effort || item.level || "").trim())
        .filter(Boolean)
        .join(" / ")
    : "";
}

function toPrettyJson(value: unknown) {
  if (
    !value ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Record<string, unknown>).length === 0)
  ) {
    return "";
  }
  if (Array.isArray(value) && value.length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("高级 JSON 必须是对象");
  }
  return parsed as Record<string, unknown>;
}

function buildAdvancedJson(model?: ModelInfo | null) {
  if (!model) {
    return toPrettyJson({
      inputModalities: ["text", "image"],
      supportedReasoningLevels: [],
      additionalSpeedTiers: [],
      experimentalSupportedTools: [],
      availableInPlans: [],
    });
  }
  const entries = Object.entries(model);
  const advanced = Object.fromEntries(entries.filter(([key]) => editableAdvancedKeys.includes(key)));
  const extra = Object.fromEntries(entries.filter(([key]) => !coreModelKeys.includes(key)));
  return toPrettyJson({ ...advanced, ...extra });
}

function nextSortIndex() {
  return Math.max(-1, ...models.value.map((item) => Number(item.sortIndex) || 0)) + 1;
}

function formatTime(value?: number | string | null) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!numeric || !Number.isFinite(numeric)) return "-";
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(milliseconds).toLocaleString("zh-CN", { hour12: false });
}

async function loadData(refreshRemote = false) {
  if (refreshRemote) refreshingRemote.value = true;
  loading.value = true;
  try {
    models.value = await listModels(refreshRemote);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    loading.value = false;
    refreshingRemote.value = false;
  }
}

async function syncCodexCache() {
  syncingCache.value = true;
  try {
    const result = await syncCodexModelsCache(models.value);
    ElMessage.success(
      result.mode === "browser"
        ? "Codex 缓存已下载，请保存到 ~/.codex/models_cache.json"
        : result.cachePath
        ? `已导出到本地 Codex 模型缓存：${result.cachePath}`
        : `已导出 ${result.modelsCount} 个模型到本地 Codex 缓存`,
    );
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    syncingCache.value = false;
  }
}

function handleSelectionChange(rows: ModelInfo[]) {
  selectedSlugs.value = rows.map((item) => item.slug);
}

function resetForm() {
  Object.assign(form, {
    slug: "",
    displayName: "",
    description: "",
    sourceKind: "custom",
    userEdited: true,
    sortIndex: nextSortIndex(),
    visibility: "list",
    supportedInApi: true,
    priority: 0,
    contextWindow: 0,
    defaultReasoningLevel: "",
    advancedJson: buildAdvancedJson(null),
  });
}

function openCreate() {
  editingSlug.value = "";
  resetForm();
  modalOpen.value = true;
}

function openEdit(row: ModelInfo) {
  editingSlug.value = row.slug;
  Object.assign(form, {
    slug: row.slug,
    displayName: row.displayName || row.name || row.slug,
    description: row.description || "",
    sourceKind: row.sourceKind || "custom",
    userEdited: row.userEdited !== false,
    sortIndex: Number(row.sortIndex) || 0,
    visibility: row.visibility || "list",
    supportedInApi: row.supportedInApi !== false,
    priority: Number(row.priority) || 0,
    contextWindow: Number(row.contextWindow) || 0,
    defaultReasoningLevel: row.defaultReasoningLevel || "",
    advancedJson: buildAdvancedJson(row),
  });
  modalOpen.value = true;
}

function handleRowCommand(command: string | number, row: ModelInfo) {
  if (command === "edit") {
    openEdit(row);
    return;
  }
  if (command === "delete") {
    void confirmDelete(row);
  }
}

async function saveModelForm() {
  if (!form.slug.trim()) {
    ElMessage.warning("请填写模型 slug");
    return;
  }
  saving.value = true;
  try {
    const advancedFields = parseJsonObject(form.advancedJson);
    await saveModel(
      {
        ...advancedFields,
        slug: form.slug.trim(),
        displayName: form.displayName.trim() || form.slug.trim(),
        name: form.displayName.trim() || form.slug.trim(),
        description: form.description,
        visibility: form.visibility,
        supportedInApi: form.supportedInApi,
        priority: form.priority,
        contextWindow: form.contextWindow || null,
        defaultReasoningLevel: form.defaultReasoningLevel || null,
        sourceKind: form.sourceKind,
        userEdited: form.userEdited,
        sortIndex: form.sortIndex,
      },
      editingSlug.value,
    );
    modalOpen.value = false;
    ElMessage.success("模型已保存");
    await loadData(false);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function confirmDelete(row: ModelInfo) {
  await ElMessageBox.confirm(`确定删除模型 ${row.slug} 吗？`, "删除模型", { type: "warning" });
  deleting.value = true;
  try {
    await deleteModel(row.slug);
    ElMessage.success("模型已删除");
    await loadData(false);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    deleting.value = false;
  }
}

async function confirmBatchDelete() {
  await ElMessageBox.confirm(`确定删除选中的 ${selectedSlugs.value.length} 个模型吗？`, "批量删除模型", {
    type: "warning",
  });
  deleting.value = true;
  try {
    for (const slug of selectedSlugs.value) {
      await deleteModel(slug);
    }
    selectedSlugs.value = [];
    ElMessage.success("选中模型已删除");
    await loadData(false);
  } catch (error) {
    ElMessage.error(getErrorMessage(error));
  } finally {
    deleting.value = false;
  }
}

onMounted(() => loadData(false));
</script>

<style scoped lang="scss">
.models-page {
  gap: 18px;

  .models-intro {
    display: grid;
    gap: 10px;

    &__badge {
      width: fit-content;
      border-color: rgba(37, 99, 235, 0.18);
      background: rgba(37, 99, 235, 0.08);
      color: var(--primary);
    }

    h2 {
      margin: 0;
      font-size: 30px;
      font-weight: 760;
      letter-spacing: 0;
    }

    p {
      max-width: 920px;
      margin: 6px 0 0;
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.7;
    }

    &__badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  }

  .models-card {
    &__header {
      display: grid;
      gap: 14px;
      padding: 18px;
      border-bottom: 1px solid var(--border-subtle);
    }

    &__title-row {
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
        margin: 6px 0 0;
        color: var(--text-secondary);
        font-size: 12px;
      }
    }

    &__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    &__filters {
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(180px, 280px);
      gap: 12px;
    }

    &__hint {
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.7;
    }
  }

  .mini-stat-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .mini-stat {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.45);
    color: var(--text-secondary);
    font-size: 12px;

    strong {
      color: var(--text-primary);
      font-weight: 700;
    }
  }

  .models-filter {
    grid-template-columns: minmax(260px, 1fr) 170px auto;
  }

  .models-table {
    min-width: 1120px;
  }

  .edited-tag {
    margin-left: 6px;
  }

  .form-extra {
    margin-top: 14px;
  }
}

@media (max-width: 760px) {
  .models-page {
    .models-card {
      &__title-row {
        display: grid;
      }

      &__actions {
        justify-content: flex-start;
      }

      &__filters {
        grid-template-columns: 1fr;
      }
    }

    .models-filter {
      grid-template-columns: 1fr;
    }
  }
}
</style>
