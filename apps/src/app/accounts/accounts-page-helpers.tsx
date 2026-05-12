"use client";

import type { LucideIcon } from "lucide-react";
import { RefreshCw, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  formatRemainingDurationFromSeconds,
  formatTsFromSeconds,
  getExtraUsageDisplayRows,
  getUsageDisplayBuckets,
  isPrimaryWindowOnlyUsage,
  isSecondaryWindowOnlyUsage,
} from "@/lib/utils/usage";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Account } from "@/types";

export type StatusFilter = "all" | "available" | "low_quota" | "limited" | "banned";
export type AccountExportMode = "single" | "multiple";

export type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function formatAccountPlanValueLabel(value: string, t: TranslateFn) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  switch (normalized) {
    case "free":
      return "FREE";
    case "go":
      return "GO";
    case "plus":
      return "PLUS";
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
      return t("未知");
    default:
      return normalized ? normalized.toUpperCase() : t("未知");
  }
}

export function normalizeAccountPlanKey(account: Account) {
  return (
    String(account.planType || "")
      .trim()
      .toLowerCase() || "unknown"
  );
}

export function formatPlanFilterLabel(value: string, t: TranslateFn) {
  const nextValue = String(value || "").trim();
  if (!nextValue || nextValue === "all") {
    return t("全部类型");
  }
  return formatAccountPlanValueLabel(nextValue, t);
}

export function formatStatusFilterLabel(value: string, t: TranslateFn) {
  const nextValue = String(value || "").trim();
  switch (nextValue) {
    case "available":
      return t("正常");
    case "low_quota":
      return t("低配额");
    case "limited":
      return t("限流");
    case "banned":
      return t("封禁");
    case "all":
    default:
      return t("全部");
  }
}

export interface QuotaProgressProps {
  label: string;
  remainPercent: number | null;
  resetsAt: number | null;
  icon: LucideIcon;
  tone: "green" | "blue" | "amber";
  caption?: string;
  emptyText?: string;
  emptyResetText?: string;
}

export interface QuotaSummaryItem extends QuotaProgressProps {
  id: string;
  costText?: string | null;
}

export interface AccountEditorState {
  accountId: string;
  accountName: string;
  currentLabel: string;
  currentTags: string;
  currentNote: string;
}

export type DeleteDialogState =
  | { kind: "single"; account: Account }
  | { kind: "selected"; ids: string[]; count: number }
  | null;

