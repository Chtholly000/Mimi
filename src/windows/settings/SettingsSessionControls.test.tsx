// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsSessionControls } from "./SettingsSessionControls";

it("requires a running session to enter immersive without starting it, and always permits exit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onSessionChange = vi.fn(), onImmersiveChange = vi.fn(), onConfigure = vi.fn();
  const base = { checked: false, disabled: false, status: "idle" as const, statusText: "Not started", isActive: false, isChanging: false, immersive: false, canConfigure: false, actionFailed: false, nativeShortcuts: true, desktopShortcuts: null, onSessionChange, onImmersiveChange, onConfigure };
  const controls = () => [...host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
  try {
    await act(async () => root.render(<SettingsSessionControls {...base} />));
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(onImmersiveChange).not.toHaveBeenCalled();
    expect(controls()[1].disabled).toBe(true);
    await act(async () => controls()[1].click());
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(onImmersiveChange).not.toHaveBeenCalled();
    await act(async () => root.render(<SettingsSessionControls {...base} isActive checked />));
    expect(controls()[1].disabled).toBe(false);
    await act(async () => controls()[1].click());
    expect(onImmersiveChange).toHaveBeenLastCalledWith(true);
    expect(onSessionChange).not.toHaveBeenCalled();
    await act(async () => root.render(<SettingsSessionControls {...base} immersive isChanging />));
    expect(controls()[1].disabled).toBe(false);
    await act(async () => controls()[1].click());
    expect(onImmersiveChange).toHaveBeenLastCalledWith(false);
    await act(async () => root.render(<SettingsSessionControls {...base} disabled canConfigure />));
    expect(controls()[0].disabled).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('.settings-button')!.click());
    expect(onConfigure).toHaveBeenCalledOnce();
    for (const [agent, expected] of [["Macintosh", ["⌘⇧Space", "⌘⇧M"]], ["Windows", ["Ctrl+Shift+Space", "Ctrl+Shift+M"]], ["Linux X11", ["Ctrl+Shift+Space", "Ctrl+Shift+M"]]] as const) {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
      await act(async () => root.render(<SettingsSessionControls {...base} />));
      expect([...host.querySelectorAll("kbd")].map(key => key.textContent)).toEqual(expected);
    }
    await act(async () => root.render(<SettingsSessionControls {...base} nativeShortcuts={false} />));
    expect(host.querySelector('kbd')).toBeNull();
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
