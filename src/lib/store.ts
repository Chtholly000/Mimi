import { audio3ErrorMessage } from "./audio3Errors";
import { audioSourceErrorMessage } from "./windowsAudioSource";
import { credentialErrorMessage } from "./connectionDiagnostics";
/**
 * Global zustand store. In Tauri it forwards every action to the Rust backend
 * and applies `session-state` / `settings-changed` events as they arrive. In a
 * plain `vite dev` session (no `__TAURI_INTERNALS__`) it emulates the backend
 * locally so the UI can be developed without the Rust side running.
 */

import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  appQuit,
  appShowSettings,
  isTauri,
  listenSessionState,
  listenSettingsChanged,
  overlaySetCollapsed,
  overlaySetLocked,
  overlayShow,
  profileCreate,
  profileDelete,
  profileDeleteAPIKey,
  profileSaveCredentials,
  profileSelect,
  profileUpdate,
  sessionClearSubtitles,
  sessionGetState,
  sessionStart,
  sessionStop,
  sessionSwitchSourceLanguage,
  sessionSwitchTranslationMode,
  sessionTogglePaused,
  settingsGet,
  settingsSave,
  trayPanelHide,
  type SettingsNavigationTarget,
} from "./ipc";
import { setStoredUiLanguage } from "./i18n";
import {
  capabilitiesForProvider,
  effectiveProviderForProfile,
  textTranslationForProfile,
  sourceLanguagesForSettings,
  targetLanguageAfterSourceSwitch,
  translationModesForSettings,
} from "./providerCapabilities";
import {
  initializeSnapshotStreams,
  mergeSettingsSnapshot,
  SettingsSaveCoordinator,
  SnapshotResponseGate,
} from "./settingsState";
import type {
  ProviderCredentialsInput,
  SessionStateEvent,
  SettingsDraft,
  SettingsSnapshot,
  ServiceProvider,
  SourceLanguage,
  SubtitleSnapshot,
  TranslationMode,
} from "./types";

const EMPTY_SUBTITLES: SubtitleSnapshot = {
  source: { text: "", isFinal: false },
  translation: { text: "", isFinal: false },
  history: [],
};

const INITIAL_SESSION: SessionStateEvent = {
  status: { kind: "idle" },
  isActive: false,
  isPaused: false,
  isOverlayCollapsed: false,
  subtitles: EMPTY_SUBTITLES,
  detectedLanguage: null,
  isTranslationPending: false,
  isTranslationTimedOut: false,
};

