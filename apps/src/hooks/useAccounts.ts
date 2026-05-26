"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { accountClient } from "@/lib/api/account-client";
import { attachUsagesToAccounts } from "@/lib/api/normalize";
import {
  buildStartupSnapshotQueryKey,
  STARTUP_SNAPSHOT_REQUEST_LOG_LIMIT,
} from "@/lib/api/startup-snapshot";
import { getAppErrorMessage } from "@/lib/api/transport";
import { listenUsageRefreshCompleted } from "@/lib/api/usage-refresh-events";
import { useDesktopPageActive } from "@/hooks/useDesktopPageActive";
import { useDeferredDesktopActivation } from "@/hooks/useDeferredDesktopActivation";
import { useLocalDayRange } from "@/hooks/useLocalDayRange";
import { useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities";
import { useI18n } from "@/lib/i18n/provider";
import { useAppStore } from "@/lib/store/useAppStore";
import {
  PLUS_TEAM_PLAN_FILTER,
  normalizePlanFilterValue,
} from "@/lib/utils/account-plan";
import { AccountListResult, AccountUsage, StartupSnapshot } from "@/types";

type ImportByDirectoryResult = Awaited<ReturnType<typeof accountClient.importByDirectory>>;
type ImportByFileResult = Awaited<ReturnType<typeof accountClient.importByFile>>;
type AccountExportPayload = Parameters<typeof accountClient.export>[0];
type ExportResult = Awaited<ReturnType<typeof accountClient.export>>;
type WarmupPayload = Parameters<typeof accountClient.warmup>[0];
type WarmupResult = Awaited<ReturnType<typeof accountClient.warmup>>;
type RefreshAllRtResult = Awaited<
  ReturnType<typeof accountClient.refreshAllChatgptAuthTokens>
>;
type DeleteAccountsByStatusesResult = Awaited<
  ReturnType<typeof accountClient.deleteByStatuses>
>;

/**
 * 函数 `buildImportSummaryMessage`
 *
 * 作者: gaohongshun
 *
 * 时间: 2026-04-02
 *
 * # 参数
 * - result: 参数 result
 *
 * # 返回
 * 返回函数执行结果
 */
function buildImportSummaryMessage(result: ImportByDirectoryResult, t: (message: string, values?: Record<string, string | number>) => string): string {
  const total = Number(result?.total || 0);
  const created = Number(result?.created || 0);
  const updated = Number(result?.updated || 0);
  const failed = Number(result?.failed || 0);
  return t("导入完成：共{total}，新增{created}，更新{updated}，失败{failed}", {
    total,
    created,
    updated,
    failed,
  });
}

/**
 * 函数 `formatUsageRefreshErrorMessage`
 *
 * 作者: gaohongshun
 *
 * 时间: 2026-04-02
 *
 * # 参数
 * - error: 参数 error
 *
 * # 返回
 * 返回函数执行结果
 */
function formatUsageRefreshErrorMessage(
  error: unknown,
  t: (message: string, values?: Record<string, string | number>) => string,
): string {
  const message = getAppErrorMessage(error);
  if (message.toLowerCase().includes("refresh token failed with status 401")) {
    return t("账号长期未登录，refresh 已过期，已改为不可用状态");
  }
  return message;
}

function getAccountsAutoRefreshIntervalMs(
  enabled: boolean,
  intervalSecs: number,
): number | false {
  if (!enabled) {
    return false;
  }
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return false;
  }
  return Math.max(1, intervalSecs) * 1000;
}

function getUsageListRefreshIntervalMs(
  enabled: boolean,
  intervalSecs: number,
): number | false {
  const intervalMs = getAccountsAutoRefreshIntervalMs(enabled, intervalSecs);
  if (!intervalMs) {
    return false;
  }
  return Math.min(5_000, intervalMs);
}

