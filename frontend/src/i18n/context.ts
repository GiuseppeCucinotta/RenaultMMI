import { createContext, useContext } from "react";
import { en, type Messages } from "./locales/en";
import { it } from "./locales/it";

export type Locale = "en" | "it";

const MESSAGES: Record<Locale, Messages> = { en, it };

type FlattenKeys<T, P extends string = ""> = {
  [K in keyof T]: T[K] extends object
    ? FlattenKeys<T[K], `${P}${K & string}.`>
    : `${P}${K & string}`;
}[keyof T];

export type TranslationKey = FlattenKeys<Messages>;

function resolve(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

export function getMessage(locale: Locale, key: string): string | undefined {
  const value = resolve(MESSAGES[locale], key);
  return typeof value === "string" ? value : undefined;
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within a <I18nProvider>");
  }
  return context;
}
