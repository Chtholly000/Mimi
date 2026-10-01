import type { SettingsDraft, SettingsSnapshot } from "./types";
import { DEFAULT_NETWORK_PROXY, validateNetworkProxy } from "./networkProxy";

type Unlisten = () => void;

interface SnapshotStreamSources<Settings, Session> {
  listenSettings: (
    handler: (settings: Settings) => void,
  ) => Promise<Unlisten>;
  listenSession: (handler: (session: Session) => void) => Promise<Unlisten>;
  getSettings: () => Promise<Settings>;
  getSession: () => Promise<Session>;
}

interface SnapshotStreamConsumers<Settings, Session> {
  applySettings: (settings: Settings) => void;
  applySession: (session: Session) => void;
}

export const SNAPSHOT_STEP_TIMEOUT_MS = 12_000;

export class SnapshotBootstrapTimeoutError extends Error {
  constructor() { super("snapshot-step-timeout"); }
}

function withSnapshotDeadline<Value>(operation: Promise<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SnapshotBootstrapTimeoutError()), SNAPSHOT_STEP_TIMEOUT_MS);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Installs event listeners before requesting boot snapshots. Events received
 * while a snapshot is in flight are buffered and win over the older response.
 * Each stream progresses independently with a deadline for each native step:
 * a delayed credential snapshot must not hold back the session snapshot.
 */
export async function initializeSnapshotStreams<Settings, Session>(
  sources: SnapshotStreamSources<Settings, Session>,
  consumers: SnapshotStreamConsumers<Settings, Session>,
): Promise<Unlisten[]> {
  let active = true;
  const unlisteners: Unlisten[] = [];
  const clearBuffers: Unlisten[] = [];
  const safelyUnlisten = (unlisten: Unlisten) => {
    try { unlisten(); } catch { /* Continue cleaning other subscriptions. */ }
  };

  const startStream = async <Snapshot>(
    listen: (handler: (snapshot: Snapshot) => void) => Promise<Unlisten>,
    getSnapshot: () => Promise<Snapshot>,
    apply: (snapshot: Snapshot) => void,
  ) => {
    let bootstrapping = true;
    let buffered: Snapshot | undefined;
    clearBuffers.push(() => { buffered = undefined; });
    try {
      const subscription = listen((snapshot) => {
        if (!active) return;
        if (bootstrapping) buffered = snapshot;
        else apply(snapshot);
      }).then((unlisten) => {
        // A listen command can complete after its UI attempt has expired.
        if (active) unlisteners.push(unlisten);
        else safelyUnlisten(unlisten);
      });
      await withSnapshotDeadline(subscription);
    } catch (error) {
      active = false;
      throw error instanceof SnapshotBootstrapTimeoutError ? error : new Error("snapshot-listener-unavailable");
    }
    if (!active) return;
    let snapshot: Snapshot;
    try { snapshot = await withSnapshotDeadline(getSnapshot()); }
    catch (error) {
      active = false;
      throw error instanceof SnapshotBootstrapTimeoutError ? error : new Error("boot-snapshot-unavailable");
    }
    if (!active) return;
    // Selecting the buffered event and enabling live mode happen in one turn.
    const latest = buffered ?? snapshot;
    buffered = undefined;
    bootstrapping = false;
    apply(latest);
  };

  try {
    await Promise.all([
      startStream(sources.listenSettings, sources.getSettings, consumers.applySettings),
      startStream(sources.listenSession, sources.getSession, consumers.applySession),
    ]);
    return unlisteners.map((unlisten) => () => { active = false; safelyUnlisten(unlisten); });
  } catch (error) {
    active = false;
    for (const clear of clearBuffers) clear();
    for (const unlisten of unlisteners) safelyUnlisten(unlisten);
    throw error;
  }
}

