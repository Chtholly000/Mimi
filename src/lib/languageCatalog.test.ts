import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "./i18n";
import {
  AUDIO3_RECOGNITION_LANGUAGE_CODES,
  QWEN_MT_LITE_TRANSLATION_LANGUAGE_CODES,
  SOURCE_LANGUAGE_DISPLAY_NAMES,
  SOURCE_LANGUAGE_QUICK_CASES,
  TARGET_LANGUAGE_DISPLAY_NAMES,
  sourceLanguageStatusDisplayName,
  targetLanguageAfterQuickSwitch,
} from "./types";

afterEach(() => setStoredUiLanguage("en"));

it.each(["zh", "en", "ja"] as const)("localizes every selectable wire code in %s", (locale) => {
  setStoredUiLanguage(locale);
  expect(Object.keys(SOURCE_LANGUAGE_DISPLAY_NAMES)).toEqual(["auto", ...AUDIO3_RECOGNITION_LANGUAGE_CODES]);
  expect(Object.keys(TARGET_LANGUAGE_DISPLAY_NAMES)).toEqual(["original", ...QWEN_MT_LITE_TRANSLATION_LANGUAGE_CODES]);
  for (const [code, name] of Object.entries(SOURCE_LANGUAGE_DISPLAY_NAMES)) {
    expect(name.trim()).not.toBe("");
    expect(name).not.toBe(code);
  }
  for (const [code, name] of Object.entries(TARGET_LANGUAGE_DISPLAY_NAMES)) {
    expect(name.trim()).not.toBe("");
    expect(name).not.toBe(code);
  }
});

it("updates expanded language labels in place and preserves stage/script distinctions", () => {
  setStoredUiLanguage("zh");
  expect(SOURCE_LANGUAGE_DISPLAY_NAMES.fr).toBe("法语");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.fa).toBe("波斯语");
  expect(SOURCE_LANGUAGE_DISPLAY_NAMES.zh).toBe("中文");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.zh).toBe("简体中文");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.zh_tw).toBe("繁体中文");
  expect(SOURCE_LANGUAGE_DISPLAY_NAMES.tl).toBe("菲律宾语");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.tl).toBe("塔加洛语");
  setStoredUiLanguage("en");
  expect(SOURCE_LANGUAGE_DISPLAY_NAMES.fr).toBe("French");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.zh_tw).toBe("Traditional Chinese");
  expect(SOURCE_LANGUAGE_DISPLAY_NAMES.tl).toBe("Filipino");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.tl).toBe("Tagalog");
  setStoredUiLanguage("ja");
  expect(SOURCE_LANGUAGE_DISPLAY_NAMES.fr).toBe("フランス語");
  expect(TARGET_LANGUAGE_DISPLAY_NAMES.fa).toBe("ペルシア語");
  expect(sourceLanguageStatusDisplayName("fr", null, "zh")).toBe("フランス語");
});

it("keeps the five compact shortcuts and their legacy Chinese original behavior", () => {
  expect(SOURCE_LANGUAGE_QUICK_CASES).toEqual(["auto", "ja", "en", "ko", "zh"]);
  expect(targetLanguageAfterQuickSwitch("zh", "ja", "en")).toBe("original");
  expect(targetLanguageAfterQuickSwitch("fr", "zh", "original")).toBe("zh");
  expect(targetLanguageAfterQuickSwitch("fr", "en", "zh_tw")).toBe("zh_tw");
});
