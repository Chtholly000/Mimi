import { effectiveUiLanguage } from "../../lib/i18n";
import type { SettingsSnapshot } from "../../lib/types";

const labels = {
  en: { auto: "Auto", zh: "Chinese", en: "English", ja: "Japanese", ko: "Korean", original: "Original", error: "Error", idle: "Idle", paused: "Paused", translating: "Translating" },
  zh: { auto: "自动", zh: "中文", en: "英语", ja: "日语", ko: "韩语", original: "原文", error: "错误", idle: "待机", paused: "暂停", translating: "翻译中" },
  ja: { auto: "自動", zh: "中国語", en: "英語", ja: "日本語", ko: "韓国語", original: "原文", error: "エラー", idle: "待機", paused: "停止中", translating: "翻訳中" },
};

export function capsuleLabels(settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage">, phase: "error" | "idle" | "paused" | "translating" | null, language = effectiveUiLanguage()) {
  const text = labels[language];
  return { source: text[settings.sourceLanguage], target: text[settings.targetLanguage], phase: phase ? text[phase] : null };
}