export function mergeSettingsSnapshot(
  current: SettingsSnapshot,
  draft: SettingsDraft,
): SettingsSnapshot {
  const networkProxy = draft.networkProxy === undefined ? null
    : validateNetworkProxy(draft.networkProxy.mode, draft.networkProxy.url);
  return {
    ...current,
    sourceLanguage: draft.sourceLanguage ?? current.sourceLanguage,
    targetLanguage: draft.targetLanguage ?? current.targetLanguage,
    translationMode: draft.translationMode ?? current.translationMode,
    fontSize: draft.fontSize ?? current.fontSize,
    subtitleColor: draft.subtitleColor ?? current.subtitleColor,
    subtitleAlignment: draft.subtitleAlignment ?? current.subtitleAlignment,
    subtitleDisplayMode: draft.subtitleDisplayMode ?? current.subtitleDisplayMode,
    showSubtitleDividers: draft.showSubtitleDividers ?? current.showSubtitleDividers,
    pulseAnimation: draft.pulseAnimation ?? current.pulseAnimation,
    pulseStyle: draft.pulseStyle ?? current.pulseStyle,
    subtitleAnimation: draft.subtitleAnimation ?? current.subtitleAnimation,
    windowsAudioSource: draft.windowsAudioSource ?? current.windowsAudioSource,
    showInDock: draft.showInDock ?? current.showInDock,
    // Do not put an invalid or credential-bearing URL into the global UI
    // snapshot while native validation is still pending.
    networkProxy: networkProxy && "config" in networkProxy ? networkProxy.config : current.networkProxy ?? DEFAULT_NETWORK_PROXY,
    subtitleBlendsWithBackground:
      draft.subtitleBlendsWithBackground ??
      current.subtitleBlendsWithBackground,
    isOverlayLocked: draft.isOverlayLocked ?? current.isOverlayLocked,
    uiLanguage: draft.uiLanguage ?? current.uiLanguage,
    retainSessionHistory:
      draft.retainSessionHistory ?? current.retainSessionHistory,
    recordSessionAudio: draft.recordSessionAudio ?? current.recordSessionAudio,
  };
}

/**
 * Applies settings drafts immediately, persists them in call order, and keeps
 * the last confirmed snapshot for rollback. External snapshots invalidate
 * pending UI responses without allowing their older results to overwrite the
 * store.
 */
export class SettingsSaveCoordinator {
  private generation = 0;
  private epoch = 0;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private confirmedSnapshot: SettingsSnapshot | null = null;
  private activeSaves = 0;

  invalidate(): void {
    this.generation += 1;
    this.epoch += 1;
    this.confirmedSnapshot = null;
  }

  async save(
    previous: SettingsSnapshot,
    draft: SettingsDraft,
    persist: (draft: SettingsDraft) => Promise<SettingsSnapshot>,
    apply: (settings: SettingsSnapshot) => void,
  ): Promise<void> {
    const generation = ++this.generation;
    const epoch = this.epoch;
    if (this.confirmedSnapshot === null) {
      this.confirmedSnapshot = previous;
    }
    this.activeSaves += 1;
    apply(mergeSettingsSnapshot(previous, draft));

    const operation = this.persistenceQueue.then(async () => {
      try {
        const snapshot = await persist(draft);
        if (epoch === this.epoch) {
          this.confirmedSnapshot = snapshot;
          if (generation === this.generation) apply(snapshot);
        }
      } catch (error) {
        if (epoch === this.epoch && generation === this.generation) {
          apply(this.confirmedSnapshot ?? previous);
        }
        throw error;
      } finally {
        this.activeSaves -= 1;
        if (this.activeSaves === 0) this.confirmedSnapshot = null;
      }
    });

    // A failed save must reject its own caller without poisoning later saves.
    this.persistenceQueue = operation.catch(() => {});
    return operation;
  }
}

/** Prevents an older command response from overwriting a newer event or save. */
export class SnapshotResponseGate {
  private revision = 0;

  capture(): number {
    return this.revision;
  }

  advance(): void {
    this.revision += 1;
  }

  applyIfCurrent(expectedRevision: number): boolean {
    if (expectedRevision !== this.revision) return false;
    this.advance();
    return true;
  }
}