const INITIAL_SETTINGS: SettingsSnapshot = {
  profiles: [
    {
      id: "alibaba-default",
      name: "Alibaba Cloud",
      provider: "alibabaCloud",
      credentialState: isTauri ? "unavailable" : "present",
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
  pulseAnimation: null,
  pulseStyle: "classic",
  subtitleAnimation: null,
  subtitleBlendsWithBackground: false,
  isOverlayLocked: false,
  uiLanguage: null,
  retainSessionHistory: false,
  recordSessionAudio: false,
  windowsAudioSource: "",
};

interface StoreState {
  session: SessionStateEvent;
  settings: SettingsSnapshot;
  initialized: boolean;
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  togglePaused: () => Promise<void>;
  clearSubtitles: () => Promise<void>;
  switchSourceLanguage: (language: SourceLanguage) => Promise<void>;
  switchTranslationMode: (mode: TranslationMode) => Promise<void>;
  saveSettings: (draft: SettingsDraft) => Promise<void>;
  createProfile: (
    provider: ServiceProvider,
    name: string,
  ) => Promise<SettingsSnapshot>;
  updateProfile: (
    profileId: string,
    name: string,
  ) => Promise<SettingsSnapshot>;
  selectProfile: (profileId: string) => Promise<SettingsSnapshot>;
  deleteProfile: (profileId: string) => Promise<SettingsSnapshot>;
  saveProfileCredentials: (
    profileId: string,
    credentials: ProviderCredentialsInput,
  ) => Promise<SettingsSnapshot>;
  deleteProfileAPIKey: (profileId: string) => Promise<SettingsSnapshot>;
  setOverlayCollapsed: (collapsed: boolean) => Promise<void>;
  setOverlayLocked: (locked: boolean) => Promise<void>;
  showOverlay: () => Promise<void>;
  hideTrayPanel: () => Promise<void>;
  showSettings: (target?: SettingsNavigationTarget) => Promise<void>;
  quit: () => Promise<void>;
}

type SessionStoreSlice = Pick<StoreState, "session">;

/**
 * Stable primitive selectors for native windows that do not render subtitle
 * text. Provider drafts replace the session snapshot many times per second;
 * returning the status object would repaint hidden settings/tray windows on
 * every replacement even when their visible state did not change.
 */
export function selectSessionStatusKind(state: SessionStoreSlice) {
  return state.session.status.kind;
}

export function selectSessionErrorMessage(state: SessionStoreSlice) {
  return state.session.status.kind === "error"
    ? credentialErrorMessage(state.session.status.message) ?? audioSourceErrorMessage(state.session.status.message) ?? audio3ErrorMessage(state.session.status.message) ?? state.session.status.message
    : null;
}

export function selectHasRecognizingSourceDraft(state: SessionStoreSlice) {
  const source = state.session.subtitles.source;
  return source.text !== "" && !source.isFinal;
}

const unlisteners: UnlistenFn[] = [];
const settingsSaveCoordinator = new SettingsSaveCoordinator();
const settingsResponseGate = new SnapshotResponseGate();
let initializationRetryTimer: number | undefined;
let initializationRetryDelay = 500;

export const useStore = create<StoreState>()((set, get) => ({
  session: INITIAL_SESSION,
  settings: INITIAL_SETTINGS,
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    // Set the guard synchronously: React StrictMode double-invokes effects
    // in development, and both calls would otherwise register listeners.
    set({ initialized: true });
    if (isTauri) {
      try {
        unlisteners.push(
          ...(await initializeSnapshotStreams(
            {
              listenSettings: listenSettingsChanged,
              listenSession: listenSessionState,
              getSettings: settingsGet,
              getSession: sessionGetState,
            },
            {
              applySettings: (settings) => {
                settingsResponseGate.advance();
                settingsSaveCoordinator.invalidate();
                set({ settings });
                // Language switches initiated from any window reach every other
                // window through this event without reloading the WebView.
                syncUiLanguageFromSettings(settings);
              },
              applySession: (session) => set({ session }),
            },
          )),
        );
        initializationRetryDelay = 500;
      } catch {
        // Stay fail-closed and retry listener + snapshot setup as one unit.
        // Partial listeners are removed by initializeSnapshotStreams.
        set({ initialized: false });
        if (initializationRetryTimer === undefined) {
          const delay = initializationRetryDelay;
          initializationRetryDelay = Math.min(delay * 2, 8_000);
          initializationRetryTimer = window.setTimeout(() => {
            initializationRetryTimer = undefined;
            void get().init();
          }, delay);
        }
      }
    }
  },

  start: async () => {
    if (isTauri) {
      await sessionStart();
      return;
    }
    // Mock: flip into listening and seed a couple of Japanese→Chinese lines.
    const now = Date.now();
    set((state) => ({
      session: {
        status: { kind: "listening" },
        isActive: true,
        isPaused: false,
        isOverlayCollapsed: state.session.isOverlayCollapsed,
        subtitles: {
          source: { text: "今日は映画について話しましょう。", isFinal: true },
          translation: { text: "今天咱们聊聊电影吧。", isFinal: true },
          history: [
            {
              source: "今日は映画について話しましょう。",
              translation: "今天咱们聊聊电影吧。",
              createdAt: now - 6000,
            },
            {
              source: "主人公は駅で友達を待っています。",
              translation: "主人公正在车站等朋友呢。",
              createdAt: now - 3000,
            },
          ],
        },
        detectedLanguage: "ja",
        isTranslationPending: false,
        isTranslationTimedOut: false,
      },
    }));
  },

  stop: async () => {
    if (isTauri) {
      await sessionStop();
      return;
    }
    set((state) => ({
      session: {
        ...state.session,
        status: { kind: "idle" },
        isActive: false,
        isPaused: false,
        isTranslationPending: false,
        isTranslationTimedOut: false,
      },
    }));
  },

  togglePaused: async () => {
    if (isTauri) {
      await sessionTogglePaused();
      return;
    }
    set((state) => ({
      session: { ...state.session, isPaused: !state.session.isPaused },
    }));
  },

  clearSubtitles: async () => {
    if (isTauri) {
      await sessionClearSubtitles();
      return;
    }
    set((state) => ({
      session: {
        ...state.session,
        subtitles: EMPTY_SUBTITLES,
        isTranslationTimedOut: false,
      },
    }));
  },

  switchSourceLanguage: async (language) => {
    const current = get();
    if (
      sessionSettingsAreChanging(current.session) ||
      !sourceLanguagesForSettings(current.settings).includes(language)
    ) {
      return;
    }
    if (isTauri) {
      await sessionSwitchSourceLanguage(language);
      return;
    }
    set((state) => ({
      settings: {
        ...state.settings,
        sourceLanguage: language,
        targetLanguage: targetLanguageAfterSourceSwitch(
          state.settings,
          language,
        ),
      },
    }));
  },

  switchTranslationMode: async (mode) => {
    const current = get();
    if (
      sessionSettingsAreChanging(current.session) ||
      !translationModesForSettings(current.settings).includes(mode)
    ) {
      return;
    }
    if (isTauri) {
      await sessionSwitchTranslationMode(mode);
      return;
    }
    set((state) => ({
      settings: { ...state.settings, translationMode: mode },
    }));
  },

  saveSettings: async (draft) => {
    const previous = get().settings;
    if (!isTauri) {
      set({ settings: mergeSettingsSnapshot(previous, draft) });
      return;
    }
    await settingsSaveCoordinator.save(previous, draft, settingsSave, (settings) =>
      {
        settingsResponseGate.advance();
        set({ settings });
      },
    );
  },

  createProfile: async (provider, name) => {
    ensureProfileMutationsAllowed(get().session);
    if (isTauri) {
      const revision = settingsResponseGate.capture();
      const snapshot = await profileCreate(provider, name);
      if (settingsResponseGate.applyIfCurrent(revision)) {
        settingsSaveCoordinator.invalidate();
        set({ settings: snapshot });
        return snapshot;
      }
      return get().settings;
    }
    const current = get().settings;
    if (current.profiles.length >= 20) throw new Error("profile-limit");
    const id = `mock-${provider}-${Date.now()}`;
    const snapshot: SettingsSnapshot = {
      ...current,
      profiles: [
        ...current.profiles,
        { id, name, provider, credentialState: "missing" },
      ],
    };
    set({ settings: snapshot });
    return snapshot;
  },

  updateProfile: async (profileId, name) => {
    ensureProfileMutationsAllowed(get().session);
    if (isTauri) {
      const revision = settingsResponseGate.capture();
      const snapshot = await profileUpdate(profileId, name);
      if (settingsResponseGate.applyIfCurrent(revision)) {
        settingsSaveCoordinator.invalidate();
        set({ settings: snapshot });
        return snapshot;
      }
      return get().settings;
    }
    const current = get().settings;
    const snapshot: SettingsSnapshot = {
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, name } : profile,
      ),
    };
    set({ settings: snapshot });
    return snapshot;
  },

  selectProfile: async (profileId) => {
    ensureProfileMutationsAllowed(get().session);
    if (isTauri) {
      const revision = settingsResponseGate.capture();
      const snapshot = await profileSelect(profileId);
      if (settingsResponseGate.applyIfCurrent(revision)) {
        settingsSaveCoordinator.invalidate();
        set({ settings: snapshot });
        return snapshot;
      }
      return get().settings;
    }
    const current = get().settings;
    const selected = current.profiles.find((profile) => profile.id === profileId);
    if (!selected) throw new Error("profile-not-found");
    const snapshot = settingsAfterMockProfileSelection(current, effectiveProviderForProfile(selected));
    snapshot.activeProfileId = profileId;
    set({ settings: snapshot });
    return snapshot;
  },

  deleteProfile: async (profileId) => {
    ensureProfileMutationsAllowed(get().session);
    if (isTauri) {
      const revision = settingsResponseGate.capture();
      const snapshot = await profileDelete(profileId);
      if (settingsResponseGate.applyIfCurrent(revision)) {
        settingsSaveCoordinator.invalidate();
        set({ settings: snapshot });
        return snapshot;
      }
      return get().settings;
    }
    const current = get().settings;
    if (current.profiles.length <= 1) throw new Error("last-profile");
    const profiles = current.profiles.filter((profile) => profile.id !== profileId);
    const activeProfileId =
      current.activeProfileId === profileId
        ? (profiles[0]?.id ?? "")
        : current.activeProfileId;
    const snapshot: SettingsSnapshot = { ...current, profiles, activeProfileId };
    set({ settings: snapshot });
    return snapshot;
  },

  saveProfileCredentials: async (profileId, credentials) => {
    ensureProfileMutationsAllowed(get().session);
    if (isTauri) {
      const revision = settingsResponseGate.capture();
      const snapshot = await profileSaveCredentials(profileId, credentials);
      if (settingsResponseGate.applyIfCurrent(revision)) {
        settingsSaveCoordinator.invalidate();
        set({ settings: snapshot });
        return snapshot;
      }
      return get().settings;
    }
    const current = get().settings;
    if (credentials.kind === "alibabaTranslation") {
      const profile = current.profiles.find((profile) => profile.id === profileId);
      if (!profile || !["alibabaCloud", "deepLX"].includes(profile.provider)) throw new Error("provider-mismatch");
      if (!credentials.apiKey.trim() && profile.credentialState !== "present") throw new Error("credential-empty");
      if (credentials.textTranslation === "deepLX" && !credentials.endpoint.trim() && textTranslationForProfile(profile) !== "deepLX") throw new Error("credential-empty");
    } else if (Object.entries(credentials).some(([field, value]) => field !== "kind" && field !== "token" && !value.trim())) {
      throw new Error("credential-empty");
    }
    const snapshot: SettingsSnapshot = {
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === profileId
          ? { ...profile, credentialState: "present", ...(credentials.kind === "alibabaTranslation" ? { textTranslation: credentials.textTranslation } : {}) }
          : profile,
      ),
    };
    set({ settings: snapshot });
    return snapshot;
  },

  deleteProfileAPIKey: async (profileId) => {
    ensureProfileMutationsAllowed(get().session);
    if (isTauri) {
      const revision = settingsResponseGate.capture();
      const snapshot = await profileDeleteAPIKey(profileId);
      if (settingsResponseGate.applyIfCurrent(revision)) {
        settingsSaveCoordinator.invalidate();
        set({ settings: snapshot });
        return snapshot;
      }
      return get().settings;
    }
    const current = get().settings;
    const snapshot: SettingsSnapshot = {
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === profileId
          ? { ...profile, credentialState: "missing" }
          : profile,
      ),
    };
    set({ settings: snapshot });
    return snapshot;
  },

  setOverlayCollapsed: async (collapsed) => {
    // Optimistic local update so the overlay layout switches immediately;
    // the backend event confirms it afterwards.
    set((state) => ({
      session: { ...state.session, isOverlayCollapsed: collapsed },
    }));
    if (isTauri) {
      await overlaySetCollapsed(collapsed);
    }
  },

  setOverlayLocked: async (locked) => {
    if (isTauri) {
      await overlaySetLocked(locked);
      return;
    }
    set((state) => ({
      settings: { ...state.settings, isOverlayLocked: locked },
    }));
  },

  showOverlay: async () => {
    if (isTauri) await overlayShow();
  },

  hideTrayPanel: async () => {
    if (isTauri) await trayPanelHide();
  },

  showSettings: async (target) => {
    if (isTauri) await appShowSettings(target);
  },

  quit: async () => {
    if (isTauri) await appQuit();
  },
}));

