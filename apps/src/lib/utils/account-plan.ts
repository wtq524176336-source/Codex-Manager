export const PLUS_TEAM_PLAN_FILTER = "plus/team";

export function normalizePlanText(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

export function isPlusTeamPlan(value?: string | null): boolean {
  const normalized = normalizePlanText(value);
  return normalized === "plus" || normalized === "team" || normalized === PLUS_TEAM_PLAN_FILTER;
}

export function normalizePlanFilterValue(value?: string | null): string {
  const normalized = normalizePlanText(value);
  if (!normalized) return "unknown";
  return isPlusTeamPlan(normalized) ? PLUS_TEAM_PLAN_FILTER : normalized;
}

export function accountPlanMatchesFilter(
  planType: string | null | undefined,
  filter: string | null | undefined,
): boolean {
  const normalizedFilter = normalizePlanText(filter);
  if (!normalizedFilter || normalizedFilter === "all") return true;

  if (normalizedFilter === PLUS_TEAM_PLAN_FILTER) {
    return isPlusTeamPlan(planType);
  }

  return (normalizePlanText(planType) || "unknown") === normalizedFilter;
}
