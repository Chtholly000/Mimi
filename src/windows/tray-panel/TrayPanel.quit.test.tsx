// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { TrayPanel } from "./TrayPanel";

let host: HTMLDivElement;
let root: Root;
const initial = useStore.getState();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setStoredUiLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useStore.setState(initial, true);
  setStoredUiLanguage("system");
  vi.unstubAllGlobals();
});

it.each(["zh", "en", "ja"] as const)("keeps the %s exit action available in idle, working, paused, transition and error states", async (language) => {
  setStoredUiLanguage(language);
  const quit = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ ...initial, quit }, true);
  await act(async () => root.render(<TrayPanel />));
  for (const kind of ["idle", "listening", "connecting", "stopping", "error"] as const) {
    for (const isPaused of [false, true]) {
      const status = kind === "error" ? { kind, message: "synthetic session error" } : { kind };
      await act(async () => useStore.setState({ session: { ...initial.session, status, isPaused } }));
      const button = host.querySelector<HTMLButtonElement>('[data-action="quit"]')!;
      expect(button.textContent).toBe(I18N.tray.quit);
      expect(button.disabled).toBe(false);
      expect(button.closest("footer")).not.toBeNull();
    }
  }
  expect(quit).not.toHaveBeenCalled();
  expect(host.textContent).not.toMatch(/Turbo|极速|最速/);
});

it("uses the normal quit action once, shows pending feedback and supports retry after failure", async () => {
  let reject!: (error: Error) => void;
  const quit = vi.fn(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
  useStore.setState({ ...initial, quit }, true);
  await act(async () => root.render(<TrayPanel />));
  const button = host.querySelector<HTMLButtonElement>('[data-action="quit"]')!;
  await act(async () => { button.click(); button.click(); });
  expect(quit).toHaveBeenCalledOnce();
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.textContent).toBe(I18N.tray.quitting);
  expect(button.disabled).toBe(true);
  await act(async () => reject(new Error("private raw failure")));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(I18N.tray.quitFailed);
  expect(host.textContent).not.toContain("private raw failure");
  expect(button.disabled).toBe(false);
  await act(async () => button.focus());
  expect(document.activeElement).toBe(button);
  await act(async () => button.click());
  expect(quit).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error("synthetic retry failure")));
});
