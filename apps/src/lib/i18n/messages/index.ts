"use client";

import { DEFAULT_LOCALE, type AppLocale } from "../config";
import { ZH_CN_MESSAGES } from "./zh";
import type { MessageCatalog, TranslationValues } from "./types";

const MESSAGE_CATALOG: Record<AppLocale, MessageCatalog> = {
  "zh-CN": ZH_CN_MESSAGES,
};

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`,
  );
}

export function translate(
  locale: AppLocale,
  message: string,
  values?: TranslationValues,
): string {
  const normalizedMessage = String(message || "");
  const template =
    MESSAGE_CATALOG[locale]?.[normalizedMessage] ??
    MESSAGE_CATALOG[DEFAULT_LOCALE]?.[normalizedMessage] ??
    normalizedMessage;
  return interpolate(template, values);
}
