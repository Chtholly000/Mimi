// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { prepareAppleSpeechLanguage } from "../../lib/ipc";
import { useStore } from "../../lib/store";
import { SOURCE_LANGUAGE_DISPLAY_NAMES, type AppleSpeechSupport, type ServiceProfile, type SettingsSnapshot, type SourceLanguage } from "../../lib/types";
import { AppleSpeechSettings } from "./AppleSpeechSettings";
import { SettingsToastRegion } from "./SettingsToast";

vi.mock("../../lib/ipc", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/ipc")>(),
  prepareAppleSpeechLanguage: vi.fn(),
}));
vi.mock("./AlibabaCredentialEditor", () => ({
  AlibabaCredentialEditor: ({ disabled }: { disabled: boolean }) => <div data-testid="translation-editor" aria-disabled={disabled} />,
}));

const initial = useStore.getState();
const profile: ServiceProfile = { id: "apple", name: "Apple Speech", provider: "appleSpeech", credentialState: "missing", textTranslation: "followService" };
const ready: AppleSpeechSupport = { available: true, languages: [
  { sourceLanguage: "en", locale: "en-US", installed: true },
  { sourceLanguage: "ja", locale: "ja-JP", installed: true },
  { sourceLanguage: "fr", locale: "fr-FR", installed: true },
] };
let host: HTMLDivElement, root: Root;
let props: ComponentProps<typeof AppleSpeechSettings>;
let save: ReturnType<typeof vi.fn>;

function settings(): SettingsSnapshot {
  return { ...initial.settings, profiles: [profile], activeProfileId: profile.id, sourceLanguage: "en", targetLanguage: "original",
    languageCapabilities: { profileId: profile.id, provider: "appleSpeech", textTranslation: "followService", targetLanguage: "original", sourceLanguages: ["en", "ja", "fr"], targetLanguages: ["original"], appleSpeechSupportRevision: 1 } };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  setStoredUiLanguage("en");
  save = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ ...initial, settings: settings(), saveSettings: save }, true);
  vi.mocked(prepareAppleSpeechLanguage).mockReset().mockResolvedValue(ready);
  props = { profile, settings: settings(), sourceLanguage: "en", support: ready, loading: false, failed: false,
    inputId: "synthetic-apple", disabled: false, busy: false, feedback: null, confirmingDelete: false,
    onRetry: vi.fn().mockResolvedValue(undefined), onPrepared: vi.fn(), onBusyChange: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined), onRequestDelete: vi.fn(), onConfirmDelete: vi.fn().mockResolvedValue(undefined), onCancelDelete: vi.fn() };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState(initial, true); setStoredUiLanguage("system"); vi.unstubAllGlobals();
});
async function render(overrides: Partial<typeof props> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(<><AppleSpeechSettings {...props} /><SettingsToastRegion /></>));
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label);
}
async function choose(source: SourceLanguage) {
  await act(async () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
  const choice = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === SOURCE_LANGUAGE_DISPLAY_NAMES[source])!;
  await act(async () => choice.click());
}

it.each(["en", "zh", "ja"] as const)("shows essential setup steps and the active language without an extra action in %s", async locale => {
  setStoredUiLanguage(locale);
  await render();
  const section = host.querySelector<HTMLElement>("#apple-speech-resources")!;
  expect(section.tabIndex).toBe(-1);
  expect(section.querySelector(":scope > .settings-row__label")?.textContent).toBe(I18N.settings.appleSpeechSetupSteps);
  expect(section.textContent).toContain(I18N.settings.appleSpeechLanguageInUse);
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
  expect(prepareAppleSpeechLanguage).not.toHaveBeenCalled();
});

it("keeps essential steps visible while resource loading fails", async () => {
  await render({ loading: true, support: null });
  expect(host.textContent).toContain(I18N.settings.appleSpeechSetupSteps);
  await render({ loading: false, failed: true });
  expect(host.textContent).toContain(I18N.settings.appleSpeechSetupSteps);
  expect(host.textContent).toContain(I18N.settings.appleSpeechLoadFailed);
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeUndefined();
});

it("saves only after the explicit action and serializes duplicate clicks with resource controls", async () => {
  let resolve!: () => void;
  save.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await render();
  await choose("ja");
  expect(save).not.toHaveBeenCalled();
  const use = button(I18N.settings.appleSpeechUseLanguage)!;
  await act(async () => { use.click(); use.click(); });
  expect(save).toHaveBeenCalledExactlyOnceWith({ sourceLanguage: "ja" });
  expect(use.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true);
  expect(host.querySelector('[data-testid="translation-editor"]')?.getAttribute("aria-disabled")).toBe("true");
  expect(props.onBusyChange).toHaveBeenCalledExactlyOnceWith(true);
  await act(async () => resolve());
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  expect(host.textContent).toContain(I18N.settings.appleSpeechLanguageSelected);
  expect(prepareAppleSpeechLanguage).not.toHaveBeenCalled();
  await render({ settings: { ...props.settings, sourceLanguage: "ja" }, sourceLanguage: "ja" });
  expect(host.textContent).toContain(I18N.settings.appleSpeechLanguageInUse);
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeUndefined();
});

