// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionStateEvent, SettingsSnapshot } from "./types";
import { SNAPSHOT_STEP_TIMEOUT_MS } from "./settingsState";
import { useStore } from "./store";

const sources = vi.hoisted(() => ({ listenSettings: vi.fn(), listenSession: vi.fn(), getSettings: vi.fn(), getSession: vi.fn() }));
vi.mock("./ipc", async (original) => ({ ...await original<typeof import("./ipc")>(), isTauri: true,
  listenSettingsChanged: sources.listenSettings, listenSessionState: sources.listenSession,
  settingsGet: sources.getSettings, sessionGetState: sources.getSession,
}));

const initial = useStore.getState();
const settings: SettingsSnapshot = { ...initial.settings, profiles: [{ ...initial.settings.profiles[0], name: "Current service", credentialState: "present" }] };
const session: SessionStateEvent = { ...initial.session, status: { kind: "listening" }, isActive: true };
beforeEach(() => {
  vi.useFakeTimers();
  Object.values(sources).forEach((source) => source.mockReset());
  sources.listenSettings.mockResolvedValue(vi.fn()); sources.listenSession.mockResolvedValue(vi.fn());
  sources.getSettings.mockResolvedValue(settings); sources.getSession.mockResolvedValue(session);
  useStore.setState(initial, true);
});
afterEach(() => { vi.useRealTimers(); useStore.setState(initial, true); });

it("shares one pending attempt, publishes session promptly and exposes a timeout without background retries", async () => {
  let complete!: (snapshot: SettingsSnapshot) => void;
  let expiredHandler!: (snapshot: SettingsSnapshot) => void;
  const unlisten = vi.fn();
  sources.listenSettings.mockImplementationOnce(async (handler) => { expiredHandler = handler; return unlisten; });
  sources.getSettings.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const first = useStore.getState().init();
  expect(useStore.getState().init()).toBe(first);
  expect(useStore.getState().initializationStatus).toBe("loading");
  expect(useStore.getState().hasSettingsSnapshot).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(useStore.getState().session.isActive).toBe(true);
  expect(useStore.getState().settings).toBe(initial.settings);
  await vi.advanceTimersByTimeAsync(SNAPSHOT_STEP_TIMEOUT_MS); await first;
  expect(useStore.getState()).toMatchObject({ initialized: false, initializationStatus: "error", initializationError: "timeout" });
  expect(unlisten).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sources.getSettings).toHaveBeenCalledOnce();
  await useStore.getState().init();
  expect(useStore.getState()).toMatchObject({ initialized: true, initializationStatus: "ready", initializationError: null, hasSettingsSnapshot: true });
  const retrySettings = useStore.getState().settings;
  expiredHandler({ ...settings, fontSize: 24 }); complete({ ...settings, fontSize: 22 });
  await vi.advanceTimersByTimeAsync(0);
  expect(useStore.getState().settings).toBe(retrySettings);
  expect(sources.listenSettings).toHaveBeenCalledTimes(2);
});

it("cleans a listener completing after timeout and lets an explicit new generation load settings", async () => {
  let finishListener!: (unlisten: () => void) => void;
  sources.listenSettings.mockImplementationOnce(() => new Promise((resolve) => { finishListener = resolve; }));
  const first = useStore.getState().init();
  await vi.advanceTimersByTimeAsync(SNAPSHOT_STEP_TIMEOUT_MS); await first;
  expect(useStore.getState().initializationError).toBe("timeout");
  expect(sources.getSettings).not.toHaveBeenCalled();
  await useStore.getState().init();
  const lateUnlisten = vi.fn(); finishListener(lateUnlisten);
  await vi.advanceTimersByTimeAsync(0);
  expect(lateUnlisten).toHaveBeenCalledOnce();
  expect(useStore.getState().settings.profiles[0].credentialState).toBe("present");
  expect(useStore.getState().initializationStatus).toBe("ready");
  expect(sources.getSettings).toHaveBeenCalledOnce();
});

it("classifies an IPC rejection as a load failure and permits manual retry without changing credential availability", async () => {
  sources.getSettings.mockRejectedValueOnce("synthetic-native-error");
  await useStore.getState().init();
  expect(useStore.getState()).toMatchObject({ initialized: false, initializationStatus: "error", initializationError: "unavailable" });
  expect(useStore.getState().settings).toBe(initial.settings);
  expect(useStore.getState().hasSettingsSnapshot).toBe(false);
  await useStore.getState().init();
  expect(useStore.getState().settings).toBe(settings);
  expect(useStore.getState().initializationStatus).toBe("ready");
});
