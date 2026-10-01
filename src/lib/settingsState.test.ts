import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsSnapshot } from "./types";
import {
  initializeSnapshotStreams,
  mergeSettingsSnapshot,
  SettingsSaveCoordinator,
  SnapshotResponseGate,
  SNAPSHOT_STEP_TIMEOUT_MS,
} from "./settingsState";

afterEach(() => vi.useRealTimers());

const SETTINGS: SettingsSnapshot = {
  profiles: [
    {
      id: "alibaba-default",
      name: "Alibaba Cloud",
      provider: "alibabaCloud",
      credentialState: "present",
    },
  ],
  activeProfileId: "alibaba-default",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  translationMode: "lowLatency",
  fontSize: 18,
  subtitleColor: "white",
  subtitleAlignment: "center",
  subtitleDisplayMode: "translation",
  showSubtitleDividers: false,
  pulseAnimation: null,
  pulseStyle: "ribbon",
  subtitleAnimation: null,
  subtitleBlendsWithBackground: false,
  isOverlayLocked: false,
  uiLanguage: null,
  retainSessionHistory: false,
  recordSessionAudio: false,
  windowsAudioSource: "",
  showInDock: false,
  networkProxy: { mode: "system", url: null },
};

describe("mergeSettingsSnapshot", () => {
  it("normalizes the proxy route while preserving it across unrelated saves", () => {
    const custom = mergeSettingsSnapshot(SETTINGS, { networkProxy: { mode: "custom", url: "socks5h://127.0.0.1" } });
    expect(custom.networkProxy).toEqual({ mode: "custom", url: "socks5h://127.0.0.1:1080" });
    expect(mergeSettingsSnapshot(custom, { fontSize: 20 }).networkProxy).toEqual(custom.networkProxy);
    expect(mergeSettingsSnapshot(custom, { networkProxy: { mode: "direct", url: "discarded" } }).networkProxy).toEqual({ mode: "direct", url: null });
    expect(mergeSettingsSnapshot(custom, { networkProxy: { mode: "custom", url: "http://user:synthetic-secret@127.0.0.1" } }).networkProxy).toEqual(custom.networkProxy);
  });
  it("keeps a divider choice through unrelated saves and permits disabling it", () => {
    const enabled = mergeSettingsSnapshot(SETTINGS, { showSubtitleDividers: true });
    expect(mergeSettingsSnapshot(enabled, { fontSize: 20 }).showSubtitleDividers).toBe(true);
    expect(mergeSettingsSnapshot(enabled, { showSubtitleDividers: false }).showSubtitleDividers).toBe(false);
    expect(enabled.sourceLanguage).toBe(SETTINGS.sourceLanguage);
    expect(enabled.translationMode).toBe(SETTINGS.translationMode);
  });
  it("keeps a Dock choice through unrelated settings and allows explicitly hiding again", () => {
    const enabled = mergeSettingsSnapshot(SETTINGS, { showInDock: true });
    expect(mergeSettingsSnapshot(enabled, { uiLanguage: "ja" }).showInDock).toBe(true);
    expect(mergeSettingsSnapshot(enabled, { showInDock: false }).showInDock).toBe(false);
  });

  it("changes pulse style without changing explicit motion or unrelated choices", () => {
    const previous = { ...SETTINGS, pulseAnimation: false, subtitleAnimation: true, fontSize: 19 };
    const changed = mergeSettingsSnapshot(previous, { pulseStyle: "ribbon" });
    expect(changed).toMatchObject({ pulseStyle: "ribbon", pulseAnimation: false, subtitleAnimation: true, fontSize: 19 });
    expect(mergeSettingsSnapshot(changed, { fontSize: 20 }).pulseStyle).toBe("ribbon");
  });
  it("keeps an optimistic Windows source choice without changing pulse preferences", () => {
    const changed = mergeSettingsSnapshot({ ...SETTINGS, pulseStyle: "ribbon", pulseAnimation: false }, { windowsAudioSource: "synthetic-render-endpoint" });
    expect(changed).toMatchObject({ windowsAudioSource: "synthetic-render-endpoint", pulseStyle: "ribbon", pulseAnimation: false });
    expect(mergeSettingsSnapshot(changed, { fontSize: 20 }).windowsAudioSource).toBe("synthetic-render-endpoint");
  });
  it("merges runtime-safe subtitle presentation preferences", () => {
    expect(
      mergeSettingsSnapshot(SETTINGS, {
        subtitleColor: "#123456",
        subtitleAlignment: "right",
        subtitleDisplayMode: "bilingual",
        showSubtitleDividers: true,
        subtitleAnimation: true,
        pulseAnimation: false,
        subtitleBlendsWithBackground: true,
      }),
    ).toMatchObject({
      subtitleColor: "#123456",
      subtitleAlignment: "right",
      subtitleDisplayMode: "bilingual",
      showSubtitleDividers: true,
      subtitleAnimation: true,
      pulseAnimation: false,
      subtitleBlendsWithBackground: true,
    });
  });
});

