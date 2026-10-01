// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { diagnosticCopy, profileErrorMessage } from "../../lib/connectionDiagnostics";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { testProfileConnection } from "../../lib/ipc";
import type { ServiceProfile, SettingsSnapshot } from "../../lib/types";
import { ServiceProfiles } from "./ServiceProfiles";

const actions = vi.hoisted(() => ({
  createProfile: vi.fn(), updateProfile: vi.fn(), selectProfile: vi.fn(),
  deleteProfile: vi.fn(), saveProfileCredentials: vi.fn(), deleteProfileAPIKey: vi.fn(),
}));
vi.mock("../../lib/store", () => ({ useStore: (select: (state: typeof actions) => unknown) => select(actions) }));
vi.mock("../../lib/ipc", () => ({ testProfileConnection: vi.fn() }));

const profile: ServiceProfile = { id: "synthetic", name: "Alibaba", provider: "alibabaCloud", credentialState: "unavailable" };
const settings: SettingsSnapshot = {
  profiles: [profile], activeProfileId: profile.id, sourceLanguage: "auto", targetLanguage: "zh",
  translationMode: "lowLatency", fontSize: 18, subtitleColor: "white", subtitleAlignment: "center",
  subtitleDisplayMode: "translation", pulseAnimation: null, pulseStyle: "classic", subtitleAnimation: null,
  subtitleBlendsWithBackground: false, isOverlayLocked: false, uiLanguage: "en",
  retainSessionHistory: false, recordSessionAudio: false, windowsAudioSource: "", showInDock: false,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Linux");
  for (const action of Object.values(actions)) action.mockReset();
  vi.mocked(testProfileConnection).mockReset();
  setStoredUiLanguage("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove();
  setStoredUiLanguage("en"); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(snapshot = settings) { await act(() => root.render(<ServiceProfiles settings={snapshot} sessionIsActive={false} />)); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(node => node.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function change(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  await act(() => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => host.querySelector(".credential-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it.each(["credential_service_unavailable", "credential_store_access_denied", "credential_store_unavailable"])("retains unsaved Alibaba edits after %s and subsequent connection checks", async (error) => {
  actions.saveProfileCredentials.mockRejectedValue(error);
  await render();
  await act(() => host.querySelector<HTMLButtonElement>(".service-row__edit")!.click());
  await change('input[type="password"]', "synthetic-asr");
  await change("select", "deepLX");
  await change('input[type="text"][placeholder="https://example.com/translate"]', "https://example.com/translate");
  await change('input[placeholder="Bearer token"]', "synthetic-token");
  await submit();
  expect(actions.selectProfile).not.toHaveBeenCalled();
  expect(host.querySelector('.settings-feedback[data-tone="error"]')?.textContent).toBe(profileErrorMessage(error));

  for (const credential of ["serviceUnavailable", "accessDenied", "missing"] as const) {
    vi.mocked(testProfileConnection).mockResolvedValue({ credential, network: "notTested" });
    await click(diagnosticCopy("linux").test);
    expect(testProfileConnection).toHaveBeenLastCalledWith(profile.id);
    expect(host.querySelector(".connection-check .settings-feedback")?.textContent).toContain(diagnosticCopy("linux")[credential]);
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("synthetic-asr");
    expect(host.querySelector<HTMLInputElement>('input[placeholder="Bearer token"]')!.value).toBe("synthetic-token");
    expect(host.querySelector<HTMLInputElement>('input[placeholder="https://example.com/translate"]')!.value).toBe("https://example.com/translate");
    expect(host.querySelector("select")!.value).toBe("deepLX");
    expect(host.querySelector<HTMLButtonElement>('.credential-form button[type="submit"]')!.disabled).toBe(false);
  }

  // A recoverable status refresh must also keep the existing write-only draft.
  await render({ ...settings, profiles: [{ ...profile, credentialState: "missing" }] });
  await submit();
  expect(actions.saveProfileCredentials).toHaveBeenLastCalledWith(profile.id, {
    kind: "alibabaTranslation", apiKey: "synthetic-asr", textTranslation: "deepLX",
    endpoint: "https://example.com/translate", token: "synthetic-token",
  });
  expect(actions.saveProfileCredentials).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("synthetic-asr");
  expect(host.textContent).not.toContain("synthetic-token");
});

it("shows the same platform-aware storage guidance for other service profiles", async () => {
  await render({ ...settings, profiles: [{ ...profile, provider: "openAIRealtime" }] });
  await act(() => host.querySelector<HTMLButtonElement>(".service-row__edit")!.click());
  expect(host.querySelector('.credential-unavailable[role="status"]')?.textContent).toBe(diagnosticCopy("linux").storage);
  expect(host.textContent).toContain(I18N.settings.credentialUnavailable);
});