export function QuotaOverviewCell({
  items,
}: {
  items: QuotaSummaryItem[];
}) {
  const { t } = useI18n();
  const summaryItems = items.slice(0, 2);

  return (
    <div className="rounded-xl border border-primary/5 bg-accent/10 px-3 py-2">
      <div className="space-y-1.5">
        {summaryItems.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[120px_minmax(120px,1fr)_44px_112px] items-center gap-2 text-xs"
          >
            <span className="truncate text-muted-foreground">
              {item.label}
              {item.costText ? `（${item.costText}）` : ""}
            </span>
            <Progress
              value={item.remainPercent ?? 0}
              trackClassName={
                item.tone === "blue"
                  ? "bg-blue-500/20"
                  : item.tone === "amber"
                    ? "bg-amber-500/20"
                    : "bg-green-500/20"
              }
              indicatorClassName={
                item.tone === "blue"
                  ? "bg-blue-500"
                  : item.tone === "amber"
                    ? "bg-amber-500"
                    : "bg-green-500"
              }
            />
            <div className="flex min-w-0 items-center justify-end gap-2 text-muted-foreground">
              <span className="w-9 shrink-0 text-right font-medium text-foreground/80">
                {item.remainPercent == null
                  ? (item.emptyText ?? "--")
                  : `${item.remainPercent}%`}
              </span>
            </div>
            <span className="shrink-0 text-right text-muted-foreground">
              {formatRemainingDurationFromSeconds(
                item.resetsAt,
                item.id.endsWith("-primary") ? "hours" : "days",
                item.emptyResetText ?? t("未知"),
              )}
              后刷新
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function formatAccountPlanLabel(
  account: Account,
  t: TranslateFn,
): string | null {
  const normalized = normalizeAccountPlanKey(account);
  return normalized === "unknown"
    ? null
    : formatAccountPlanValueLabel(normalized, t);
}

export function formatAccountSubscriptionPlanLabel(
  account: Account,
  t: TranslateFn,
): string {
  const normalized = String(account.subscriptionPlan || account.planType || "")
    .trim()
    .toLowerCase();
  return normalized
    ? formatAccountPlanValueLabel(normalized, t)
    : t("未知");
}

export function formatAccountSubscriptionStatusLabel(
  account: Account,
  t: TranslateFn,
): string {
  const hasSubscriptionEvidence =
    Boolean(String(account.subscriptionPlan || "").trim()) ||
    account.subscriptionExpiresAt != null ||
    account.subscriptionRenewsAt != null;

  if (account.hasSubscription === true || (account.hasSubscription == null && hasSubscriptionEvidence)) {
    return t("已订阅");
  }
  if (account.hasSubscription === false) {
    return t("未订阅");
  }
  return t("未知");
}

export function getAccountPlanBadgeClassName(planLabel: string | null): string {
  switch (planLabel) {
    case "FREE":
      return "bg-slate-500/10 text-slate-700 dark:text-slate-300";
    case "GO":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "PLUS":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "PRO":
      return "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300";
    case "TEAM":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "BUSINESS":
      return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
    case "ENTERPRISE":
      return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "EDU":
      return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    default:
      return "bg-accent/50";
  }
}

export function formatAccountTags(tags: string[]): string {
  return tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .join("、");
}

function formatAccountWindowCostUsd(value: number): string {
  const normalized =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: normalized > 0 && normalized < 1 ? 4 : 2,
  }).format(normalized);
}

export function normalizeTagsDraft(tagsDraft: string): string[] {
  return tagsDraft
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function formatAccountExportModeLabel(value: string, t: TranslateFn) {
  return value === "single" ? t("单 JSON") : t("多 JSON");
}

export function buildQuotaSummaryItems(
  account: Account,
  t: TranslateFn,
): QuotaSummaryItem[] {
  const primaryWindowOnly = isPrimaryWindowOnlyUsage(account.usage);
  const secondaryWindowOnly = isSecondaryWindowOnlyUsage(account.usage);
  const usageBuckets = getUsageDisplayBuckets(account.usage);
  const extraUsageRows = getExtraUsageDisplayRows(account.usage);
  const primaryCostText =
    account.primaryWindowStartedAt != null && account.primaryWindowResetsAt != null
      ? formatAccountWindowCostUsd(account.primaryWindowCostUsd)
      : null;
  const secondaryCostText =
    account.secondaryWindowStartedAt != null &&
    account.secondaryWindowResetsAt != null
      ? formatAccountWindowCostUsd(account.secondaryWindowCostUsd)
      : null;
  return [
    {
      id: `${account.id}-primary`,
      label: t("5小时"),
      costText: primaryCostText,
      remainPercent: account.primaryRemainPercent,
      resetsAt: usageBuckets.primaryResetsAt,
      icon: RefreshCw,
      tone: "green",
      caption: t("标准模型窗口"),
      emptyText: secondaryWindowOnly ? t("未提供") : "--",
      emptyResetText: secondaryWindowOnly ? t("未提供") : t("未知"),
    },
    {
      id: `${account.id}-secondary`,
      label: t("1周"),
      costText: secondaryCostText,
      remainPercent: account.secondaryRemainPercent,
      resetsAt: usageBuckets.secondaryResetsAt,
      icon: RefreshCw,
      tone: "blue",
      caption: t("长周期窗口"),
      emptyText: primaryWindowOnly ? t("未提供") : "--",
      emptyResetText: primaryWindowOnly ? t("未提供") : t("未知"),
    },
    ...extraUsageRows.map((item) => ({
      id: item.id,
      label: `${t(item.label, item.labelValues)}${item.labelSuffix ? t(item.labelSuffix) : ""}`,
      remainPercent: item.remainPercent,
      resetsAt: item.resetsAt,
      icon: Zap,
      tone: "amber" as const,
      caption: t(item.windowLabel, item.windowLabelValues),
      emptyText: "--",
      emptyResetText: t("未知"),
    })),
  ];
}

export function AccountInfoCell({
  account,
  isPreferred,
}: {
  account: Account;
  isPreferred: boolean;
}) {
  const { t } = useI18n();
  const accountPlanLabel = formatAccountPlanLabel(account, t);
  const subscriptionExpiryText =
    account.subscriptionExpiresAt != null
      ? formatTsFromSeconds(account.subscriptionExpiresAt, t("未知"))
      : account.hasSubscription === false
        ? t("未订阅")
        : t("未知");

  return (
    <div className="flex flex-col overflow-hidden text-left">
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="truncate text-base font-semibold">
          {account.name}
        </span>
        {accountPlanLabel ? (
          <Badge
            variant="secondary"
            className={cn(
              "h-5 shrink-0 px-1.5 text-[10px]",
              getAccountPlanBadgeClassName(accountPlanLabel),
            )}
          >
            {accountPlanLabel}
          </Badge>
        ) : null}
        {isPreferred ? (
          <Badge
            variant="secondary"
            className="h-5 shrink-0 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300"
          >
            {t("启用")}
          </Badge>
        ) : null}
      </div>
      <span className="truncate font-mono text-xs uppercase text-muted-foreground opacity-60">
        {account.id.slice(0, 16)}...
      </span>
      <span className="mt-1 text-xs text-muted-foreground">
        {t("最近刷新")}:{" "}
        {formatTsFromSeconds(account.lastRefreshAt, t("从未刷新"))}
      </span>
      <span className="text-xs text-muted-foreground">
        {t("订阅到期")}: {subscriptionExpiryText}
      </span>
    </div>
  );
}
