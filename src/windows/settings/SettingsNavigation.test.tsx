// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import type { SettingsDraft } from "../../lib/types";
import { SOURCE_LANGUAGE_DISPLAY_NAMES, TARGET_LANGUAGE_DISPLAY_NAMES } from "../../lib/types";
import { capabilitiesForProvider, targetLanguagesForSettings } from "../../lib/providerCapabilities";
import { profileRevealCredential } from "../../lib/ipc";
import { SettingsView } from "./SettingsView";

vi.mock("../../lib/ipc", async (original) => ({ ...await original<typeof import("../../lib/ipc")>(), profileRevealCredential: vi.fn() }));

const initial = useStore.getState();
let host: HTMLDivElement;
let root: Root;
let saveProfileCredentials: ReturnType<typeof vi.fn>;
let saveSettings: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  setStoredUiLanguage("en");
  window.history.replaceState(null, "", "#subtitle-settings");
  saveProfileCredentials = vi.fn().mockResolvedValue(undefined);
  saveSettings = vi.fn().mockResolvedValue(undefined);
  vi.mocked(profileRevealCredential).mockReset();
  useStore.setState({ ...initial, saveProfileCredentials, saveSettings,
    settings: { ...initial.settings, profiles: initial.settings.profiles.map((profile) => ({ ...profile, credentialState: "present" })) },
    session: { ...initial.session, status: { kind: "idle" }, isActive: false, isPaused: false },
  }, true);
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState(initial, true);
  setStoredUiLanguage("system");
  window.history.replaceState(null, "", window.location.pathname);
  vi.unstubAllGlobals();
});

async function mount() { await act(async () => root.render(<SettingsView />)); }
async function select(category: string) {
  const button = host.querySelector<HTMLButtonElement>(`#settings-category-${category}`)!;
  await act(async () => { button.focus(); button.click(); });
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-current")).toBe("page");
  const panel = host.querySelector(`#${button.getAttribute("aria-controls")}`)!;
  expect(panel.classList.contains("is-inactive")).toBe(false);
}

it.each(["zh", "en", "ja"] as const)("offers five categories in the expected order and keeps subtitle operations in the relevant pages in %s", async (language) => {
  setStoredUiLanguage(language);
  await mount();
  expect([...host.querySelectorAll(".settings-category-nav button")].map((button) => button.textContent)).toEqual([
    I18N.settings.subtitleTitle, I18N.settings.serviceProfilesTitle, I18N.settings.sessionExportTitle,
    I18N.settings.applicationTitle, I18N.settings.diagnosticsTitle,
  ]);
  expect(host.querySelector("#subtitle-settings .source-language-grid")).toBeNull();
  expect(host.querySelector("#subtitle-settings [aria-label=\"" + I18N.settings.translateTo + "\"]")).toBeNull();
  expect(host.querySelector("#service-profiles-panel .source-language-grid")).not.toBeNull();
  expect(host.querySelector("#translation-languages [role=\"combobox\"]")).toBeNull();
  expect(host.querySelector("#translation-languages .target-language-grid")).not.toBeNull();
  expect(host.querySelector(".settings-sidebar .settings-support-diagnostics")).toBeNull();
  for (const category of ["subtitles", "service", "export", "general", "diagnostics"]) {
    await select(category);
    expect(Boolean(host.querySelector(".settings-session-card"))).toBe(category === "subtitles" || category === "service");
  }
  expect(window.location.hash).toBe("#diagnostics");
  await act(async () => host.querySelector<HTMLButtonElement>(".settings-guide-entry")!.click());
  expect(host.querySelector(".quick-start-guide")).not.toBeNull();
  expect(host.querySelector(".settings-session-card")).toBeNull();
  expect(host.querySelector(".settings-quit-button")).not.toBeNull();
  expect(saveSettings).not.toHaveBeenCalled();
  expect(saveProfileCredentials).not.toHaveBeenCalled();
});