function ensureProfileMutationsAllowed(session: SessionStateEvent): void {
  if (session.isActive) throw new Error("session-active");
}

function sessionSettingsAreChanging(session: SessionStateEvent): boolean {
  return (
    session.status.kind === "connecting" || session.status.kind === "stopping"
  );
}

function settingsAfterMockProfileSelection(
  current: SettingsSnapshot,
  provider: ServiceProvider,
): SettingsSnapshot {
  if (provider === "alibabaCloud") return { ...current };
  const capabilities = capabilitiesForProvider(provider);
  const sourceLanguage =
    capabilities.sourceLanguages.find(
      (source) =>
        !(
          (source === "zh" && current.targetLanguage === "zh") ||
          (source === "en" && current.targetLanguage === "en") ||
          (source === "ja" && current.targetLanguage === "ja")
        ),
    ) ?? capabilities.sourceLanguages[0];
  return {
    ...current,
    sourceLanguage: sourceLanguage ?? current.sourceLanguage,
    targetLanguage:
      current.targetLanguage === "original" ? "zh" : current.targetLanguage,
    translationMode: "turbo",
  };
}

/** Settings events update each window in place, preserving updater resources. */
function syncUiLanguageFromSettings(settings: SettingsSnapshot): void {
  setStoredUiLanguage(settings.uiLanguage ?? "system");
}
