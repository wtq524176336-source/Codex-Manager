"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccounts } from "@/hooks/useAccounts";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useDesktopPageActive } from "@/hooks/useDesktopPageActive";
import { usePageTransitionReady } from "@/hooks/usePageTransitionReady";
import { useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities";
import { useI18n } from "@/lib/i18n/provider";
import {
  type AccountEditorState,
  type DeleteDialogState,
  accountMatchesPlanFilter,
  normalizeTagsDraft,
  type RtRefreshFailureDeleteItem,
  type StatusFilter,
  type WarmupFailureItem,
} from "@/app/accounts/accounts-page-helpers";
import { AccountsPageView } from "@/app/accounts/accounts-page-view";
import type { AddAccountModalMode } from "@/components/modals/add-account-modal";
import { accountClient } from "@/lib/api/account-client";
import type { AccountWarmupResult } from "@/lib/api/account-maintenance";
import { isBannedAccount, isLimitedAccount } from "@/lib/utils/usage";
import type { Account, ChatgptAuthTokensRefreshAllResult } from "@/types";

type CleanupStatus = "unavailable" | "banned" | "limited";

const CLEANUP_STATUSES: CleanupStatus[] = [
  "unavailable",
  "banned",
  "limited",
];

function normalizeCleanupStatus(status: string): CleanupStatus | null {
  const normalized = String(status || "").trim().toLowerCase();
  return CLEANUP_STATUSES.includes(normalized as CleanupStatus)
    ? (normalized as CleanupStatus)
    : null;
}

function formatRtRefreshFailureReason(
  message: string | null | undefined,
  t: (message: string, values?: Record<string, string | number>) => string,
) {
  const normalized = String(message || "").trim();
  const lower = normalized.toLowerCase();
  if (lower === "missing token") {
    return t("缺少 token");
  }
  if (lower === "missing refresh_token") {
    return t("缺少 refresh_token");
  }
  return normalized || t("未知原因");
}

function buildRtRefreshFailureDeleteItems(
  result: ChatgptAuthTokensRefreshAllResult | undefined,
  t: (message: string, values?: Record<string, string | number>) => string,
): RtRefreshFailureDeleteItem[] {
  return (result?.results || [])
    .filter((item) => !item.ok && item.accountId.trim())
    .map((item) => ({
      accountId: item.accountId.trim(),
      accountName: item.accountName.trim() || item.accountId.trim(),
      reason: formatRtRefreshFailureReason(item.message, t),
    }));
}

function buildWarmupFailureItems(
  result: AccountWarmupResult | undefined,
  t: (message: string, values?: Record<string, string | number>) => string,
): WarmupFailureItem[] {
  return (result?.results || [])
    .filter((item) => !item.ok)
    .map((item) => {
      const accountId = item.accountId.trim();
      const accountName = item.accountName.trim();
      const reason = item.message.trim();
      return {
        accountId,
        accountName: accountName || accountId || t("未知账号"),
        reason: reason || t("未知原因"),
      };
    });
}

export default function AccountsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { isDesktopRuntime, canUseBrowserDownloadExport } =
    useRuntimeCapabilities();
  const {
    accounts,
    planTypes,
    isLoading,
    isServiceReady,
    refreshAccount,
    refreshAccountRt,
    refreshAllAccountRt,
    refreshAllAccounts,
    refreshAccountList,
    deleteAccount,
    deleteManyAccounts,
    cleanupAccountsByStatuses,
    importByFile,
    importByDirectory,
    exportAccounts,
    warmupAccounts,
    isRefreshingAccountId,
    isRefreshingAllAccounts,
    isExporting,
    isWarmingUpAccounts,
    isRefreshingRtAccountId,
    isRefreshingAllRtAccounts,
    isDeletingMany,
    isCleaningAccountsByStatus,
    setPreferredAccount,
    clearPreferredAccount,
    isUpdatingPreferred,
    updateAccountProfile,
    isUpdatingProfileAccountId,
  } = useAccounts();
  const { stats: usageStats, isLoading: isUsageStatsLoading } =
    useDashboardStats("/accounts/");
  const isPageActive = useDesktopPageActive("/accounts/");
  usePageTransitionReady("/accounts/", !isServiceReady || !isLoading);
  const { data: apiKeys = [] } = useQuery({
    queryKey: ["apikeys"],
    queryFn: () => accountClient.listApiKeys(),
    enabled: isServiceReady && isPageActive,
    retry: 1,
  });

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pageSize, setPageSize] = useState("20");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);
  const [addAccountModalMode, setAddAccountModalMode] =
    useState<AddAccountModalMode>("login");
  const [usageModalOpen, setUsageModalOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportModeDraft, setExportModeDraft] = useState<"single" | "multiple">(
    "multiple",
  );
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [accountEditorState, setAccountEditorState] =
    useState<AccountEditorState | null>(null);
  const [deleteDialogState, setDeleteDialogState] =
    useState<DeleteDialogState>(null);
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupStatusDraft, setCleanupStatusDraft] = useState<CleanupStatus[]>([
    "unavailable",
    "banned",
  ]);
  const [rtFailureDeleteDialogOpen, setRtFailureDeleteDialogOpen] =
    useState(false);
  const [rtFailureDeleteItems, setRtFailureDeleteItems] = useState<
    RtRefreshFailureDeleteItem[]
  >([]);
  const [rtFailureDeleteSelectedIds, setRtFailureDeleteSelectedIds] = useState<
    string[]
  >([]);
  const [warmupFailureDialogOpen, setWarmupFailureDialogOpen] = useState(false);
  const [warmupFailureItems, setWarmupFailureItems] = useState<
    WarmupFailureItem[]
  >([]);
  const [switchingApiKeyId, setSwitchingApiKeyId] = useState<string | null>(null);

  const importFileActionLabel = isDesktopRuntime
    ? t("按文件导入")
    : t("选择文件导入");
  const importCpaDirectoryActionLabel = isDesktopRuntime
    ? t("导入 CPA 格式文件夹")
    : t("选择 CPA 格式目录");
  const importSub2ApiDirectoryActionLabel = isDesktopRuntime
    ? t("导入 sub2api 格式文件夹")
    : t("选择 sub2api 格式目录");
  const exportActionLabel =
    !isDesktopRuntime && canUseBrowserDownloadExport
      ? t("导出到浏览器")
      : t("导出账号");
  const exportActionShortcut = isExporting
    ? "..."
    : !isDesktopRuntime && canUseBrowserDownloadExport
      ? "DL"
      : "ZIP";

  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => {
      const matchSearch =
        !search ||
        account.name.toLowerCase().includes(search.toLowerCase()) ||
        account.id.toLowerCase().includes(search.toLowerCase());
      const matchPlan =
        planFilter === "all" || accountMatchesPlanFilter(account, planFilter);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "available" && account.isAvailable) ||
        (statusFilter === "limited" && isLimitedAccount(account)) ||
        (statusFilter === "banned" && isBannedAccount(account));
      return matchSearch && matchPlan && matchStatus;
    });
  }, [accounts, planFilter, search, statusFilter]);

  const statusCountAccounts = useMemo(() => {
    return accounts.filter((account) => {
      const matchSearch =
        !search ||
        account.name.toLowerCase().includes(search.toLowerCase()) ||
        account.id.toLowerCase().includes(search.toLowerCase());
      const matchPlan =
        planFilter === "all" || accountMatchesPlanFilter(account, planFilter);
      return matchSearch && matchPlan;
    });
  }, [accounts, planFilter, search]);

  const statusFilterOptions = useMemo(
    () => [
      {
        id: "all" as const,
        label: `${t("全部")} (${statusCountAccounts.length})`,
      },
      {
        id: "available" as const,
        label: `${t("正常")} (${statusCountAccounts.filter((account) => account.isAvailable).length})`,
      },
      {
        id: "limited" as const,
        label: `${t("限流")} (${statusCountAccounts.filter((account) => isLimitedAccount(account)).length})`,
      },
      {
        id: "banned" as const,
        label: `${t("封禁")} (${statusCountAccounts.filter((account) => isBannedAccount(account)).length})`,
      },
    ],
    [statusCountAccounts, t],
  );

  const cleanupStatusCounts = useMemo(() => {
    const counts = new Map<CleanupStatus, number>(
      CLEANUP_STATUSES.map((status) => [status, 0] as const),
    );
    for (const account of accounts) {
      const status = normalizeCleanupStatus(account.status);
      if (status) {
        counts.set(status, (counts.get(status) || 0) + 1);
      }
    }
    return counts;
  }, [accounts]);

  const cleanupStatusOptions = useMemo(
    () =>
      [
        {
          id: "unavailable" as const,
          label: t("不可用"),
          description: t("AT/RT 过期、用量接口 401/403 等不可用账号"),
        },
        {
          id: "banned" as const,
          label: t("封禁"),
          description: t("账号或工作区被官方停用的账号"),
        },
        {
          id: "limited" as const,
          label: t("用量限制"),
          description: t("明确触发 usage_limit_reached 的账号，不包含低额度账号"),
        },
      ].map((option) => ({
        ...option,
        count: cleanupStatusCounts.get(option.id as CleanupStatus) || 0,
      })),
    [cleanupStatusCounts, t],
  );

  const pageSizeNumber = Number(pageSize) || 20;
  const totalPages = Math.max(
    1,
    Math.ceil(filteredAccounts.length / pageSizeNumber),
  );
  const safePage = Math.min(page, totalPages);
  const accountIdSet = useMemo(
    () => new Set(accounts.map((account) => account.id)),
    [accounts],
  );
  const effectiveSelectedIds = useMemo(
    () => selectedIds.filter((id) => accountIdSet.has(id)),
    [accountIdSet, selectedIds],
  );
  const exportSelectionCount = effectiveSelectedIds.length;
  const exportTargetCount =
    exportSelectionCount > 0 ? exportSelectionCount : accounts.length;
  const exportScopeText =
    exportSelectionCount > 0
      ? `${t("当前已选择")} ${exportSelectionCount} ${t("个账号，本次将只导出选中的账号。")}`
      : `${t("当前未选择账号，本次将导出全部")} ${accounts.length} ${t("个账号。")}`;
  const enabledApiKeys = useMemo(
    () =>
      apiKeys.filter(
        (key) => String(key.status || "").toLowerCase() !== "disabled",
      ),
    [apiKeys],
  );
  const activeApiKey = enabledApiKeys[0] || null;
  const activeApiKeyMode = activeApiKey
    ? activeApiKey.rotationStrategy === "aggregate_api_rotation"
      ? "aggregate"
      : activeApiKey.rotationStrategy === "hybrid_rotation"
        ? "hybrid"
        : "account"
    : "none";

  const handleToggleActiveApiKeyMode = async () => {
    if (!activeApiKey) {
      toast.info(t("当前没有启用的平台密钥"));
      return;
    }
    const nextRotationStrategy =
      activeApiKey.rotationStrategy === "aggregate_api_rotation"
        ? "account_rotation"
        : "aggregate_api_rotation";
    setSwitchingApiKeyId(activeApiKey.id);
    try {
      await accountClient.updateApiKey(activeApiKey.id, {
        name: activeApiKey.name || null,
        modelSlug: activeApiKey.modelSlug || null,
        reasoningEffort: activeApiKey.reasoningEffort || null,
        serviceTier: activeApiKey.serviceTier || null,
        protocolType: activeApiKey.protocol || null,
        upstreamBaseUrl: activeApiKey.upstreamBaseUrl || null,
        staticHeadersJson: activeApiKey.staticHeadersJson || null,
        rotationStrategy: nextRotationStrategy,
        aggregateApiId:
          nextRotationStrategy === "aggregate_api_rotation"
            ? activeApiKey.aggregateApiId || null
            : null,
        accountPlanFilter:
          nextRotationStrategy === "account_rotation"
            ? activeApiKey.accountPlanFilter || null
            : null,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["apikeys"] }),
        queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
      ]);
      toast.success(t("平台密钥模式已切换"));
    } catch (error: unknown) {
      toast.error(
        `${t("切换失败")}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setSwitchingApiKeyId(null);
    }
  };

  const visibleAccounts = useMemo(() => {
    const offset = (safePage - 1) * pageSizeNumber;
    return filteredAccounts.slice(offset, offset + pageSizeNumber);
  }, [filteredAccounts, pageSizeNumber, safePage]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );
  const currentEditingAccount = useMemo(
    () =>
      accountEditorState
        ? (accounts.find(
            (account) => account.id === accountEditorState.accountId,
          ) ?? null)
        : null,
    [accountEditorState, accounts],
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handlePlanFilterChange = (value: string | null) => {
    setPlanFilter(value || "all");
    setPage(1);
  };

  const handleStatusFilterChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handlePageSizeChange = (value: string | null) => {
    setPageSize(value || "20");
    setPage(1);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleAccounts.map((account) => account.id);
    const allSelected = visibleIds.every((id) =>
      effectiveSelectedIds.includes(id),
    );
    setSelectedIds((current) => {
      if (allSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const openUsage = (account: Account) => {
    setSelectedAccountId(account.id);
    setUsageModalOpen(true);
  };

  const handleUsageModalOpenChange = (open: boolean) => {
    setUsageModalOpen(open);
    if (!open) {
      setSelectedAccountId("");
    }
  };

  const handleDeleteSelected = () => {
    if (!effectiveSelectedIds.length) {
      toast.error(t("请先选择要删除的账号"));
      return;
    }
    setDeleteDialogState({
      kind: "selected",
      ids: [...effectiveSelectedIds],
      count: effectiveSelectedIds.length,
    });
  };

  const openCleanupDialog = () => {
    if (!accounts.length) {
      toast.info(t("当前没有可清理的账号"));
      return;
    }
    setCleanupDialogOpen(true);
  };

  const toggleCleanupStatus = (rawStatus: string) => {
    const status = normalizeCleanupStatus(rawStatus);
    if (!status) {
      return;
    }
    setCleanupStatusDraft((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status],
    );
  };

  const handleConfirmCleanupStatuses = async () => {
    if (!cleanupStatusDraft.length) {
      toast.error(t("请至少选择一种账号状态"));
      return;
    }
    const targetCount = cleanupStatusDraft.reduce(
      (total, status) => total + (cleanupStatusCounts.get(status) || 0),
      0,
    );
    if (targetCount <= 0) {
      toast.info(t("当前没有匹配所选状态的账号"));
      return;
    }
    try {
      await cleanupAccountsByStatuses(cleanupStatusDraft);
      setCleanupDialogOpen(false);
    } catch {
      // hook 内统一处理 toast，这里保持弹窗不关闭
    }
  };

  const handleWarmupAccounts = async () => {
    if (accounts.length <= 0) {
      toast.info(t("当前没有可预热的账号"));
      return;
    }
    try {
      const result = await warmupAccounts({
        accountIds: [],
        message: "hi",
      });
      const failedItems = buildWarmupFailureItems(result, t);
      if (failedItems.length > 0) {
        setWarmupFailureItems(failedItems);
        setWarmupFailureDialogOpen(true);
      }
    } catch {
      // 中文注释：错误提示已在 hook 内统一处理，这里不重复提示。
    }
  };

  const openExportDialog = () => {
    if (!isServiceReady) {
      toast.info(t("服务未连接，暂时无法导出账号"));
      return;
    }
    if (!accounts.length) {
      toast.info(t("当前没有可导出的账号"));
      return;
    }
    setExportModeDraft("multiple");
    setExportDialogOpen(true);
  };

  const handleConfirmExport = async () => {
    if (exportTargetCount <= 0) {
      toast.info(t("当前没有可导出的账号"));
      return;
    }
    try {
      await exportAccounts({
        selectedAccountIds:
          exportSelectionCount > 0 ? effectiveSelectedIds : [],
        exportMode: exportModeDraft,
      });
      setExportDialogOpen(false);
    } catch {
      // 中文注释：错误提示已在 hook 内统一处理，这里只阻止弹窗误关闭。
    }
  };

  const handleDeleteSingle = (account: Account) => {
    setDeleteDialogState({ kind: "single", account });
  };

  const handleRefreshAllAccountRt = async () => {
    try {
      const result = await refreshAllAccountRt();
      const failedItems = buildRtRefreshFailureDeleteItems(result, t);
      if (!failedItems.length) {
        return;
      }
      setRtFailureDeleteItems(failedItems);
      setRtFailureDeleteSelectedIds(failedItems.map((item) => item.accountId));
      setRtFailureDeleteDialogOpen(true);
    } catch {
      // hook 内已经提示错误
    }
  };

  const toggleRtFailureDeleteSelection = (accountId: string) => {
    setRtFailureDeleteSelectedIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  };

  const toggleAllRtFailureDeleteSelection = () => {
    const allIds = rtFailureDeleteItems.map((item) => item.accountId);
    setRtFailureDeleteSelectedIds((current) =>
      allIds.length > 0 && allIds.every((id) => current.includes(id))
        ? []
        : allIds,
    );
  };

  const openAccountEditor = (account: Account) => {
    setAccountEditorState({
      accountId: account.id,
      accountName: account.name,
      currentLabel: account.label,
      currentTags: account.tags.join(", "),
      currentNote: account.note || "",
    });
    setLabelDraft(account.label);
    setTagsDraft(account.tags.join(", "));
    setNoteDraft(account.note || "");
  };

  const handleConfirmAccountEditor = async () => {
    if (!accountEditorState) return;

    const nextLabel = labelDraft.trim();
    const nextTags = normalizeTagsDraft(tagsDraft);
    const nextTagsText = nextTags.join(", ");
    const nextNote = noteDraft.trim();

    if (!nextLabel) {
      toast.error(t("请输入账号名称"));
      return;
    }
    if (
      nextLabel === accountEditorState.currentLabel &&
      nextTagsText === accountEditorState.currentTags &&
      nextNote === accountEditorState.currentNote
    ) {
      setAccountEditorState(null);
      return;
    }

    try {
      await updateAccountProfile(accountEditorState.accountId, {
        label: nextLabel,
        note: nextNote || null,
        tags: nextTags,
      });
      setAccountEditorState(null);
    } catch {
      // mutation 已统一处理 toast，这里保持弹窗不关闭
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteDialogState) return;
    if (deleteDialogState.kind === "single") {
      deleteAccount(deleteDialogState.account.id);
      return;
    }
    deleteManyAccounts(deleteDialogState.ids);
    setSelectedIds((current) =>
      current.filter((id) => !deleteDialogState.ids.includes(id)),
    );
  };

  const handleConfirmRtFailureDelete = async () => {
    if (!rtFailureDeleteSelectedIds.length) {
      toast.error(t("请先勾选要删除的账号"));
      return;
    }
    const targetIds = [...rtFailureDeleteSelectedIds];
    try {
      await deleteManyAccounts(targetIds);
      setRtFailureDeleteDialogOpen(false);
      setRtFailureDeleteItems([]);
      setRtFailureDeleteSelectedIds([]);
      setSelectedIds((current) => current.filter((id) => !targetIds.includes(id)));
    } catch {
      // hook 内已经提示错误，保留弹窗便于用户重试或取消
    }
  };

  return (
    <AccountsPageView
      accounts={accounts}
      planTypes={planTypes}
      isLoading={isLoading}
      isServiceReady={isServiceReady}
      isPageActive={isPageActive}
      search={search}
      planFilter={planFilter}
      statusFilter={statusFilter}
      pageSize={pageSize}
      safePage={safePage}
      totalPages={totalPages}
      filteredAccounts={filteredAccounts}
      visibleAccounts={visibleAccounts}
      effectiveSelectedIds={effectiveSelectedIds}
      addAccountModalOpen={addAccountModalOpen}
      addAccountModalMode={addAccountModalMode}
      usageModalOpen={usageModalOpen}
      exportDialogOpen={exportDialogOpen}
      exportModeDraft={exportModeDraft}
      exportTargetCount={exportTargetCount}
      exportScopeText={exportScopeText}
      activeApiKey={activeApiKey}
      activeApiKeyMode={activeApiKeyMode}
      enabledApiKeyCount={enabledApiKeys.length}
      isSwitchingApiKeyMode={Boolean(switchingApiKeyId)}
      selectedAccount={selectedAccount}
      accountEditorState={accountEditorState}
      deleteDialogState={deleteDialogState}
      cleanupDialogOpen={cleanupDialogOpen}
      cleanupStatusDraft={cleanupStatusDraft}
      cleanupStatusOptions={cleanupStatusOptions}
      rtFailureDeleteDialogOpen={rtFailureDeleteDialogOpen}
      rtFailureDeleteItems={rtFailureDeleteItems}
      rtFailureDeleteSelectedIds={rtFailureDeleteSelectedIds}
      warmupFailureDialogOpen={warmupFailureDialogOpen}
      warmupFailureItems={warmupFailureItems}
      currentEditingAccount={currentEditingAccount}
      labelDraft={labelDraft}
      tagsDraft={tagsDraft}
      noteDraft={noteDraft}
      isRefreshingAllAccounts={isRefreshingAllAccounts}
      isRefreshingAccountId={isRefreshingAccountId}
      isRefreshingRtAccountId={isRefreshingRtAccountId}
      isRefreshingAllRtAccounts={isRefreshingAllRtAccounts}
      isExporting={isExporting}
      isWarmingUpAccounts={isWarmingUpAccounts}
      isDeletingMany={isDeletingMany}
      isCleaningAccountsByStatus={isCleaningAccountsByStatus}
      isUpdatingPreferred={isUpdatingPreferred}
      isUpdatingProfileAccountId={isUpdatingProfileAccountId}
      statusFilterOptions={statusFilterOptions}
      importFileActionLabel={importFileActionLabel}
      importCpaDirectoryActionLabel={importCpaDirectoryActionLabel}
      importSub2ApiDirectoryActionLabel={importSub2ApiDirectoryActionLabel}
      exportActionLabel={exportActionLabel}
      exportActionShortcut={exportActionShortcut}
      setAddAccountModalOpen={setAddAccountModalOpen}
      setAddAccountModalMode={setAddAccountModalMode}
      setExportDialogOpen={setExportDialogOpen}
      setExportModeDraft={setExportModeDraft}
      setDeleteDialogState={setDeleteDialogState}
      setCleanupDialogOpen={setCleanupDialogOpen}
      setRtFailureDeleteDialogOpen={setRtFailureDeleteDialogOpen}
      setWarmupFailureDialogOpen={setWarmupFailureDialogOpen}
      setAccountEditorState={setAccountEditorState}
      setLabelDraft={setLabelDraft}
      setTagsDraft={setTagsDraft}
      setNoteDraft={setNoteDraft}
      setPage={setPage}
      handleSearchChange={handleSearchChange}
      handlePlanFilterChange={handlePlanFilterChange}
      handleStatusFilterChange={handleStatusFilterChange}
      handlePageSizeChange={handlePageSizeChange}
      toggleSelect={toggleSelect}
      toggleSelectAllVisible={toggleSelectAllVisible}
      openUsage={openUsage}
      handleUsageModalOpenChange={handleUsageModalOpenChange}
      handleDeleteSelected={handleDeleteSelected}
      openCleanupDialog={openCleanupDialog}
      toggleCleanupStatus={toggleCleanupStatus}
      handleConfirmCleanupStatuses={handleConfirmCleanupStatuses}
      toggleRtFailureDeleteSelection={toggleRtFailureDeleteSelection}
      toggleAllRtFailureDeleteSelection={toggleAllRtFailureDeleteSelection}
      handleConfirmRtFailureDelete={handleConfirmRtFailureDelete}
      handleWarmupAccounts={handleWarmupAccounts}
      openExportDialog={openExportDialog}
      handleConfirmExport={handleConfirmExport}
      handleToggleActiveApiKeyMode={handleToggleActiveApiKeyMode}
      handleDeleteSingle={handleDeleteSingle}
      openAccountEditor={openAccountEditor}
      handleConfirmAccountEditor={handleConfirmAccountEditor}
      handleConfirmDelete={handleConfirmDelete}
      refreshAllAccounts={refreshAllAccounts}
      refreshAllAccountRt={handleRefreshAllAccountRt}
      refreshAccountList={refreshAccountList}
      refreshAccountRt={refreshAccountRt}
      importByFile={importByFile}
      importByDirectory={importByDirectory}
      refreshAccount={refreshAccount}
      clearPreferredAccount={clearPreferredAccount}
      setPreferredAccount={setPreferredAccount}
      usageStats={usageStats}
      isUsageStatsLoading={isUsageStatsLoading}
    />
  );
}
