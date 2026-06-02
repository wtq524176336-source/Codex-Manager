<template>
  <div class="page models-page">
    <div class="page-hero">
      <div>
        <h2 class="page-hero__title">模型管理</h2>
        <p class="page-hero__desc">
          维护本地结构化模型目录，控制模型是否在 API 中可用，并同步到 Codex CLI 模型缓存。
        </p>
      </div>
      <div class="table-actions">
        <el-button :loading="loading" @click="loadData(false)">刷新</el-button>
        <el-button :loading="refreshingRemote" @click="loadData(true)">刷新远端</el-button>
        <el-button :loading="syncingCache" :disabled="!models.length" @click="syncCodexCache">
          导出 Codex 缓存
        </el-button>
        <el-button type="primary" @click="openCreate">新增自定义模型</el-button>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-card__label">模型总数</div>
        <div class="summary-card__value">{{ models.length }}</div>
        <div class="summary-card__hint">完整目录</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">API 可用</div>
        <div class="summary-card__value">{{ apiEnabledCount }}</div>
        <div class="summary-card__hint">可作为绑定模型</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">自定义模型</div>
        <div class="summary-card__value">{{ customCount }}</div>
        <div class="summary-card__hint">本地新增</div>
      </div>
      <div class="summary-card">
        <div class="summary-card__label">已选择</div>
        <div class="summary-card__value">{{ selectedSlugs.length }}</div>
        <div class="summary-card__hint">批量删除对象</div>
      </div>
    </div>

    <div class="page-card page-card--flush">
      <div class="page-card__body">
        <div class="filter-bar models-filter">
          <el-input v-model="keyword" clearable placeholder="搜索 slug / 名称 / 描述" />
          <el-select v-model="filter">
            <el-option label="全部模型" value="all" />
            <el-option label="仅 API 可用" value="api" />
            <el-option label="仅自定义" value="custom" />
            <el-option label="仅本地覆写" value="edited" />
          </el-select>
          <el-button
            type="danger"
            :disabled="!selectedSlugs.length"
            :loading="deleting"
            @click="confirmBatchDelete"
          >
            批量删除
          </el-button>
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
            <template #default="{ row }">{{ row.visibility || "-" }}</template>
          </el-table-column>
          <el-table-column label="推理等级" min-width="160">
            <template #default="{ row }">
              <span v-if="row.defaultReasoningLevel">{{ row.defaultReasoningLevel }}</span>
              <span v-else-if="reasoningLevelText(row)">{{ reasoningLevelText(row) }}</span>
              <span v-else class="muted">未设置</span>
            </template>
          </el-table-column>
          <el-table-column label="输入 / 计划" min-width="160">
            <template #default="{ row }">
              <div class="model-meta">
                <span>{{ listText(row.inputModalities) || "-" }}</span>
                <span>{{ listText(row.availableInPlans) || "全部计划" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="上下文" width="120">
            <template #default="{ row }">{{ compact(row.contextWindow || 0) }}</template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right" align="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="copyText(row.slug)">复制</el-button>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" @click="confirmDelete(row)">删除</el-button>
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

function listText(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).join(" / ")
    : "";
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

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  ElMessage.success("已复制到剪贴板");
}

onMounted(() => loadData(false));
</script>

<style scoped lang="scss">
.models-page {
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
    .models-filter {
      grid-template-columns: 1fr;
    }
  }
}
</style>
