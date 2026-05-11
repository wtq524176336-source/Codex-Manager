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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

function QuotaProgress({
  label,
  remainPercent,
  resetsAt,
  icon: Icon,
  tone,
  caption,
  emptyText = "--",
  emptyResetText = "未知",
}: QuotaProgressProps) {
  const { t } = useI18n();
  const value = remainPercent ?? 0;
  const toneClasses = {
    blue: {
      track: "bg-blue-500/20",
      indicator: "bg-blue-500",
      icon: "text-blue-500",
    },
    green: {
      track: "bg-green-500/20",
      indicator: "bg-green-500",
      icon: "text-green-500",
    },
    amber: {
      track: "bg-amber-500/20",
      indicator: "bg-amber-500",
      icon: "text-amber-500",
    },
  } as const;
  const palette = toneClasses[tone];

  return (
    <div className="flex min-w-[180px] flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Icon className={cn("h-3 w-3", palette.icon)} />
            <span>{label}</span>
          </div>
          {caption ? (
            <div className="truncate text-[9px] text-muted-foreground/80">
              {caption}
            </div>
          ) : null}
        </div>
        <span className="font-medium">
          {remainPercent == null ? emptyText : `${value}%`}
        </span>
      </div>
      <Progress
        value={value}
        trackClassName={palette.track}
        indicatorClassName={palette.indicator}
      />
      <div className="text-[10px] text-muted-foreground">
        {t("重置")}: {formatTsFromSeconds(resetsAt, emptyResetText)}
      </div>
    </div>
  );
}

export function QuotaOverviewCell({
  account,
  items,
}: {
  account: Account;
  items: QuotaSummaryItem[];
}) {
  const { t } = useI18n();
  const summaryItems = items.slice(0, 2);
  const currentWindowCostText = formatAccountWindowCostUsd(
    account.currentWindowCostUsd,
  );
  const currentWindowCostLabel = formatAccountWindowCostLabel(account, t);

  return (
    <Tooltip>
      <TooltipTrigger render={<div />} className="block cursor-help">
        <div className="rounded-xl border border-primary/5 bg-accent/10 px-3 py-2">
          <div className="grid grid-cols-[140px_minmax(220px,1fr)] items-center gap-4">
            <div className="min-w-0 text-xs text-muted-foreground">
              <div className="truncate font-medium text-foreground/80">
                {currentWindowCostLabel}
              </div>
              <div className="mt-0.5 font-semibold tabular-nums text-foreground">
                {currentWindowCostText}
              </div>
            </div>
            <div className="space-y-1.5">
              {summaryItems.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[42px_minmax(120px,1fr)_44px_112px] items-center gap-2 text-xs"
                >
                  <span className="truncate text-muted-foreground">
                    {item.label}
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
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        sideOffset={10}
        className="max-w-[340px] rounded-2xl bg-background p-3 text-foreground shadow-2xl"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              {t("额度详情（悬停查看所有额度）")}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t("标准额度与专属额度统一在这里查看。")}
            </p>
          </div>
          <div className="space-y-2">
            {items.map((item) => (
              <QuotaProgress
                key={item.id}
                label={item.label}
                remainPercent={item.remainPercent}
                resetsAt={item.resetsAt}
                icon={item.icon}
                tone={item.tone}
                caption={item.caption}
                emptyText={item.emptyText}
                emptyResetText={item.emptyResetText}
              />
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
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

function formatAccountWindowCostLabel(account: Account, t: TranslateFn): string {
  const startedAt =
    typeof account.currentWindowStartedAt === "number"
      ? account.currentWindowStartedAt
      : null;
  const resetsAt =
    typeof account.currentWindowResetsAt === "number"
      ? account.currentWindowResetsAt
      : null;
  if (startedAt != null && resetsAt != null) {
    const windowSeconds = Math.max(0, resetsAt - startedAt);
    if (windowSeconds >= 6 * 24 * 60 * 60) {
      return t("1周 API 费用");
    }
  }
  if (isSecondaryWindowOnlyUsage(account.usage)) {
    return t("1周 API 费用");
  }
  return t("5小时 API 费用");
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
  return [
    {
      id: `${account.id}-primary`,
      label: t("5小时"),
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
      label: t("7天"),
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
  const subscriptionStatusLabel = formatAccountSubscriptionStatusLabel(account, t);
  const subscriptionPlanLabel = formatAccountSubscriptionPlanLabel(account, t);
  const subscriptionExpiryText =
    account.subscriptionExpiresAt != null
      ? formatTsFromSeconds(account.subscriptionExpiresAt, t("未知"))
      : account.hasSubscription === false
        ? t("未订阅")
        : t("未知");
  const tagsText = formatAccountTags(account.tags);
  const noteText = String(account.note || "").trim();
  const currentWindowCostText = formatAccountWindowCostUsd(
    account.currentWindowCostUsd,
  );
  const currentWindowCostLabel = formatAccountWindowCostLabel(account, t);

  return (
    <Tooltip>
      <TooltipTrigger render={<div />} className="block cursor-help text-left">
        <div className="flex flex-col overflow-hidden">
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
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="flex min-w-[260px] flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("账号类型")}
              </div>
              <div className="font-medium">{accountPlanLabel || t("未知")}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("当前状态")}
              </div>
              <div className="font-medium">
                {t(account.availabilityText || "未知")}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("订阅状态")}
              </div>
              <div className="font-medium">{subscriptionStatusLabel}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("订阅方案")}
              </div>
              <div className="font-medium">{subscriptionPlanLabel}</div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("到期时间")}
              </div>
              <div className="font-medium">
                {formatTsFromSeconds(account.subscriptionExpiresAt, t("未知"))}
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("续费时间")}
              </div>
              <div className="font-medium">
                {formatTsFromSeconds(account.subscriptionRenewsAt, t("未知"))}
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {currentWindowCostLabel}
              </div>
              <div className="font-medium">{currentWindowCostText}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-background/70">
                {t("费用窗口")}
              </div>
              <div className="font-medium">
                {formatTsFromSeconds(account.currentWindowStartedAt, t("未知"))}
                {" - "}
                {formatTsFromSeconds(account.currentWindowResetsAt, t("未知"))}
              </div>
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] text-background/70">{t("标签")}</div>
            <div className="break-words">{tagsText || t("未设置")}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] text-background/70">{t("备注")}</div>
            <div className="whitespace-pre-wrap break-words">
              {noteText || t("未设置")}
            </div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] text-background/70">{t("账号 ID")}</div>
            <div className="break-all font-mono text-[11px]">{account.id}</div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
