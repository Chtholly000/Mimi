// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import type { SessionStateEvent } from "../../lib/types";
import { AudioInputSettings } from "./AudioInputSettings";

vi.mock("./WindowsAudioSource", () => ({ WindowsAudioSource: () => <span data-output-selector /> }));
const initial = useStore.getState();
let host: HTMLDivElement, root: Root;
let save: ReturnType<typeof vi.fn>;
const start = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  setStoredUiLanguage("en");
  save = vi.fn(initial.saveSettings); start.mockReset();
  useStore.setState({ ...initial, initializationStatus: "ready", saveSettings: save, start,
    settings: { ...initial.settings, audioInput: "system", recordSessionAudio: true },
    session: { ...initial.session, status: { kind: "idle" }, isActive: false, isPaused: false },
  }, true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove();
  useStore.setState(initial, true); setStoredUiLanguage("system"); vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<AudioInputSettings />)); }
function trigger() { return host.querySelector<HTMLButtonElement>('[role="combobox"]')!; }
async function selectMicrophone() {
  await act(() => trigger().click());
  await act(async () => document.querySelectorAll<HTMLElement>('[role="option"]')[1].click());
}

it.each(["en", "zh", "ja"] as const)("saves the microphone explicitly in %s without starting capture, and clears the prior recording opt-in", async language => {
  setStoredUiLanguage(language); await render();
  expect(trigger().textContent).toBe(I18N.settings.audioInputSystem);
  expect(host.querySelector('[data-output-selector]')).not.toBeNull();
  await selectMicrophone();
  expect(save).toHaveBeenCalledExactlyOnceWith({ audioInput: "microphone" });
  expect(trigger().textContent).toBe(I18N.settings.audioInputMicrophone);
  expect(host.querySelector('[data-output-selector]')).toBeNull();
  expect(useStore.getState().settings.recordSessionAudio).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(host.querySelector('.settings-row__description')).toBeNull();
  expect(host.querySelector('.settings-help-control__description')?.textContent).toContain(I18N.settings.audioInputHelp);
});

it.each([
  { status: { kind: "listening" }, isActive: true, isPaused: false },
  { status: { kind: "listening" }, isActive: false, isPaused: true },
  { status: { kind: "connecting" }, isActive: false, isPaused: false },
  { status: { kind: "stopping" }, isActive: false, isPaused: false },
] satisfies Pick<SessionStateEvent, "status" | "isActive" | "isPaused">[])("locks the source in session state %j", async state => {
  useStore.setState({ session: { ...initial.session, ...state } });
  await render();
  expect(trigger().disabled).toBe(true);
  expect(host.textContent).toContain(I18N.settings.audioInputRequiresStop);
  expect(save).not.toHaveBeenCalled();
});

it("prevents duplicate saves and exposes a safe, normal-sized actionable error", async () => {
  let fail!: (reason: Error) => void;
  save.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await render(); await selectMicrophone();
  expect(trigger().disabled).toBe(true);
  await act(() => trigger().click());
  expect(save).toHaveBeenCalledOnce();
  await act(async () => fail(new Error("synthetic-private-device-details")));
  expect(trigger().disabled).toBe(false);
  expect(trigger().textContent).toBe(I18N.settings.audioInputSystem);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(I18N.settings.audioInputSaveFailed);
  expect(host.textContent).not.toContain("synthetic-private-device-details");
});

it("does not offer input changes until settings have loaded", async () => {
  useStore.setState({ initializationStatus: "loading" }); await render();
  expect(trigger().disabled).toBe(true);
  expect(save).not.toHaveBeenCalled();
});
