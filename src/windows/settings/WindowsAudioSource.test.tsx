// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { setStoredUiLanguage } from "../../lib/i18n";
import { audioSourceCopy } from "../../lib/windowsAudioSource";
import { WindowsAudioSource } from "./WindowsAudioSource";

const fixture = vi.hoisted(() => ({
  settings: { windowsAudioSource: "" },
  session: { isActive: false, isPaused: false },
  saveSettings: vi.fn(),
}));
vi.mock("../../lib/store", () => ({ useStore: (select: (state: typeof fixture) => unknown) => select(fixture) }));
vi.mock("../../lib/ipc", () => ({ isTauri: true, setOverlayPointerCursor: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  fixture.settings.windowsAudioSource = "";
  fixture.session.isActive = false;
  fixture.saveSettings.mockReset();
  vi.mocked(invoke).mockResolvedValue({
    devices: [{ id: "speaker-id", name: "Fixture speakers" }], currentDevice: "speaker-id",
    receivingSound: false, receivingAudioData: false,
  });
  setStoredUiLanguage("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove();
  setStoredUiLanguage("en"); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(<WindowsAudioSource />)); }
function trigger() { return host.querySelector<HTMLButtonElement>('[role="combobox"]')!; }

it("offers follow system and concrete outputs without adding experimental role choices", async () => {
  await render(); await act(() => trigger().click());
  expect([...document.querySelectorAll('[role="option"]')].map(node => node.textContent)).toEqual([audioSourceCopy().system, "Fixture speakers"]);
  await act(() => document.querySelectorAll<HTMLElement>('[role="option"]')[1].click());
  expect(fixture.saveSettings).toHaveBeenCalledExactlyOnceWith({ windowsAudioSource: "speaker-id" });
});

it("keeps persisted legacy choices readable in all three languages without rewriting them", async () => {
  for (const language of ["en", "zh", "ja"] as const) {
    setStoredUiLanguage(language);
    const text = audioSourceCopy();
    for (const [value, label] of [["role:communications", text.communications], ["role:multimedia", text.multimedia], ["follow:audible", text.audible], ["role:console", text.system]]) {
      fixture.settings.windowsAudioSource = value; await render();
      expect(trigger().textContent).toBe(label);
      expect(host.querySelector('[role="status"]')?.textContent).not.toBe(text.missing);
    }
  }
  expect(fixture.saveSettings).not.toHaveBeenCalled();
});

it("keeps a missing manual output visible and locks source changes during capture", async () => {
  fixture.settings.windowsAudioSource = "removed-output"; await render();
  expect(trigger().textContent).toBe(audioSourceCopy().unavailable);
  expect(host.querySelector('[role="status"]')?.textContent).toBe(audioSourceCopy().missing);
  fixture.session.isActive = true; await render();
  expect(trigger().disabled).toBe(true);
  expect(fixture.saveSettings).not.toHaveBeenCalled();
});
