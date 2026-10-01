// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { SettingsView } from "./SettingsView";

let host: HTMLDivElement;
let root: Root;
const initial = useStore.getState();
const start = vi.fn().mockResolvedValue(undefined);
const saveSettings = vi.fn().mockResolvedValue(undefined);
const saveProfileCredentials = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.scrollTo = vi.fn();
  window.history.replaceState(null, "", "#subtitle-settings");
  setStoredUiLanguage("en");
  useStore.setState({ ...initial, start, saveSettings, saveProfileCredentials }, true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(initial, true);
  setStoredUiLanguage("system");
  window.history.replaceState(null, "", window.location.pathname);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function mount() { await act(async () => root.render(<SettingsView />)); }
async function clickGuide() {
  await act(async () => host.querySelector<HTMLButtonElement>(".settings-guide-entry")!.click());
}

it.each(["zh", "en", "ja"] as const)("offers sentence dividers off by default and saves an explicit choice in %s", async (language) => {
  setStoredUiLanguage(language);
  await mount();
  const divider = host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${I18N.settings.subtitleDividers}"]`)!;
  expect(divider.getAttribute("aria-checked")).toBe("false");
  expect(host.textContent).toContain(I18N.settings.subtitleDividersHelp);
  expect(saveSettings).not.toHaveBeenCalled();
  await act(async () => divider.click());
  expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ showSubtitleDividers: true });
  await act(async () => useStore.setState({ settings: { ...initial.settings, showSubtitleDividers: true } }));
  expect(divider.getAttribute("aria-checked")).toBe("true");
  await act(async () => divider.click());
  expect(saveSettings).toHaveBeenLastCalledWith({ showSubtitleDividers: false });
  expect(start).not.toHaveBeenCalled();
  expect(saveProfileCredentials).not.toHaveBeenCalled();
});

it("keeps the guide reachable across categories without starting capture or saving credentials", async () => {
  await mount();
  for (const category of ["subtitles", "service", "general", "export", "diagnostics"]) {
    await act(async () => host.querySelector<HTMLButtonElement>(`#settings-category-${category}`)!.click());
    expect(host.querySelector(".settings-guide-entry")?.textContent).toContain(I18N.settings.quickStartTitle);
    await clickGuide();
    expect(host.querySelector(".settings-page-header h1")?.textContent).toBe(I18N.settings.quickStartTitle);
    expect(host.querySelectorAll(".quick-start-guide > li")).toHaveLength(3);
    expect(window.location.hash).toBe("#getting-started");
    expect(host.querySelector(".settings-session-card")).toBeNull();
  }
  expect(start).not.toHaveBeenCalled();
  expect(saveSettings).not.toHaveBeenCalled();
  expect(saveProfileCredentials).not.toHaveBeenCalled();
});

it("opens the existing service and subtitle pages only after clicking their guide actions", async () => {
  await mount();
  await clickGuide();
  await act(async () => host.querySelector<HTMLButtonElement>(".quick-start-guide li:first-child button")!.click());
  expect(window.location.hash).toBe("#service-profiles");
  expect(host.querySelector("#service-profiles-panel")).not.toBeNull();
  await clickGuide();
  await act(async () => host.querySelector<HTMLButtonElement>(".quick-start-guide li:last-child button")!.click());
  expect(window.location.hash).toBe("#subtitle-settings");
  expect(host.querySelector("#subtitle-settings-panel")).not.toBeNull();
  expect(start).not.toHaveBeenCalled();
  expect(saveSettings).not.toHaveBeenCalled();
  expect(saveProfileCredentials).not.toHaveBeenCalled();
});

it.each(["zh", "en", "ja"] as const)("restores the guide deep link and labels in %s", async (language) => {
  setStoredUiLanguage(language);
  window.history.replaceState(null, "", "#getting-started");
  await mount();
  expect(host.querySelector(".settings-page-header h1")?.textContent).toBe(I18N.settings.quickStartTitle);
  expect(host.querySelector(".settings-guide-entry")?.getAttribute("aria-current")).toBe("page");
  expect([...host.querySelectorAll(".quick-start-guide h2")].map((heading) => heading.textContent)).toEqual([
    I18N.settings.quickStartServiceTitle, I18N.settings.quickStartAudioTitle, I18N.settings.quickStartDisplayTitle,
  ]);
  expect(start).not.toHaveBeenCalled();
  expect(saveSettings).not.toHaveBeenCalled();
});

it("retries a failed session directly from the compact service row and shows pending immediately", async () => {
  let complete!: () => void;
  start.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
  window.history.replaceState(null, "", "#service-profiles");
  useStore.setState({
    settings: { ...initial.settings, profiles: initial.settings.profiles.map((profile) => ({ ...profile, credentialState: "present" })) },
    session: { ...initial.session, status: { kind: "error", message: "Synthetic error" }, isActive: false },
  });
  await mount();
  expect(host.querySelector(".settings-session-card--compact")).not.toBeNull();
  expect(host.querySelectorAll('.settings-session-card [role="switch"]')).toHaveLength(1);
  const retry = host.querySelector<HTMLButtonElement>('.settings-session-control__actions .settings-button')!;
  expect(retry.textContent).toBe(I18N.settings.sessionRetry);
  await act(async () => retry.click());
  expect(start).toHaveBeenCalledOnce();
  expect(retry.textContent).toBe(I18N.settings.sessionConnecting);
  expect(retry.disabled).toBe(true);
  await act(async () => retry.click());
  expect(start).toHaveBeenCalledOnce();
  await act(async () => complete());
  expect(retry.disabled).toBe(true);
  await act(async () => useStore.setState({ session: { ...initial.session, status: { kind: "listening" }, isActive: true } }));
  expect(host.querySelector('.settings-session-control__actions .settings-button')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('.settings-session-card [role="switch"]')!.disabled).toBe(false);
});

it.each(["zh", "en", "ja"] as const)("shows active translation recovery without claiming a normal session in %s", async (language) => {
  setStoredUiLanguage(language);
  window.history.replaceState(null, "", "#service-profiles");
  useStore.setState({
    settings: { ...initial.settings, profiles: initial.settings.profiles.map((profile) => ({ ...profile, credentialState: "present" })) },
    session: { ...initial.session, status: { kind: "listening" }, isActive: true, translationRecovery: { reason: "rateLimited", retryAfterMs: 900 } },
  });
  await mount();
  expect(host.querySelector("#settings-session-status")?.textContent).toBe(I18N.overlay.translationRateLimited);
  await act(async () => useStore.setState({ session: { ...useStore.getState().session, translationRecovery: { reason: "temporarilyUnavailable", retryAfterMs: 600 } } }));
  expect(host.querySelector("#settings-session-status")?.textContent).toBe(I18N.overlay.translationRetrying);
  await act(async () => useStore.setState({ session: { ...useStore.getState().session, isPaused: true } }));
  expect(host.querySelector("#settings-session-status")?.textContent).toBe(I18N.settings.sessionPaused);
  await act(async () => useStore.setState({ session: { ...useStore.getState().session, isPaused: false, translationRecovery: null } }));
  expect(host.querySelector("#settings-session-status")?.textContent).toBe(I18N.settings.sessionListening);
  expect(start).not.toHaveBeenCalled();
});
