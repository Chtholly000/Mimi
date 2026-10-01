// @vitest-environment jsdom
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OverlayPointerMotion } from "../../lib/ipc";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { OverlayWindow } from "./OverlayWindow";

const listenPointer = vi.hoisted(() => vi.fn());
vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/ipc")>(),
  isTauri: true,
  listenOverlayPointerMotion: listenPointer,
}));
vi.mock("./PulseRing", () => ({ PulseRing: () => null }));
vi.mock("./ResizeHandles", () => ({ ResizeHandles: () => null }));

const original = useStore.getState();
let host: HTMLDivElement, root: Root;
let pointer: (point: OverlayPointerMotion) => void;
let previousHitTest: PropertyDescriptor | undefined;
const unlisten = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  unlisten.mockClear();
  listenPointer.mockReset().mockImplementation((handler) => {
    pointer = handler;
    return Promise.resolve(unlisten);
  });
  previousHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  setStoredUiLanguage("en");
  useStore.setState({ ...original,
    session: { ...original.session, isActive: true, status: { kind: "listening" } },
    settings: { ...original.settings, isOverlayLocked: false, subtitleBlendsWithBackground: false, pulseAnimation: false, subtitleAnimation: false },
  }, true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); useStore.setState(original, true); setStoredUiLanguage("system");
  if (previousHitTest) Object.defineProperty(document, "elementFromPoint", previousHitTest);
  else Reflect.deleteProperty(document, "elementFromPoint");
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("bridges inactive native hover without clicks, repeated window renders or an orphan listener", async () => {
  const commits = vi.fn();
  await act(async () => root.render(<Profiler id="overlay" onRender={commits}><OverlayWindow /></Profiler>));
  expect(listenPointer).toHaveBeenCalledOnce();
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${I18N.overlay.openSettings}"]`)!;
  const hitTest = vi.fn(() => button.querySelector("svg"));
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  await act(async () => pointer({ x: 20, y: 20 }));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(I18N.overlay.openSettings);
  expect(button.dataset.hovered).toBe("true");
  expect(document.activeElement).not.toBe(button);
  const afterEntering = commits.mock.calls.length;
  for (let i = 0; i < 30; i++) await act(async () => pointer({ x: 20 + i, y: 20 }));
  expect(commits).toHaveBeenCalledTimes(afterEntering);
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => pointer({ x: 20, y: 20 }));
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(async () => pointer(null));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(button.dataset.hovered).toBeUndefined();
  await act(async () => root.unmount());
  expect(unlisten).toHaveBeenCalledOnce();
  const previousCalls = hitTest.mock.calls.length;
  await act(async () => pointer({ x: 20, y: 20 }));
  expect(hitTest).toHaveBeenCalledTimes(previousCalls);
});

it("releases a native listener that finishes registering after the overlay unmounts", async () => {
  let finish: (unlisten: () => void) => void;
  listenPointer.mockImplementation(() => new Promise<() => void>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<OverlayWindow />));
  await act(async () => root.unmount());
  await act(async () => finish(unlisten));
  expect(unlisten).toHaveBeenCalledOnce();
});
