// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { audio3ErrorMessage } from "../lib/audio3Errors";
import { diagnosticCopy } from "../lib/connectionDiagnostics";
import { I18N, setStoredUiLanguage } from "../lib/i18n";
import { useStore } from "../lib/store";
import { OverlayWindow } from "./overlay/OverlayWindow";
import { OverlayControlWindow } from "./overlay-control/OverlayControlWindow";
import { TrayPanel } from "./tray-panel/TrayPanel";
import { SubtitleSessionControls } from "./settings/SubtitleSessionControls";

vi.mock("../lib/ipc", async original => ({
  ...await original<typeof import("../lib/ipc")>(), isTauri: false,
}));
vi.mock("./overlay/PulseRing", () => ({ PulseRing: () => null }));
vi.mock("./overlay/ResizeHandles", () => ({ ResizeHandles: () => null }));
vi.mock("./overlay-control/CaptureStatusRow", () => ({ CaptureStatusRow: () => null }));
vi.mock("../lib/useDesktopShortcuts", () => ({ useDesktopShortcuts: () => ({ nativeShortcuts: true, commands: null }) }));
vi.mock("./overlay/Timeline", () => ({ Timeline: ({ blocks }: { blocks: { source: string | null }[] }) =>
  <div data-testid="retained-subtitles">{blocks.map(block => block.source).join(" ")}</div> }));

const initial = useStore.getState();
const unsupportedLanguage = "audio3_error.setup.unsupported_language.UNSUPPORTED_LANGUAGE";
const timeout = "audio3_error.recognition.timeout.LOCAL_TIMEOUT";
const surfaces = ["overlay", "history", "immersive", "collapsed", "locked", "control", "tray", "settings", "compact-settings"] as const;
type Surface = typeof surfaces[number];
let host: HTMLDivElement, root: Root;
let start: ReturnType<typeof vi.fn>, showSettings: ReturnType<typeof vi.fn>, setOverlayCollapsed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  window.history.replaceState(null, "", "?mode=panel");
  start = vi.fn().mockResolvedValue(undefined);
  showSettings = vi.fn().mockResolvedValue(undefined);
  setOverlayCollapsed = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ ...initial, start, showSettings, setOverlayCollapsed,
    settings: { ...initial.settings, pulseAnimation: false, subtitleAnimation: false, subtitleDisplayMode: "original",
      activeProfileId: "custom", targetLanguage: "original", sourceLanguage: "ja",
      profiles: [{ id: "custom", provider: "customDashScopeASR", name: "Speech fixture", credentialState: "present" }] },
    session: { ...initial.session, isActive: false, isPaused: false, status: { kind: "error", message: unsupportedLanguage } },
  }, true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useStore.setState(initial, true); setStoredUiLanguage("system");
  window.history.replaceState(null, "", window.location.pathname);
  vi.unstubAllGlobals();
});

async function mount(surface: Surface) {
  if (["history", "immersive", "collapsed", "locked"].includes(surface)) {
    useStore.setState(state => ({
      session: { ...state.session, isOverlayCollapsed: surface === "collapsed",
        subtitles: { ...state.session.subtitles, source: { text: "Retained synthetic subtitle", isFinal: true } } },
      settings: { ...state.settings, subtitleBlendsWithBackground: surface === "immersive", isOverlayLocked: surface === "locked" },
    }));
  }
  await act(async () => root.render(
    surface === "control" ? <OverlayControlWindow /> : surface === "tray" ? <TrayPanel />
      : surface === "settings" || surface === "compact-settings"
        ? <SubtitleSessionControls compact={surface === "compact-settings"} onConfigure={() => void showSettings("service")} />
        : <OverlayWindow />,
  ));
}

const feedback = () => host.querySelector<HTMLElement>(".session-error-feedback")!;
const configure = () => feedback().querySelector<HTMLButtonElement>("button")!;

it.each(["zh", "en", "ja"] as const)("keeps localized unsupported-language causes and configuration actions visible on every surface in %s", async language => {
  setStoredUiLanguage(language);
  for (const surface of surfaces) {
    await act(async () => root.render(null));
    await mount(surface);
    expect(feedback().getAttribute("role")).toBe("alert");
    expect(feedback().querySelector("p")?.textContent).toBe(audio3ErrorMessage(unsupportedLanguage));
    expect(feedback().closest('[aria-hidden="true"], [role="tooltip"]')).toBeNull();
    expect(host.textContent).not.toContain(unsupportedLanguage);
    expect(configure().textContent).toBe(I18N.settings.openSpeechSettings);
    expect(feedback().querySelectorAll("button")).toHaveLength(1);
    expect([...host.querySelectorAll("button")].some(button => button.textContent === I18N.settings.sessionRetry)).toBe(false);
    if (["history", "immersive", "collapsed", "locked"].includes(surface)) {
      expect(host.querySelector('[data-testid="retained-subtitles"]')?.textContent).toContain("Retained synthetic subtitle");
      expect(host.querySelector(".overlay-swap-collapsed, [data-presentation='background-blend']")).toBeNull();
      expect(host.querySelector<HTMLButtonElement>('[data-testid="drag-handle"]')?.disabled).toBe(true);
    }
    await act(async () => configure().focus());
    expect(document.activeElement).toBe(configure());
    await act(async () => configure().click());
    expect(showSettings).toHaveBeenLastCalledWith("service");
    expect(start).not.toHaveBeenCalled();
    expect(setOverlayCollapsed).not.toHaveBeenCalled();
  }
});

