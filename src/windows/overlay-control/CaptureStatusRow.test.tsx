// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { CaptureStatusRow } from "./CaptureStatusRow";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/ipc", () => ({ isTauri: true }));
let host: HTMLDivElement;
let root: Root;
const initial = useStore.getState();
const onSettings = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  setStoredUiLanguage("en");
  useStore.setState({ ...initial, session: { ...initial.session, isActive: true, isPaused: false } }, true);
  mocks.invoke.mockResolvedValue({ kind: "macos_system_mix", strategy: "platform_capture", actualDeviceName: null, observation: { pcmDataRecent: true, soundRecent: true }, systemOutputDeviceName: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); useStore.setState(initial, true);
  setStoredUiLanguage("system"); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});
async function mount(disabled = false) { await act(async () => root.render(<CaptureStatusRow onShowAudioSettings={onSettings} disabled={disabled} />)); }

it("shows a single truthful mix/status line with no invented device name", async () => {
  await mount();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("System sound mix · Receiving sound");
  expect(host.textContent).not.toContain("Actual device unknown");
  expect(host.querySelector("strong")).toBeNull();
});

it.each([
  ["zh", "系统输出"], ["en", "System output"], ["ja", "システム出力"],
] as const)("labels a known output as system output in %s rather than the capture binding", async (language, label) => {
  setStoredUiLanguage(language);
  mocks.invoke.mockResolvedValue({ kind: "macos_system_mix", strategy: "platform_capture", actualDeviceName: null, observation: { pcmDataRecent: true, soundRecent: true }, systemOutputDeviceName: "Synthetic headphones" });
  await mount();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(`${label}${language === "en" ? ": " : "："}Synthetic headphones`);
  expect(host.querySelector('.overlay-control-capture')?.getAttribute("title")).toContain("Synthetic headphones");
});

it("keeps Windows audio selection reachable even if a capture snapshot is unavailable", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
  mocks.invoke.mockRejectedValue(new Error("synthetic-status-failure"));
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(onSettings).toHaveBeenCalledOnce();
  await mount(true);
  expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
});

it("shows the microphone and its captured device without any system-output hint", async () => {
  useStore.setState({ settings: { ...initial.settings, audioInput: "microphone" } });
  mocks.invoke.mockResolvedValue({ kind: "microphone", strategy: "default_input", actualDeviceName: "Synthetic microphone", systemOutputDeviceName: "Stale headphones", observation: { pcmDataRecent: true, soundRecent: true } });
  await mount();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Microphone: Synthetic microphone · Receiving sound");
  expect(host.textContent).not.toContain("headphones");
  expect(host.querySelector('.overlay-control-capture')?.getAttribute("title")).not.toContain("System output");
  expect(host.querySelector<HTMLButtonElement>("button")?.getAttribute("aria-label")).toBe("Audio input");
});

it("discards the old system output as soon as microphone is selected, before the next status poll resolves", async () => {
  mocks.invoke.mockResolvedValueOnce({ kind: "macos_system_mix", strategy: "platform_capture", actualDeviceName: null, systemOutputDeviceName: "Old headphones", observation: { pcmDataRecent: true, soundRecent: true } });
  await mount();
  expect(host.textContent).toContain("Old headphones");
  let finish!: (value: unknown) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(() => useStore.setState({ settings: { ...initial.settings, audioInput: "microphone" } }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Microphone · Audio not observed yet");
  expect(host.textContent).not.toContain("Old headphones");
  await act(async () => finish({ kind: "microphone", strategy: "default_input", actualDeviceName: null, observation: { pcmDataRecent: false, soundRecent: false } }));
  expect(host.textContent).toContain("check the system’s default microphone");
  expect(host.textContent).not.toContain("play sound");
});
