import { afterEach, expect, it } from "vitest";
import { I18N, setStoredUiLanguage } from "./i18n";
import { speechLanguageGuidance } from "./speechLanguageGuidance";
import type { ServiceProvider } from "./types";
const settings = (provider: ServiceProvider) => ({ profiles: [{ id: "p", name: "P", provider, credentialState: "missing" as const }], activeProfileId: "p", targetLanguage: "original" as const });
afterEach(() => setStoredUiLanguage("system"));
it.each(["zh", "en", "ja"] as const)("separates automatic, hint, explicit and unknown semantics in %s", locale => {
  setStoredUiLanguage(locale);
  expect(speechLanguageGuidance(settings("openAIRealtime")).help).toBe(I18N.settings.recognitionAutomaticHelp);
  expect(speechLanguageGuidance(settings("xAIRealtime")).help).toContain(I18N.settings.recognitionHintHelp);
  const explicit = speechLanguageGuidance(settings("tencentCloud"));
  expect(explicit.help).toContain(I18N.settings.recognitionExplicitHelp);
  expect(explicit.help).not.toContain(I18N.settings.recognitionHintHelp);
  for (const provider of ["customDashScopeASR", "customOpenAIASR"] as const) {
    const unknown = speechLanguageGuidance(settings(provider));
    expect(unknown.notice).toBe(I18N.settings.recognitionCustomNotice);
    expect(unknown.optionLabel("auto")).toBe(I18N.settings.recognitionServiceDefault);
    expect(unknown.help).toContain(I18N.settings.recognitionCustomHelp);
    expect(unknown.help).toContain(provider === "customDashScopeASR" ? "language_hints" : "transcription.languages");
    expect(unknown.help).not.toContain(I18N.settings.recognitionAutomaticHelp);
  }
});

it("labels explicit declarations without claiming discovered or verified support", () => {
  const unknown = settings("customOpenAIASR");
  const declared = { ...unknown, profiles: [{ ...unknown.profiles[0], customSpeechSourceLanguages: ["fr" as const] }] };
  expect(speechLanguageGuidance(declared).notice).toBe(I18N.settings.recognitionDeclaredNotice);
  expect(speechLanguageGuidance(declared).optionLabel("auto")).toBe(I18N.settings.recognitionServiceDefault);
});