describe("SettingsSaveCoordinator", () => {
  it("rolls the latest optimistic draft back when persistence fails", async () => {
    const coordinator = new SettingsSaveCoordinator();
    let current = SETTINGS;

    await expect(
      coordinator.save(
        current,
        { fontSize: 20 },
        async () => {
          throw new Error("save failed");
        },
        (settings) => {
          current = settings;
        },
      ),
    ).rejects.toThrow("save failed");

    expect(current.fontSize).toBe(18);
  });

  it("does not let an older failure roll back a newer successful save", async () => {
    const coordinator = new SettingsSaveCoordinator();
    let current = SETTINGS;
    let rejectFirst: ((error: Error) => void) | undefined;

    const first = coordinator.save(
      current,
      { fontSize: 19 },
      () =>
        new Promise<SettingsSnapshot>((_resolve, reject) => {
          rejectFirst = reject;
        }),
      (settings) => {
        current = settings;
      },
    );
    const second = coordinator.save(
      current,
      { fontSize: 20 },
      async () => ({ ...SETTINGS, fontSize: 20 }),
      (settings) => {
        current = settings;
      },
    );

    await Promise.resolve();
    rejectFirst?.(new Error("stale failure"));
    await expect(first).rejects.toThrow("stale failure");
    await second;

    expect(current.fontSize).toBe(20);
  });

  it("serializes persistence so the backend cannot finish saves out of order", async () => {
    const coordinator = new SettingsSaveCoordinator();
    let current = SETTINGS;
    let persistedFontSize = SETTINGS.fontSize;
    let finishFirst: (() => void) | undefined;
    let secondStarted = false;

    const persist = (draft: { fontSize?: number }) => {
      if (draft.fontSize === 19) {
        return new Promise<SettingsSnapshot>((resolve) => {
          finishFirst = () => {
            persistedFontSize = 19;
            resolve({ ...SETTINGS, fontSize: 19 });
          };
        });
      }
      secondStarted = true;
      persistedFontSize = 20;
      return Promise.resolve({ ...SETTINGS, fontSize: 20 });
    };

    const first = coordinator.save(
      current,
      { fontSize: 19 },
      persist,
      (settings) => {
        current = settings;
      },
    );
    const second = coordinator.save(
      current,
      { fontSize: 20 },
      persist,
      (settings) => {
        current = settings;
      },
    );

    await Promise.resolve();
    expect(secondStarted).toBe(false);
    expect(current.fontSize).toBe(20);

    finishFirst?.();
    await first;
    await second;

    expect(secondStarted).toBe(true);
    expect(persistedFontSize).toBe(20);
    expect(current.fontSize).toBe(20);
  });

  it("rolls a newer failed save back to the last confirmed snapshot", async () => {
    const coordinator = new SettingsSaveCoordinator();
    let current = SETTINGS;

    const first = coordinator.save(
      current,
      { fontSize: 19 },
      async () => ({ ...SETTINGS, fontSize: 19 }),
      (settings) => {
        current = settings;
      },
    );
    const second = coordinator.save(
      current,
      { fontSize: 20 },
      async () => {
        throw new Error("latest save failed");
      },
      (settings) => {
        current = settings;
      },
    );

    await first;
    await expect(second).rejects.toThrow("latest save failed");

    expect(current.fontSize).toBe(19);
  });

  it("ignores a pending response after an external snapshot", async () => {
    const coordinator = new SettingsSaveCoordinator();
    let current = SETTINGS;
    let resolveSave: ((snapshot: SettingsSnapshot) => void) | undefined;
    const pending = coordinator.save(
      current,
      { fontSize: 19 },
      () =>
        new Promise<SettingsSnapshot>((resolve) => {
          resolveSave = resolve;
        }),
      (settings) => {
        current = settings;
      },
    );

    await Promise.resolve();
    coordinator.invalidate();
    current = { ...SETTINGS, fontSize: 20 };
    resolveSave?.({ ...SETTINGS, fontSize: 19 });
    await pending;

    expect(current.fontSize).toBe(20);
  });
});

