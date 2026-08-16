"use client";

import * as React from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeToHtmlLang, type Locale } from "./locale";
import { interpolate, zhTranslations } from "./translations";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const LocaleContext = React.createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof document !== "undefined") {
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(nextLocale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
      document.documentElement.lang = localeToHtmlLang(nextLocale);
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = localeToHtmlLang(locale);
  }, [locale]);

  const value = React.useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => interpolate(locale === "zh-CN" ? (zhTranslations[key] ?? key) : key, values),
    formatDate: (valueToFormat, options) => new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", options ?? { month: "short", day: "numeric", year: "numeric" }).format(new Date(valueToFormat)),
    formatNumber: (number, options) => new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", options).format(number),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = React.useContext(LocaleContext);
  if (!context) {
    throw new Error("useI18n must be used inside LocaleProvider");
  }
  return context;
}

