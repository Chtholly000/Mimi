// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { OverlayControlMode } from "../../lib/ipc";
import { useStore } from "../../lib/store";
import { OverlayControlWindow } from "./OverlayControlWindow";

const native = vi.hoisted(() => ({
  onMode: undefined as ((mode: OverlayControlMode) => void) | undefined,
  hide: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../lib/ipc", async original => ({
  ...await original<typeof import("../../lib/ipc")>(), isTauri: true,
  overlayControlGetState: async () => "panel",
  overlayControlSetIslandWidth: async () => {}, overlayControlSetPanelHeight: async () => {},
  overlayPopoverHide: native.hide,
  listenOverlayControlMode: async (callback: (mode: OverlayControlMode) => void) => {
    native.onMode = callback; return () => { native.onMode = undefined; };
  },
}));

it("closes focused source help before Escape dismisses the actual control panel", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // Complete the panel's opening autofocus before the user tabs to help.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const initial = useStore.getState();
  useStore.setState({ settings: { ...initial.settings, audioInput: "both" } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<OverlayControlWindow />));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    const help = host.querySelector<HTMLButtonElement>('.overlay-control-capture .settings-help-control__button')!;
    await act(async () => help.focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    const escape = () => help.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await act(async () => { escape(); });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(help);
    expect(native.hide).not.toHaveBeenCalled();
    await act(async () => { escape(); });
    expect(native.hide).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); host.remove();
    useStore.setState(initial, true); native.hide.mockClear(); vi.unstubAllGlobals();
  }
});