describe("initializeSnapshotStreams", () => {
  it("publishes session independently while settings is pending, then expires a hung settings snapshot", async () => {
    vi.useFakeTimers();
    const applySettings = vi.fn();
    const applySession = vi.fn();
    const unlistenSettings = vi.fn();
    const unlistenSession = vi.fn();
    let lateSettings!: (settings: string) => void;
    let settingsHandler!: (settings: string) => void;
    const initialization = initializeSnapshotStreams({
      listenSettings: async (handler) => { settingsHandler = handler; return unlistenSettings; },
      listenSession: async () => unlistenSession,
      getSettings: () => new Promise<string>((resolve) => { lateSettings = resolve; }),
      getSession: async () => "current-session",
    }, { applySettings, applySession });
    const rejected = expect(initialization).rejects.toThrow("snapshot-step-timeout");
    await vi.advanceTimersByTimeAsync(0);
    expect(applySession).toHaveBeenCalledExactlyOnceWith("current-session");
    expect(applySettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STEP_TIMEOUT_MS);
    await rejected;
    expect(unlistenSettings).toHaveBeenCalledOnce();
    expect(unlistenSession).toHaveBeenCalledOnce();
    settingsHandler("late-event"); lateSettings("late-snapshot");
    await vi.advanceTimersByTimeAsync(0);
    expect(applySettings).not.toHaveBeenCalled();
  });

  it("expires a hung listener, cleans it when it arrives, and keeps a retry generation independent", async () => {
    vi.useFakeTimers();
    let oldHandler!: (settings: string) => void;
    let completeListener!: (unlisten: () => void) => void;
    const lateUnlisten = vi.fn();
    const partialUnlisten = vi.fn();
    const applySettings = vi.fn();
    const applySession = vi.fn();
    const getSettings = vi.fn(async () => "unused-old-settings");
    const initialization = initializeSnapshotStreams({
      listenSettings: (handler) => { oldHandler = handler; return new Promise((resolve) => { completeListener = resolve; }); },
      listenSession: async () => partialUnlisten,
      getSettings,
      getSession: async () => "first-session",
    }, { applySettings, applySession });
    const rejected = expect(initialization).rejects.toThrow("snapshot-step-timeout");
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STEP_TIMEOUT_MS);
    await rejected;
    const retryCleanups = await initializeSnapshotStreams({
      listenSettings: async () => () => {}, listenSession: async () => () => {},
      getSettings: async () => "retry-settings", getSession: async () => "retry-session",
    }, { applySettings, applySession });
    oldHandler("expired-event"); completeListener(lateUnlisten);
    await vi.advanceTimersByTimeAsync(0);
    expect(lateUnlisten).toHaveBeenCalledOnce();
    expect(partialUnlisten).toHaveBeenCalledOnce();
    expect(getSettings).not.toHaveBeenCalled();
    expect(applySettings).toHaveBeenCalledExactlyOnceWith("retry-settings");
    expect(applySession.mock.calls.map(([session]) => session)).toEqual(["first-session", "retry-session"]);
    retryCleanups.forEach((unlisten) => unlisten());
  });

  it("keeps a session event received before its snapshot when the settings listener remains pending", async () => {
    vi.useFakeTimers();
    let sessionHandler!: (session: string) => void;
    let completeSession!: (session: string) => void;
    const applySession = vi.fn();
    const initialization = initializeSnapshotStreams({
      listenSettings: () => new Promise<() => void>(() => {}),
      listenSession: async (handler) => { sessionHandler = handler; return () => {}; },
      getSettings: async () => "unused-settings",
      getSession: () => new Promise<string>((resolve) => { completeSession = resolve; }),
    }, { applySettings: vi.fn(), applySession });
    const rejected = expect(initialization).rejects.toThrow("snapshot-step-timeout");
    await vi.advanceTimersByTimeAsync(0);
    sessionHandler("new-event"); completeSession("older-snapshot");
    await vi.advanceTimersByTimeAsync(0);
    expect(applySession).toHaveBeenCalledExactlyOnceWith("new-event");
    await vi.advanceTimersByTimeAsync(SNAPSHOT_STEP_TIMEOUT_MS);
    await rejected;
  });

  it("cleans a partial failure so initialization can be retried", async () => {
    let cleanupCount = 0;
    const appliedSettings: string[] = [];
    const appliedSessions: string[] = [];

    await expect(
      initializeSnapshotStreams(
        {
          listenSettings: async () => () => {
            cleanupCount += 1;
          },
          listenSession: async () => {
            throw new Error("listener unavailable");
          },
          getSettings: async () => "unused-settings",
          getSession: async () => "unused-session",
        },
        {
          applySettings: (settings) => appliedSettings.push(settings),
          applySession: (session) => appliedSessions.push(session),
        },
      ),
    ).rejects.toThrow("snapshot-listener-unavailable");

    expect(cleanupCount).toBe(1);
    expect(appliedSettings).toEqual([]);
    expect(appliedSessions).toEqual([]);

    await initializeSnapshotStreams(
      {
        listenSettings: async () => () => {},
        listenSession: async () => () => {},
        getSettings: async () => "retry-settings",
        getSession: async () => "retry-session",
      },
      {
        applySettings: (settings) => appliedSettings.push(settings),
        applySession: (session) => appliedSessions.push(session),
      },
    );

    expect(appliedSettings).toEqual(["retry-settings"]);
    expect(appliedSessions).toEqual(["retry-session"]);
  });

  it("keeps events received while stale boot snapshots are in flight", async () => {
    let settingsHandler: ((settings: string) => void) | undefined;
    let sessionHandler: ((session: string) => void) | undefined;
    let finishSettingsListener: (() => void) | undefined;
    let finishSessionListener: (() => void) | undefined;
    let resolveSettingsSnapshot: ((settings: string) => void) | undefined;
    let resolveSessionSnapshot: ((session: string) => void) | undefined;
    const appliedSettings: string[] = [];
    const appliedSessions: string[] = [];
    const settingsSnapshot = new Promise<string>((resolve) => {
      resolveSettingsSnapshot = resolve;
    });
    const sessionSnapshot = new Promise<string>((resolve) => {
      resolveSessionSnapshot = resolve;
    });

    const initialization = initializeSnapshotStreams(
      {
        listenSettings: (handler) => {
          settingsHandler = handler;
          return new Promise((resolve) => {
            finishSettingsListener = () => resolve(() => {});
          });
        },
        listenSession: (handler) => {
          sessionHandler = handler;
          return new Promise((resolve) => {
            finishSessionListener = () => resolve(() => {});
          });
        },
        getSettings: () => settingsSnapshot,
        getSession: () => sessionSnapshot,
      },
      {
        applySettings: (settings) => appliedSettings.push(settings),
        applySession: (session) => appliedSessions.push(session),
      },
    );

    // Both listeners are requested concurrently. An event can arrive while
    // native listener setup is still completing and must survive the later
    // snapshot response.
    expect(settingsHandler).toBeDefined();
    expect(sessionHandler).toBeDefined();
    settingsHandler?.("new-settings");
    sessionHandler?.("new-session");
    finishSettingsListener?.();
    finishSessionListener?.();
    await Promise.resolve();

    resolveSettingsSnapshot?.("old-settings");
    resolveSessionSnapshot?.("old-session");
    await initialization;

    expect(appliedSettings).toEqual(["new-settings"]);
    expect(appliedSessions).toEqual(["new-session"]);
  });

  it("continues live updates after boot reconciliation", async () => {
    let settingsHandler: ((settings: string) => void) | undefined;
    let sessionHandler: ((session: string) => void) | undefined;
    const appliedSettings: string[] = [];
    const appliedSessions: string[] = [];

    await initializeSnapshotStreams(
      {
        listenSettings: async (handler) => {
          settingsHandler = handler;
          return () => {};
        },
        listenSession: async (handler) => {
          sessionHandler = handler;
          return () => {};
        },
        getSettings: async () => "boot-settings",
        getSession: async () => "boot-session",
      },
      {
        applySettings: (settings) => appliedSettings.push(settings),
        applySession: (session) => appliedSessions.push(session),
      },
    );

    settingsHandler?.("live-settings");
    sessionHandler?.("live-session");

    expect(appliedSettings).toEqual(["boot-settings", "live-settings"]);
    expect(appliedSessions).toEqual(["boot-session", "live-session"]);
  });
});

describe("SnapshotResponseGate", () => {
  it("rejects an older response after a newer settings event", () => {
    const gate = new SnapshotResponseGate();
    const oldResponse = gate.capture();

    gate.advance();

    expect(gate.applyIfCurrent(oldResponse)).toBe(false);
    expect(gate.applyIfCurrent(gate.capture())).toBe(true);
  });
});
