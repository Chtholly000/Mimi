import {
  effectiveTranslationModeForSettings,
  sourceLanguagesForSettings,
  targetLanguagesForSettings,
  translationModesForSettings,
} from "../../lib/providerCapabilities";
import {
  targetLanguageTranslatesAudio,
  type SettingsSnapshot,
  type SourceLanguage,
  type TranslationMode,
} from "../../lib/types";

export interface OverlayControlPanelModel {
  sourceOptions: readonly SourceLanguage[];
  translationModeOptions: readonly TranslationMode[];
  effectiveTranslationMode: TranslationMode;
  immersiveModeEnabled: boolean;
  overlayLocked: boolean;
  canSkipTranslation: boolean;
}

/**
 * Provider-aware panel structure. An already-selected single option is summarized
 * in the island header; a different single option remains available for recovery. A
 * no-translation target never exposes an irrelevant translation-mode group.
 */
export function overlayControlPanelModel(
  settings: SettingsSnapshot,
): OverlayControlPanelModel {
  const sourceLanguages = sourceLanguagesForSettings(settings);
  const translationModes = translationModesForSettings(settings);
  return {
    sourceOptions: sourceLanguages.length === 1 && sourceLanguages[0] === settings.sourceLanguage ? [] : sourceLanguages,
    translationModeOptions:
      targetLanguageTranslatesAudio(settings.targetLanguage) &&
      translationModes.length > 1
        ? translationModes
        : [],
    effectiveTranslationMode: effectiveTranslationModeForSettings(settings),
    immersiveModeEnabled: settings.subtitleBlendsWithBackground,
    overlayLocked: settings.isOverlayLocked,
    canSkipTranslation: targetLanguagesForSettings(settings).includes("original"),
  };
}