function buildUsageListFingerprint(usages: AccountUsage[]): string {
  if (usages.length === 0) {
    return "";
  }

  return usages
    .map((usage) =>
      [
        usage.accountId,
        usage.capturedAt ?? "",
        usage.usedPercent ?? "",
        usage.secondaryUsedPercent ?? "",
        usage.resetsAt ?? "",
        usage.secondaryResetsAt ?? "",
        usage.availabilityStatus ?? "",
        usage.creditsJson ?? "",
      ].join(":"),
    )
    .sort()
    .join("|");
}

function formatRefreshAllRtReason(
  message: string,
  t: (message: string, values?: Record<string, string | number>) => string,
): string {
  const normalized = message.trim().toLowerCase();
  if (normalized === "missing token") {
    return t("缺少 token");
  }
  if (normalized === "missing refresh_token") {
    return t("缺少 refresh_token");
  }
  return message.trim() || t("未知原因");
}

function formatRefreshAllRtItem(
  item: RefreshAllRtResult["results"][number] | undefined,
  t: (message: string, values?: Record<string, string | number>) => string,
): string {
  if (!item) {
    return "";
  }
  const accountName = String(item.accountName || item.accountId || "").trim();
  const reason = formatRefreshAllRtReason(String(item.message || ""), t);
  if (accountName) {
    return `${t("邮箱")}：${accountName}，${t("原因")}：${reason}`;
  }
  return `${t("原因")}：${reason}`;
}