it.each(["alibabaCloud", "openAIRealtime", "volcanoEngine", "tencentCloud", "baiduTranslate"] as const)("offers only the supported %s source/target languages as inline choices", async (provider) => {
  const capability = capabilitiesForProvider(provider);
  const settings = { ...useStore.getState().settings, sourceLanguage: capability.sourceLanguages[0], profiles: useStore.getState().settings.profiles.map((profile) => ({ ...profile, provider })) };
  useStore.setState({ settings });
  await mount(); await select("service");
  const choices = [...host.querySelectorAll("#translation-languages .source-language-grid:not(.target-language-grid) button span")].map((node) => node.textContent);
  expect(choices).toHaveLength(capability.sourceLanguages.length);
  capability.sourceLanguages.forEach((language, index) => expect(choices[index]).toContain(SOURCE_LANGUAGE_DISPLAY_NAMES[language]));
  expect([...host.querySelectorAll("#translation-languages .target-language-grid button span")].map((node) => node.textContent)).toEqual(targetLanguagesForSettings(settings).map((language) => TARGET_LANGUAGE_DISPLAY_NAMES[language]));
  expect(host.querySelector("#translation-languages [role=\"combobox\"]")).toBeNull();
  expect(host.querySelector(".language-profile-caption")?.textContent).toBe(I18N.settings.activeProfileLanguages(settings.profiles[0].name));
  expect(saveSettings).not.toHaveBeenCalled();
});

it("saves inline target choices and disables them while a subtitle session is active", async () => {
  await mount(); await select("service");
  const target = [...host.querySelectorAll<HTMLButtonElement>(".target-language-grid button")].find((button) => button.textContent === TARGET_LANGUAGE_DISPLAY_NAMES.ja)!;
  await act(() => { target.focus(); target.click(); });
  expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ targetLanguage: "ja" });
  expect(document.activeElement).toBe(target);
  await act(() => useStore.setState({ session: { ...initial.session, status: { kind: "listening" }, isActive: true } }));
  expect([...host.querySelectorAll<HTMLButtonElement>(".target-language-grid button")].every((button) => button.disabled)).toBe(true);
});

it("places proxies in General and blocks changing them while subtitles are paused", async () => {
  await mount(); await select("general");
  expect(host.querySelector("#application-settings-panel #network-proxy")).not.toBeNull();
  const selector = host.querySelector<HTMLButtonElement>('#network-proxy [role="combobox"]')!;
  expect(selector.disabled).toBe(false);
  await act(() => selector.click());
  await act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === I18N.settings.networkProxyDirect)!.click());
  await act(async () => host.querySelector("#network-proxy form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ networkProxy: { mode: "direct", url: null } });
  await act(() => useStore.setState({ session: { ...initial.session, status: { kind: "listening" }, isActive: false, isPaused: true } }));
  expect(selector.disabled).toBe(true);
  expect(host.querySelector("#network-proxy")?.textContent).toContain(I18N.settings.networkProxyLocked);
});

