import { I18N } from "./i18n";
import { activeServiceProfile, isCustomSpeechProvider, sourceLanguagesForSettings } from "./providerCapabilities";
import { SOURCE_LANGUAGE_DISPLAY_NAMES, type SettingsSnapshot, type SourceLanguage } from "./types";

type LanguageSettings = Pick<SettingsSnapshot, "profiles" | "activeProfileId" | "targetLanguage" | "languageCapabilities">;

/** Describe the actual request semantics, never infer a custom model's capabilities. */
export function speechLanguageGuidance(settings: LanguageSettings) {
  const provider = activeServiceProfile(settings)?.provider ?? "alibabaCloud";
  const custom = isCustomSpeechProvider(provider);
  const sources = sourceLanguagesForSettings(settings);
  const meaning = custom ? I18N.settings.recognitionCustomHelp
    : provider === "alibabaCloud" || provider === "deepLX" || provider === "xAIRealtime"
      ? I18N.settings.recognitionHintHelp
      : sources.length === 1 && sources[0] === "auto"
        ? I18N.settings.recognitionAutomaticHelp : I18N.settings.recognitionExplicitHelp;
  const parameter = provider === "customDashScopeASR" ? I18N.settings.recognitionDashScopeParameter
    : provider === "customOpenAIASR" ? I18N.settings.recognitionOpenAIParameter : "";
  const choices = sources.filter(source => source !== "auto").map(source => SOURCE_LANGUAGE_DISPLAY_NAMES[source]);
  return {
    help: [meaning, parameter, !custom && choices.length > 0 ? I18N.settings.recognitionAvailableHelp(choices.join(" / ")) : ""].filter(Boolean).join("\n"),
    notice: custom ? I18N.settings.recognitionCustomNotice : null,
    optionLabel: (source: SourceLanguage) => custom && source === "auto" ? I18N.settings.recognitionServiceDefault : SOURCE_LANGUAGE_DISPLAY_NAMES[source],
  };
}
