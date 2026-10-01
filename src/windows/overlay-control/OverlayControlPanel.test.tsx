// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { OverlayControlPanel } from "./OverlayControlPanel";
import { overlayControlPanelModel } from "./overlayControlModel";

vi.mock("./CaptureStatusRow", () => ({ CaptureStatusRow: () => <div className="overlay-control-capture">System sound mix · Receiving sound</div> }));

let host: HTMLDivElement;
let root: Root;
let props: Parameters<typeof OverlayControlPanel>[0];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  setStoredUiLanguage("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const settings = { ...useStore.getState().settings, sourceLanguage: "auto" as const };
  props = {
    settings, model: overlayControlPanelModel(settings), phase: "listening",
    status: { source: "Automatic", separator: "→", target: "Chinese" },
    isPaused: false, isWaitingForFinalTranslation: false, isChangingSession: false,
    onDismiss: vi.fn(), onSwitchSourceLanguage: vi.fn().mockResolvedValue(undefined),
    onSetSubtitleDisplayMode: vi.fn().mockResolvedValue(undefined), onSetImmersiveMode: vi.fn().mockResolvedValue(undefined),
    onSetOverlayLocked: vi.fn().mockResolvedValue(undefined), onShowSettings: vi.fn().mockResolvedValue(undefined),
  };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  setStoredUiLanguage("system"); vi.unstubAllGlobals();
});
async function mount() { await act(async () => root.render(<OverlayControlPanel {...props} />)); }
function picker(label: string) { return host.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!; }
async function key(node: HTMLElement, value: string) {
  await act(async () => node.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
}

it.each(["zh", "en", "ja"] as const)("keeps %s controls to two short pickers and single-line switches without a mode grid", async (language) => {
  setStoredUiLanguage(language);
  await mount();
  expect(host.querySelectorAll('[role="combobox"]')).toHaveLength(2);
  expect(host.querySelector('fieldset, .overlay-control-options, .overlay-control-group')).toBeNull();
  expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);
  expect(host.querySelector('.overlay-control-setting small')).toBeNull();
  expect(picker(I18N.overlay.sourceLanguage)).toBe(document.activeElement);
  expect(props.onSwitchSourceLanguage).not.toHaveBeenCalled();
  expect(props.onSetSubtitleDisplayMode).not.toHaveBeenCalled();
});

it("supports keyboard source selection and dismisses only after the command succeeds", async () => {
  await mount();
  const source = picker(I18N.overlay.sourceLanguage);
  await key(source, "ArrowDown"); await key(source, "End"); await key(source, "Enter");
  expect(props.onSwitchSourceLanguage).toHaveBeenCalledExactlyOnceWith(props.model.sourceOptions.at(-1));
  expect(props.onDismiss).toHaveBeenCalledOnce();
});

it("changes subtitle display without closing the panel and lets Escape close only its picker", async () => {
  await mount();
  const display = picker(I18N.settings.subtitleDisplay);
  await key(display, "ArrowDown"); await key(display, "Escape");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(props.onDismiss).not.toHaveBeenCalled();
  await key(display, "ArrowDown"); await key(display, "End"); await key(display, "Enter");
  expect(props.onSetSubtitleDisplayMode).toHaveBeenCalledOnce();
  expect(props.onDismiss).not.toHaveBeenCalled();
});

it("blocks conflicting operations and retains an inline error after a failed toggle", async () => {
  let reject!: (reason: Error) => void;
  props.onSetImmersiveMode = vi.fn(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
  await mount();
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect([...host.querySelectorAll<HTMLButtonElement>('[role="combobox"], [role="switch"]')].every((button) => button.disabled)).toBe(true);
  await act(async () => reject(new Error("synthetic-toggle-failure")));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(I18N.overlay.controlActionFailed);
  expect(props.onDismiss).not.toHaveBeenCalled();
});

it("keeps recognition locked during transitions while independent display remains available", async () => {
  props.isChangingSession = true;
  await mount();
  expect(picker(I18N.overlay.sourceLanguage).disabled).toBe(true);
  expect(picker(I18N.settings.subtitleDisplay).disabled).toBe(false);
});