it("preparation alone never changes recognition and requires a ready snapshot before use", async () => {
  const unprepared = { ...ready, languages: ready.languages.map(language => ({ ...language, installed: language.sourceLanguage !== "ja" })) };
  await render({ support: unprepared, settings: { ...props.settings, languageCapabilities: { ...props.settings.languageCapabilities!, sourceLanguages: ["en", "fr"] } } });
  await choose("ja");
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeUndefined();
  await act(async () => button(I18N.settings.appleSpeechPrepare)!.click());
  expect(prepareAppleSpeechLanguage).toHaveBeenCalledExactlyOnceWith("ja");
  expect(props.onPrepared).toHaveBeenCalledWith(ready);
  expect(save).not.toHaveBeenCalled();
  await render({ support: ready, settings: settings() });
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeDefined();
  expect(save).not.toHaveBeenCalled();
});

it("requires selecting the edited Apple profile before changing the active language", async () => {
  const other: ServiceProfile = { id: "other", name: "Other", provider: "googleGeminiLive", credentialState: "present" };
  await render({ settings: { ...props.settings, profiles: [profile, other], activeProfileId: other.id, languageCapabilities: undefined } });
  await choose("ja");
  expect(host.textContent).toContain(I18N.settings.appleSpeechSelectProfileFirst);
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
});

it("keeps route-incompatible prepared resources available without offering a failed source switch", async () => {
  const deepL = { ...profile, textTranslation: "deepL" as const };
  const translated: SettingsSnapshot = { ...props.settings, profiles: [deepL], targetLanguage: "en",
    languageCapabilities: { ...props.settings.languageCapabilities!, textTranslation: "deepL", targetLanguage: "en", sourceLanguages: ["en"], targetLanguages: ["original", "en"] } };
  await render({ profile: deepL, settings: translated });
  await choose("fr");
  expect(host.textContent).toContain("fr-FR");
  expect(host.textContent).toContain(I18N.settings.appleSpeechLanguageRouteUnsupported);
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
  await render({ settings: { ...translated, targetLanguage: "original", languageCapabilities: { ...translated.languageCapabilities!, targetLanguage: "original", sourceLanguages: ["en", "fr"] } } });
  expect(button(I18N.settings.appleSpeechUseLanguage)).toBeDefined();
});

it("explains the stop requirement and never suggests starting an already active session", async () => {
  await render({ requiresStop: true });
  expect(host.textContent).toContain(I18N.settings.languageChangeRequiresStop);
  expect(host.textContent).not.toContain(I18N.settings.appleSpeechLanguageInUse);
  expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
  expect(prepareAppleSpeechLanguage).not.toHaveBeenCalled();
});

it.each(["disabled", "busy"] as const)("honors the parent %s guard", async state => {
  await render();
  await choose("ja");
  await render({ [state]: true });
  const use = button(I18N.settings.appleSpeechUseLanguage)!;
  expect(use.disabled).toBe(true);
  await act(async () => use.click());
  expect(save).not.toHaveBeenCalled();
});

it.each(["apple_speech_assets_missing", "private-native-error"])("shows only safe retryable feedback for %s", async error => {
  save.mockRejectedValue(new Error(error));
  await render();
  await choose("ja");
  await act(async () => button(I18N.settings.appleSpeechUseLanguage)!.click());
  expect(host.textContent).toContain(error === "apple_speech_assets_missing" ? I18N.settings.appleSpeechAssetsMissing : I18N.settings.languageSaveFailed);
  expect(document.body.textContent).not.toContain(error);
  expect(host.textContent).not.toContain(I18N.settings.appleSpeechLanguageSelected);
  expect(button(I18N.settings.appleSpeechUseLanguage)?.disabled).toBe(false);
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  expect(prepareAppleSpeechLanguage).not.toHaveBeenCalled();
});

it("does not revive successful language feedback after navigating away", async () => {
  let resolve!: () => void;
  save.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  await render();
  await choose("ja");
  await act(async () => button(I18N.settings.appleSpeechUseLanguage)!.click());
  await act(async () => root.render(<SettingsToastRegion />));
  await act(async () => resolve());
  expect(document.body.textContent).not.toContain(I18N.settings.appleSpeechLanguageSelected);
});
