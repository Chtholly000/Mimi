import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "../../lib/i18n";
import type { SubtitleSnapshot } from "../../lib/types";
import { isWaitingForFinalTranslation, sourceLanguageButtonTitle, visibleLiveSubtitles } from "./overlayModel";

afterEach(() => setStoredUiLanguage("en"));

const subtitles: SubtitleSnapshot = {
  source: { text: "Synthetic current source.", isFinal: false, utteranceId: "current" },
  translation: { text: "Synthetic older translation.", isFinal: false, utteranceId: "old" },
  previewPair: { source: "Synthetic paired source.", translation: "Synthetic paired translation." },
  history: [],
};

it.each(["original", "translation", "bilingual"] as const)("keeps a single recognition lane for an exact expanded same-language pair in %s", (mode) => {
  const settings = { sourceLanguage: "fr", targetLanguage: "fr", subtitleDisplayMode: mode } as const;
  expect(isWaitingForFinalTranslation(settings, null, true)).toBe(false);
  expect(visibleLiveSubtitles(subtitles, settings, null, true, false, true))
    .toEqual([{ text: subtitles.source.text, isFinal: false, kind: mode === "translation" ? "translation" : "source", utteranceId: "current" }]);
});

it("keeps Simplified-to-Traditional Chinese as MT instead of treating Chinese scripts as identical", () => {
  const settings = { sourceLanguage: "zh", targetLanguage: "zh_tw", subtitleDisplayMode: "bilingual" } as const;
  expect(isWaitingForFinalTranslation(settings, "zh", true)).toBe(true);
  expect(visibleLiveSubtitles(subtitles, settings, "zh", true, false, true))
    .toEqual([
      { kind: "source", text: subtitles.previewPair!.source, isFinal: false, isStable: true },
      { kind: "translation", text: subtitles.previewPair!.translation, isFinal: false, isStable: true },
    ]);
  expect(isWaitingForFinalTranslation({ ...settings, sourceLanguage: "auto" }, null, true)).toBe(true);
});

it.each([["zh", "法语"], ["en", "French"], ["ja", "フランス語"]] as const)("localizes the selected extended shortcut in %s", (locale, label) => {
  setStoredUiLanguage(locale);
  expect(sourceLanguageButtonTitle("fr", true)).toBe(label);
});