function formatRefreshAllRtItems(
  items: RefreshAllRtResult["results"],
  t: (message: string, values?: Record<string, string | number>) => string,
): string {
  return items
    .map((item, index) => {
      const detail = formatRefreshAllRtItem(item, t);
      return detail ? `${index + 1}. ${detail}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function isSkippedRefreshAllRtItem(item: RefreshAllRtResult["results"][number]): boolean {
  const message = String(item.message || "").trim().toLowerCase();
  return message === "missing token" || message === "missing refresh_token";
}

function buildRefreshAllRtNotice(
  result: RefreshAllRtResult,
  t: (message: string, values?: Record<string, string | number>) => string,
): { type: "success" | "warning"; message: string } {
  const succeeded = Number(result?.succeeded || 0);
  const failed = Number(result?.failed || 0);
  const skipped = Number(result?.skipped || 0);
  const results = result?.results || [];
  const failedItems = results.filter((item) => !item.ok && !isSkippedRefreshAllRtItem(item));
  const skippedItems = results.filter((item) => !item.ok && isSkippedRefreshAllRtItem(item));
  const failedText = formatRefreshAllRtItems(failedItems, t);
  const skippedText = formatRefreshAllRtItems(skippedItems, t);
  const details = [
    failedText ? `${t("失败账号")}：\n${failedText}` : "",
    skippedText ? `${t("跳过账号")}：\n${skippedText}` : "",
  ].filter(Boolean);
  const summary = t("AT/RT 刷新完成：成功{success}个，失败{failed}个，跳过{skipped}个", {
    success: succeeded,
    failed,
    skipped,
  });
  return {
    type: failed > 0 || skipped > 0 ? "warning" : "success",
    message: details.length ? `${summary}\n${details.join("\n")}` : summary,
  };
}

/**
 * 函数 `useAccounts`
 *
 * 作者: gaohongshun
 *
 * 时间: 2026-04-02
 *
 * # 参数
 * 无
 *
 * # 返回
 * 返回函数执行结果
 */
export function useAccounts() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const localDayRange = useLocalDayRange();
  const serviceStatus = useAppStore((state) => state.serviceStatus);
  const backgroundTasks = useAppStore((state) => state.appSettings.backgroundTasks);
  const { canAccessManagementRpc } = useRuntimeCapabilities();
  const isServiceReady = canAccessManagementRpc && serviceStatus.connected;
  const isPageActive = useDesktopPageActive("/accounts/");
  const areAccountQueriesEnabled = useDeferredDesktopActivation(
    isServiceReady && isPageActive,
  );
  const accountsAutoRefreshIntervalMs = getAccountsAutoRefreshIntervalMs(
    areAccountQueriesEnabled && backgroundTasks.usagePollingEnabled,
    backgroundTasks.usagePollIntervalSecs,
  );
  const usageListRefreshIntervalMs = getUsageListRefreshIntervalMs(
    areAccountQueriesEnabled && backgroundTasks.usagePollingEnabled,
    backgroundTasks.usagePollIntervalSecs,
  );
  const usageListFingerprintRef = useRef<string | null>(null);
  const startupSnapshot = queryClient.getQueryData<StartupSnapshot>(
    buildStartupSnapshotQueryKey(
      serviceStatus.addr,
      STARTUP_SNAPSHOT_REQUEST_LOG_LIMIT,
      localDayRange.dayStartTs,
    )
  );
  const startupAccounts = startupSnapshot?.accounts || [];
  const startupUsages = startupSnapshot?.usageSnapshots || [];
  const hasStartupAccountSnapshot = startupAccounts.length > 0;

  /**
   * 函数 `ensureServiceReady`
   *
   * 作者: gaohongshun
   *
   * 时间: 2026-04-02
   *
   * # 参数
   * - actionLabel: 参数 actionLabel
   *
   * # 返回
   * 返回函数执行结果
   */
  const ensureServiceReady = (actionLabel: string): boolean => {
    if (isServiceReady) {
      return true;
    }
    toast.info(`${t("服务未连接，暂时无法")} ${t(actionLabel)}`);
    return false;
  };

  const accountsQuery = useQuery({
    queryKey: ["accounts", "list"],
    queryFn: () => accountClient.list(),
    enabled: areAccountQueriesEnabled,
    retry: 1,
    refetchInterval: accountsAutoRefreshIntervalMs,
    refetchIntervalInBackground: false,
    placeholderData: (previousData): AccountListResult | undefined =>
      previousData ||
      (startupAccounts.length > 0
        ? {
            items: startupAccounts,
            total: startupAccounts.length,
            page: 1,
            pageSize: startupAccounts.length,
          }
        : undefined),
  });

  const usagesQuery = useQuery({
    queryKey: ["usage", "list"],
    queryFn: () => accountClient.listUsage(),
    enabled: areAccountQueriesEnabled,
    retry: 1,
    refetchInterval: usageListRefreshIntervalMs,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) =>
      previousData || (startupUsages.length > 0 ? startupUsages : undefined),
  });

  const usageListFingerprint = useMemo(
    () => buildUsageListFingerprint(usagesQuery.data || []),
    [usagesQuery.data],
  );

  useEffect(() => {
    if (!areAccountQueriesEnabled) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    const refreshVisibleUsageData = () => {
      void Promise.all([
        queryClient.refetchQueries({ queryKey: ["usage", "list"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["accounts", "list"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["usage-aggregate"] }),
        queryClient.invalidateQueries({ queryKey: ["today-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
      ]);
    };

    void listenUsageRefreshCompleted(() => {
      refreshVisibleUsageData();
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [areAccountQueriesEnabled, queryClient]);

  useEffect(() => {
    if (!areAccountQueriesEnabled) {
      usageListFingerprintRef.current = null;
      return;
    }

    if (!usagesQuery.isFetched) {
      return;
    }

    const previousFingerprint = usageListFingerprintRef.current;
    usageListFingerprintRef.current = usageListFingerprint;
    if (previousFingerprint == null || previousFingerprint === usageListFingerprint) {
      return;
    }

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts", "list"] }),
      queryClient.invalidateQueries({ queryKey: ["usage-aggregate"] }),
      queryClient.invalidateQueries({ queryKey: ["today-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
    ]);
  }, [
    areAccountQueriesEnabled,
    queryClient,
    usageListFingerprint,
    usagesQuery.isFetched,
  ]);

  const accounts = useMemo(() => {
    return attachUsagesToAccounts(
      accountsQuery.data?.items || [],
      usagesQuery.data || []
    );
  }, [accountsQuery.data?.items, usagesQuery.data]);

  const planTypes = useMemo(() => {
    const map = new Map<string, number>();
    const sortOrder = [
      "free",
      "go",
      PLUS_TEAM_PLAN_FILTER,
      "pro",
      "business",
      "enterprise",
      "edu",
      "unknown",
    ];
    /**
     * 函数 `getSortIndex`
     *
     * 作者: gaohongshun
     *
     * 时间: 2026-04-02
     *
     * # 参数
     * - value: 参数 value
     *
     * # 返回
     * 返回函数执行结果
     */
    const getSortIndex = (value: string) => {
      const index = sortOrder.indexOf(value);
      return index === -1 ? sortOrder.length : index;
    };

    for (const account of accounts) {
      const planType = normalizePlanFilterValue(account.planType);
      map.set(planType, (map.get(planType) || 0) + 1);
    }

    return Array.from(map.entries())
      .sort((left, right) => {
        const sortDiff = getSortIndex(left[0]) - getSortIndex(right[0]);
        if (sortDiff !== 0) {
          return sortDiff;
        }
        return left[0].localeCompare(right[0], "zh-Hans-CN");
      })
      .map(([value, count]) => ({ value, count }));
  }, [accounts]);

  /**
   * 函数 `invalidateAll`
   *
   * 作者: gaohongshun
   *
   * 时间: 2026-04-02
   *
   * # 参数
   * 无
   *
   * # 返回
   * 返回函数执行结果
   */
  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      queryClient.invalidateQueries({ queryKey: ["usage"] }),
      queryClient.invalidateQueries({ queryKey: ["usage-aggregate"] }),
      queryClient.invalidateQueries({ queryKey: ["today-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["startup-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["logs"] }),
    ]);
  };

  const refreshAccountMutation = useMutation({
    mutationFn: (accountId: string) => accountClient.refreshUsage(accountId),
    onSuccess: () => {
      toast.success(t("账号用量已刷新"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("刷新失败")}: ${formatUsageRefreshErrorMessage(error, t)}`);
    },
    onSettled: async () => {
      await invalidateAll();
    },
  });

  const refreshAllMutation = useMutation({
    mutationFn: () => accountClient.refreshUsage(),
    onSuccess: () => {
      toast.success(t("账号用量已刷新"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("刷新失败")}: ${formatUsageRefreshErrorMessage(error, t)}`);
    },
    onSettled: async () => {
      await invalidateAll();
    },
  });

  const refreshAccountRtMutation = useMutation({
    mutationFn: (accountId: string) =>
      accountClient.refreshChatgptAuthTokens(accountId),
    onSuccess: () => {
      toast.success(t("账号 AT/RT 已刷新"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("刷新 AT/RT 失败")}: ${getAppErrorMessage(error)}`);
    },
    onSettled: async () => {
      await invalidateAll();
    },
  });

  const refreshAllAccountRtMutation = useMutation({
    mutationFn: () => accountClient.refreshAllChatgptAuthTokens(),
    onSuccess: (result: RefreshAllRtResult) => {
      const notice = buildRefreshAllRtNotice(result, t);
      if (notice.type === "warning") {
        toast.warning(notice.message);
        return;
      }
      toast.success(notice.message);
    },
    onError: (error: unknown) => {
      toast.error(`${t("批量刷新 AT/RT 失败")}: ${getAppErrorMessage(error)}`);
    },
    onSettled: async () => {
      await invalidateAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (accountId: string) => accountClient.delete(accountId),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("账号已删除"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("删除失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const deleteManyMutation = useMutation({
    mutationFn: (accountIds: string[]) => accountClient.deleteMany(accountIds),
    onSuccess: async (_result, accountIds) => {
      await invalidateAll();
      toast.success(t("已删除 {count} 个账号", { count: accountIds.length }));
    },
    onError: (error: unknown) => {
      toast.error(`${t("批量删除失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const deleteByStatusesMutation = useMutation({
    mutationFn: (statuses: string[]) => accountClient.deleteByStatuses({ statuses }),
    onSuccess: async (result: DeleteAccountsByStatusesResult) => {
      await invalidateAll();
      const deleted = Number(result?.deleted || 0);
      if (deleted > 0) {
        toast.success(t("已清理 {count} 个账号", { count: deleted }));
      } else {
        toast.success(t("未发现可清理的账号"));
      }
    },
    onError: (error: unknown) => {
      toast.error(`${t("清理失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const updateAccountProfileMutation = useMutation({
    mutationFn: ({
      accountId,
      label,
      note,
      tags,
    }: {
      accountId: string;
      label?: string | null;
      note?: string | null;
      tags?: string[] | string | null;
    }) =>
      accountClient.updateProfile(accountId, {
        label,
        note,
        tags,
      }),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("账号信息已更新"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("更新账号信息失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const importByDirectoryMutation = useMutation({
    mutationFn: () => accountClient.importByDirectory(),
    onSuccess: async (result: ImportByDirectoryResult) => {
      if (result?.canceled) {
        toast.info(t("已取消导入"));
        return;
      }
      await invalidateAll();
      toast.success(buildImportSummaryMessage(result, t));
    },
    onError: (error: unknown) => {
      toast.error(`${t("导入失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const importByFileMutation = useMutation({
    mutationFn: () => accountClient.importByFile(),
    onSuccess: async (result: ImportByFileResult) => {
      if (result?.canceled) {
        toast.info(t("已取消导入"));
        return;
      }
      await invalidateAll();
      toast.success(buildImportSummaryMessage(result, t));
    },
    onError: (error: unknown) => {
      toast.error(`${t("导入失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const exportMutation = useMutation({
    mutationFn: (params?: AccountExportPayload) => accountClient.export(params),
    onSuccess: (result: ExportResult) => {
      if (result?.canceled) {
        toast.info(t("已取消导出"));
        return;
      }
      const exported = Number(result?.exported || 0);
      const outputDir = String(result?.outputDir || "").trim();
      const isBrowserDownload = outputDir === "browser-download";
      toast.success(
        isBrowserDownload
          ? t("已导出 {count} 个账号，浏览器将开始下载", { count: exported })
          : outputDir
          ? t("已导出 {count} 个账号到 {outputDir}", {
              count: exported,
              outputDir,
            })
          : t("已导出 {count} 个账号", { count: exported })
      );
    },
    onError: (error: unknown) => {
      toast.error(`${t("导出失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const warmupMutation = useMutation({
    mutationFn: (params?: WarmupPayload) => accountClient.warmup(params),
    onSuccess: async (result: WarmupResult) => {
      await invalidateAll();
      const requested = Number(result?.requested || 0);
      const succeeded = Number(result?.succeeded || 0);
      const failed = Number(result?.failed || 0);
      if (requested <= 0) {
        toast.info(t("当前没有可预热的账号"));
        return;
      }
      if (failed <= 0) {
        toast.success(t("预热完成：共{requested}个账号，成功{count}个", {
          requested,
          count: succeeded,
        }));
        return;
      }
      const summary = t("预热完成：成功{success}个，失败{failed}个", {
        success: succeeded,
        failed,
      });
      toast.warning(`${summary}；${t("已打开失败账号列表")}`);
    },
    onError: (error: unknown) => {
      toast.error(`${t("账号预热失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const setPreferredMutation = useMutation({
    mutationFn: (accountId: string) => accountClient.setPreferred(accountId),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("已启用此账号"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("启用账号失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const clearPreferredMutation = useMutation({
    mutationFn: (accountId: string) => accountClient.clearPreferred(accountId),
    onSuccess: async () => {
      await invalidateAll();
      toast.success(t("已关闭当前启用账号"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("关闭启用账号失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  return {
    accounts,
    planTypes,
    total: accountsQuery.data?.total || accounts.length,
    isLoading:
      isServiceReady &&
      !hasStartupAccountSnapshot &&
      (!areAccountQueriesEnabled || accountsQuery.isLoading || usagesQuery.isLoading),
    isServiceReady,
    refreshAccount: (accountId: string) => {
      if (!ensureServiceReady("刷新账号")) return;
      const targetAccountId = accountId.trim();
      if (!targetAccountId) {
        toast.error(t("未找到当前账号，请刷新后重试"));
        return;
      }
      refreshAccountMutation.mutate(targetAccountId);
    },
    refreshAccountRt: (accountId: string) => {
      if (!ensureServiceReady("刷新 AT/RT")) return;
      const targetAccountId = accountId.trim();
      if (!targetAccountId) {
        toast.error(t("未找到当前账号，请刷新后重试"));
        return;
      }
      refreshAccountRtMutation.mutate(targetAccountId);
    },
    refreshAllAccountRt: () => {
      if (!ensureServiceReady("刷新 AT/RT")) return;
      if (!accounts.length) {
        toast.info(t("当前没有可刷新的账号"));
        return;
      }
      return refreshAllAccountRtMutation.mutateAsync();
    },
    refreshAllAccounts: () => {
      if (!ensureServiceReady("刷新账号")) return;
      if (!accounts.length) {
        toast.info(t("当前没有可刷新的账号"));
        return;
      }
      refreshAllMutation.mutate();
    },
    refreshAccountList: async () => {
      if (!ensureServiceReady("刷新账号列表")) return;
      await invalidateAll();
      toast.success(t("账号列表已刷新"));
    },
    deleteAccount: (accountId: string) => {
      if (!ensureServiceReady("删除账号")) return;
      deleteMutation.mutate(accountId);
    },
    deleteManyAccounts: (accountIds: string[]) => {
      if (!ensureServiceReady("批量删除账号")) return;
      return deleteManyMutation.mutateAsync(accountIds);
    },
    cleanupAccountsByStatuses: async (statuses: string[]) => {
      if (!ensureServiceReady("清理账号")) return;
      await deleteByStatusesMutation.mutateAsync(statuses);
    },
    importByFile: () => {
      if (!ensureServiceReady("导入账号")) return;
      importByFileMutation.mutate();
    },
    importByDirectory: () => {
      if (!ensureServiceReady("导入账号")) return;
      importByDirectoryMutation.mutate();
    },
    exportAccounts: async (params?: AccountExportPayload) => {
      if (!ensureServiceReady("导出账号")) return;
      await exportMutation.mutateAsync(params);
    },
    warmupAccounts: async (params?: WarmupPayload) => {
      if (!ensureServiceReady("账号预热")) return;
      return await warmupMutation.mutateAsync(params);
    },
    setPreferredAccount: (accountId: string) => {
      if (!ensureServiceReady("启用账号")) return;
      setPreferredMutation.mutate(accountId);
    },
    clearPreferredAccount: (accountId: string) => {
      if (!ensureServiceReady("关闭启用账号")) return;
      clearPreferredMutation.mutate(accountId);
    },
    updateAccountProfile: async (
      accountId: string,
      params: {
        label?: string | null;
        note?: string | null;
        tags?: string[] | string | null;
      }
    ) => {
      if (!ensureServiceReady("更新账号信息")) return;
      await updateAccountProfileMutation.mutateAsync({ accountId, ...params });
    },
    isRefreshingAccountId:
      refreshAccountMutation.isPending && typeof refreshAccountMutation.variables === "string"
        ? refreshAccountMutation.variables
        : "",
    isRefreshingRtAccountId:
      refreshAccountRtMutation.isPending &&
      typeof refreshAccountRtMutation.variables === "string"
        ? refreshAccountRtMutation.variables
        : "",
    isRefreshingAllRtAccounts: refreshAllAccountRtMutation.isPending,
    isRefreshingAllAccounts: refreshAllMutation.isPending,
    isExporting: exportMutation.isPending,
    isWarmingUpAccounts: warmupMutation.isPending,
    isDeletingMany: deleteManyMutation.isPending,
    isCleaningAccountsByStatus: deleteByStatusesMutation.isPending,
    isUpdatingPreferred:
      setPreferredMutation.isPending || clearPreferredMutation.isPending,
    isUpdatingProfileAccountId:
      updateAccountProfileMutation.isPending &&
      updateAccountProfileMutation.variables &&
      typeof updateAccountProfileMutation.variables === "object" &&
      "accountId" in updateAccountProfileMutation.variables
        ? String(
            (updateAccountProfileMutation.variables as { accountId?: unknown }).accountId || ""
          )
        : "",
  };
}