it("clears a saved-value reveal when leaving services while preserving the unsaved replacement draft", async () => {
  await mount(); await select("service");
  await act(() => host.querySelector<HTMLButtonElement>(".service-row__edit")!.click());
  const replace = [...host.querySelectorAll<HTMLButtonElement>(".credential-panel button")].find((button) => button.textContent === I18N.settings.replaceCredentials)!;
  await act(() => replace.click());
  const draft = host.querySelector<HTMLInputElement>('.credential-panel input[type="password"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(draft, "synthetic-unsaved-replacement");
    draft.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(profileRevealCredential).not.toHaveBeenCalled();
  vi.mocked(profileRevealCredential).mockResolvedValue("synthetic-saved-preview");
  await act(async () => { host.querySelector<HTMLButtonElement>(".stored-credential-reveal button")!.click(); });
  expect(host.querySelector<HTMLInputElement>(".stored-credential-reveal input")!.value).toBe("synthetic-saved-preview");
  await select("general");
  expect(host.querySelector(".stored-credential-reveal")).toBeNull();
  await select("service");
  expect(host.querySelector(".stored-credential-reveal input")).toBeNull();
  expect(host.querySelector('.credential-panel input[type="password"]')).toBe(draft);
  expect(draft.value).toBe("synthetic-unsaved-replacement");
  expect(JSON.stringify(useStore.getState().settings)).not.toContain("synthetic-saved-preview");
  expect(saveProfileCredentials).not.toHaveBeenCalled();
});

it("restores diagnostics from a deep link and follows hash navigation without losing nav focus", async () => {
  window.history.replaceState(null, "", "#diagnostics");
  await mount();
  expect(host.querySelector(".settings-page-header h1")?.textContent).toBe(I18N.settings.diagnosticsTitle);
  expect(host.querySelector("#settings-category-diagnostics")?.getAttribute("aria-current")).toBe("page");
  expect(host.querySelector(".settings-session-card")).toBeNull();
  await act(async () => {
    window.history.replaceState(null, "", "#service-profiles");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(host.querySelector("#settings-category-service")?.getAttribute("aria-current")).toBe("page");
  expect(host.querySelector(".settings-session-card--compact")).not.toBeNull();
});

it("blocks placeholder session and credential controls while loading settings and offers an explicit retry after timeout", async () => {
  const initialize = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ init: initialize, initializationStatus: "loading", hasSettingsSnapshot: false });
  await mount();
  expect(host.textContent).toContain(I18N.settings.settingsSnapshotLoading);
  expect(host.querySelector(".settings-session-card")).toBeNull();
  expect(host.querySelector(".service-rows")).toBeNull();
  expect(host.textContent).not.toContain(I18N.settings.credentialUnavailable);
  await act(() => useStore.setState({ initializationStatus: "error", initializationError: "timeout" }));
  expect(host.textContent).toContain(I18N.settings.settingsSnapshotTimeout);
  const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === I18N.settings.retryLoadingSettings)!;
  await act(async () => { retry.focus(); retry.click(); });
  expect(initialize).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(retry);
  await act(async () => { useStore.setState({ initializationStatus: "ready", initializationError: null, hasSettingsSnapshot: true }); });
  expect(host.querySelector(".settings-session-card")).not.toBeNull();
  expect(host.textContent).not.toContain(I18N.settings.settingsSnapshotTimeout);
  expect(saveProfileCredentials).not.toHaveBeenCalled();
});

it("preserves a write-only unsaved credential draft while moving between categories", async () => {
  await mount();
  await select("service");
  await act(async () => host.querySelector<HTMLButtonElement>(".service-row__edit")!.click());
  const replace = [...host.querySelectorAll<HTMLButtonElement>(".credential-panel button")].find((button) => button.textContent === I18N.settings.replaceCredentials)!;
  await act(async () => replace.click());
  const input = host.querySelector<HTMLInputElement>('.credential-panel input[type="password"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "synthetic-unsaved-draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const category of ["diagnostics", "general", "export", "subtitles", "service"]) await select(category);
  expect(host.querySelector('.credential-panel input[type="password"]')).toBe(input);
  expect(input.value).toBe("synthetic-unsaved-draft");
  expect(saveProfileCredentials).not.toHaveBeenCalled();
  expect(saveSettings).not.toHaveBeenCalled();
});

it("keeps an explicit subtitle save alive while the user navigates to another category", async () => {
  let complete!: () => void;
  saveSettings.mockImplementationOnce(async (draft: SettingsDraft) => {
    await new Promise<void>((resolve) => { complete = resolve; });
    useStore.setState({ settings: { ...useStore.getState().settings, ...draft } });
  });
  await mount();
  const size = host.querySelector<HTMLInputElement>('input[type="range"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(size, "20");
    size.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ fontSize: 20 });
  await select("diagnostics");
  await act(async () => complete());
  await select("subtitles");
  expect(host.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe("20");
});
