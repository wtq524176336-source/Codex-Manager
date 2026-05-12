"use client";

import {
  BrainCircuit,
  Database,
  DollarSign,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { formatCompactNumber } from "@/lib/utils/usage";

interface TokenSummaryStats {
  todayTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  todayCost: number;
}

interface AccountTokenSummaryCardsProps {
  stats: TokenSummaryStats;
  isLoading: boolean;
}

interface TokenSummaryCard {
  title: string;
  value: string;
  icon: LucideIcon;
  color: string;
  sub: string;
}

function formatCompactTokenAmount(value: number | null | undefined): string {
  const normalized =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized < 1000) {
    return normalized.toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return formatCompactNumber(normalized, "0.00", 2, true);
}

export function AccountTokenSummaryCards({
  stats,
  isLoading,
}: AccountTokenSummaryCardsProps) {
  const { t } = useI18n();
  const cards: TokenSummaryCard[] = [
    {
      title: t("今日Token"),
      value: formatCompactTokenAmount(stats.todayTokens),
      icon: Zap,
      color: "text-yellow-500",
      sub: t("输入 + 输出合计"),
    },
    {
      title: t("缓存Token"),
      value: formatCompactTokenAmount(stats.cachedTokens),
      icon: Database,
      color: "text-indigo-500",
      sub: t("上下文缓存命中"),
    },
    {
      title: t("推理Token"),
      value: formatCompactTokenAmount(stats.reasoningTokens),
      icon: BrainCircuit,
      color: "text-purple-500",
      sub: t("大模型思考过程"),
    },
    {
      title: t("预计费用"),
      value: `$${Number(stats.todayCost || 0).toFixed(2)}`,
      icon: DollarSign,
      color: "text-emerald-500",
      sub: t("按官价估算"),
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) =>
        isLoading ? (
          <Skeleton key={card.title} className="h-32 w-full rounded-2xl" />
        ) : (
          <Card
            key={card.title}
            className="glass-card overflow-hidden border-none shadow-md backdrop-blur-md transition-all hover:scale-[1.02]"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className={cn("h-4 w-4", card.color)} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {card.sub}
              </p>
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}
