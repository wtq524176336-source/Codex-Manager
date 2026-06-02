export const appearancePresetOptions = [
  {
    label: "默认",
    value: "classic",
  },
  {
    label: "渐变版本",
    value: "modern",
  },
] as const;

export const themeOptions = [
  { label: "企业蓝", value: "tech", color: "#2563eb" },
  { label: "极夜黑", value: "dark", color: "#09090b" },
  { label: "深邃黑", value: "dark-one", color: "#282c34" },
  { label: "事务金", value: "business", color: "#c28100" },
  { label: "薄荷绿", value: "mint", color: "#059669" },
  { label: "晚霞橙", value: "sunset", color: "#ea580c" },
  { label: "葡萄灰紫", value: "grape", color: "#7c3aed" },
  { label: "海湾青", value: "ocean", color: "#0284c7" },
  { label: "松林绿", value: "forest", color: "#166534" },
  { label: "玫瑰粉", value: "rose", color: "#db2777" },
  { label: "石板灰", value: "slate", color: "#475569" },
  { label: "极光青", value: "aurora", color: "#0d9488" },
] as const;

type ThemeValue = (typeof themeOptions)[number]["value"];
type AppearancePresetValue = (typeof appearancePresetOptions)[number]["value"];

const themeAliases: Record<string, ThemeValue> = {
  default: "tech",
  "enterprise-blue": "tech",
  "pure-black": "dark",
};

export function normalizeThemeValue(value: unknown): ThemeValue {
  const normalized = String(value || "").trim();
  if (normalized in themeAliases) {
    return themeAliases[normalized];
  }
  if (themeOptions.some((item) => item.value === normalized)) {
    return normalized as ThemeValue;
  }
  return "tech";
}

export function normalizeAppearancePresetValue(value: unknown): AppearancePresetValue {
  const normalized = String(value || "").trim();
  if (normalized === "modern" || normalized === "glass") {
    return "modern";
  }
  return "classic";
}

export function applyAppearanceSettings(settings: {
  theme?: unknown;
  appearancePreset?: unknown;
  lowTransparency?: unknown;
}) {
  const theme = normalizeThemeValue(settings.theme);
  const appearancePreset = normalizeAppearancePresetValue(settings.appearancePreset);
  const lowTransparency = settings.lowTransparency === true;

  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-appearance", appearancePreset);
  document.body.classList.toggle("low-transparency", lowTransparency);
}
