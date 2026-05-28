"use client";

export const SUPPORTED_LOCALES = ["zh-CN"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "zh-CN";

export function normalizeLocale(value: unknown): AppLocale {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "zh":
    case "zh-cn":
    case "zh_hans":
    case "zh-hans":
      return "zh-CN";
    default:
      return DEFAULT_LOCALE;
  }
}