it.each(surfaces)("clears only the error presentation when %s recovers", async surface => {
  setStoredUiLanguage("en");
  await mount(surface);
  const settings = useStore.getState().settings;
  const subtitles = useStore.getState().session.subtitles;
  await act(async () => useStore.setState(state => ({ session: { ...state.session, status: { kind: "idle" } } })));
  expect(host.querySelector(".session-error-feedback")).toBeNull();
  expect(useStore.getState().settings).toBe(settings);
  expect(useStore.getState().session.subtitles).toBe(subtitles);
  if (surface === "collapsed") expect(host.querySelector(".overlay-swap-collapsed")).not.toBeNull();
  if (surface === "immersive") expect(host.querySelector('[data-presentation="background-blend"]')).not.toBeNull();
});

it.each(["overlay", "control", "tray", "settings", "compact-settings"] as const)("retains retry for a transient failure in %s", async surface => {
  setStoredUiLanguage("en");
  useStore.setState(state => ({ session: { ...state.session, status: { kind: "error", message: timeout } } }));
  await mount(surface);
  const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === I18N.settings.sessionRetry)!;
  expect(retry).toBeDefined();
  expect(feedback().textContent).toContain(audio3ErrorMessage(timeout));
  await act(async () => retry.click());
  expect(start).toHaveBeenCalledOnce();
  expect(showSettings).not.toHaveBeenCalled();
});

it.each(["overlay", "control", "tray"] as const)("guards configuration actions and sanitizes their failures in %s", async surface => {
  let reject!: (error: Error) => void;
  showSettings.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  await mount(surface);
  await act(async () => { configure().click(); configure().click(); });
  expect(showSettings).toHaveBeenCalledOnce();
  expect(configure().disabled).toBe(true);
  await act(async () => reject(new Error("private rejected settings action")));
  expect(configure().disabled).toBe(false);
  expect(host.textContent).not.toContain("private rejected settings action");
  expect(feedback().querySelector("p")?.textContent).toBe(audio3ErrorMessage(unsupportedLanguage));
  await act(async () => configure().click());
  expect(showSettings).toHaveBeenCalledTimes(2);
});

it("routes the settings start switch to configuration while a configuration error remains", async () => {
  await mount("settings");
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(async () => toggle.click());
  expect(showSettings).toHaveBeenCalledExactlyOnceWith("service");
  expect(start).not.toHaveBeenCalled();
});

it.each(["overlay", "control", "tray", "settings", "compact-settings"] as const)("never exposes an unrecognized provider message in %s", async surface => {
  useStore.setState(state => ({ session: { ...state.session, status: { kind: "error", message: "provider-private-text synthetic-key" } } }));
  await mount(surface);
  expect(feedback().querySelector("p")?.textContent).toBe(I18N.settings.sessionError);
  expect(host.textContent).not.toMatch(/provider-private-text|synthetic-key/);
});

it.each(["zh", "en", "ja"] as const)("shows an Audio3 startup transport cause and usable retry across surfaces in %s", async language => {
  setStoredUiLanguage(language);
  const error = "The speech recognition transport failed.";
  useStore.setState(state => ({ session: { ...state.session, status: { kind: "error", message: error } } }));
  for (const surface of surfaces) {
    await act(async () => root.render(null));
    start.mockClear();
    await mount(surface);
    expect(feedback().querySelector("p")?.textContent).toBe(diagnosticCopy().speechUnreachable);
    expect(feedback().closest('[aria-hidden="true"], [role="tooltip"]')).toBeNull();
    expect(host.textContent).not.toContain(error);
    expect(feedback().textContent).not.toContain(I18N.settings.sessionError);
    expect(configure().textContent).toBe(I18N.settings.openSpeechSettings);
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === I18N.settings.sessionRetry)!;
    expect(retry).toBeDefined();
    await act(async () => retry.click());
    expect(start).toHaveBeenCalledOnce();
    expect(showSettings).not.toHaveBeenCalled();
  }
});
