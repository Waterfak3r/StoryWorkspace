import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  isLocale,
  localeFromCookie,
  localeToHtmlLang,
} from "./locale";
import { interpolate, zhTranslations } from "./translations";

describe("i18n locale helpers", () => {
  it("accepts only the supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("falls back safely for an absent or invalid cookie", () => {
    expect(localeFromCookie("zh-CN")).toBe("zh-CN");
    expect(localeFromCookie("en")).toBe("en");
    expect(localeFromCookie("fr")).toBe(DEFAULT_LOCALE);
    expect(localeFromCookie(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("emits the selected locale as the document language", () => {
    expect(localeToHtmlLang("en")).toBe("en");
    expect(localeToHtmlLang("zh-CN")).toBe("zh-CN");
  });
});

describe("i18n translations", () => {
  it("interpolates every matching placeholder and preserves missing values", () => {
    expect(interpolate("{count} scenes, {count} saved", { count: 3 })).toBe("3 scenes, 3 saved");
    expect(interpolate("Hello {name}")).toBe("Hello {name}");
  });

  it("contains the core navigation and language controls", () => {
    expect(zhTranslations["Story Workspace"]).toBe("故事工作台");
    expect(zhTranslations["Story bible"]).toBe("故事圣经");
    expect(zhTranslations["Switch to English"]).toBe("切换到英文");
    expect(zhTranslations["Settings"]).toBe("设置");
    expect(zhTranslations["Story outline"]).toBe("故事大纲");
    expect(zhTranslations["Comics pages"]).toBe("漫画页");
    expect(zhTranslations["Reference images"]).toBe("参考图");
    expect(zhTranslations["Save API settings"]).toBe("保存 API 设置");
    expect(zhTranslations["Generate comic page"]).toBe("生成漫画页");
    expect(zhTranslations["Generating comic page"]).toBe("正在生成漫画页");
    expect(zhTranslations["Generated comic page"]).toBe("已生成的漫画页");
    expect(zhTranslations["Lock"]).toBe("锁定");
    expect(zhTranslations["Unlock"]).toBe("解锁");
    expect(zhTranslations["Locking"]).toBe("正在锁定");
    expect(zhTranslations["Unlocking"]).toBe("正在解锁");
  });
});
