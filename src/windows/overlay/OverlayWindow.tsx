import { useEffect, useMemo, useState } from "react";
import { I18N } from "../../lib/i18n";
import { isTauri, listenOverlayPointerMotion } from "../../lib/ipc";
import { useStore } from "../../lib/store";
import { OVERLAY_ACTIVITY_PHASES, hexToRgba } from "../../lib/types";
import { ControlButton } from "./ControlButton";
import { DragHandle } from "./DragHandle";
import { PulseRing } from "./PulseRing";
import { OverlayLatency } from "./OverlayLatency";
import { ResizeHandles } from "./ResizeHandles";
import { Timeline } from "./Timeline";
import { subtitleStreamKey, useResolvedMotion, useStableText } from "./animation";
import { overlaySessionChromeLayout } from "./overlayChromeLayout";
import { useSessionAction } from "./useSessionAction";
import { publishOverlayPointerMotion } from "../../lib/overlayPointer";
import {
  buildSubtitleBlocks,
  computeActivityPhase,
  emptyStateDensity,
  emptyStateIsError,
  emptyStateText,
  hasSubtitleContent,
  visibleLiveSubtitles,
} from "./overlayModel";

const ACCENT = "#7AA8FF";
const OVERLAY_INSET = 6;

/** Floating subtitle overlay driven by native session and geometry state. */
export function OverlayWindow() {
  const session = useStore((state) => state.session);
  const settings = useStore((state) => state.settings);
  const togglePaused = useStore((state) => state.togglePaused);
  const start = useStore((state) => state.start);
  const clearSubtitles = useStore((state) => state.clearSubtitles);
  const setOverlayCollapsed = useStore((state) => state.setOverlayCollapsed);
  const setOverlayLocked = useStore((state) => state.setOverlayLocked);
  const saveSettings = useStore((state) => state.saveSettings);
  const showSettings = useStore((state) => state.showSettings);
  const sessionAction = useSessionAction();
  const { clearFailure } = sessionAction;
  useEffect(() => {
    clearFailure();
  }, [session.status.kind, session.isActive, session.isPaused, clearFailure]);

  const [isHovering, setIsHovering] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let pointerInside = false;
    let removeListener: (() => void) | undefined;
    const blurWindow = () => {
      pointerInside = false;
      publishOverlayPointerMotion(null);
      setIsHovering(false);
    };
    window.addEventListener("blur", blurWindow);
    void listenOverlayPointerMotion((point) => {
      if (disposed) return;
      publishOverlayPointerMotion(point);
      const nextInside = point !== null;
      if (pointerInside !== nextInside) {
        pointerInside = nextInside;
        setIsHovering(nextInside);
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else removeListener = unlisten;
    }).catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("blur", blurWindow);
      removeListener?.();
      publishOverlayPointerMotion(null);
    };
  }, []);
  const [overlaySize, setOverlaySize] = useState(() => ({
    width: typeof window === "undefined" || !isTauri ? 640 : window.innerWidth,
    height:
      typeof window === "undefined" || !isTauri ? 136 : window.innerHeight,
  }));
  const topChromeLayout = overlaySessionChromeLayout(
    Math.max(0, overlaySize.width - OVERLAY_INSET * 2),
    session,
  );
  const showSessionControls = topChromeLayout.showControls;

  const collapsed = session.isOverlayCollapsed;
  const blendsWithBackground = settings.subtitleBlendsWithBackground;
  // Resolved once per render: an explicit switch overrides the system, and the
  // body class is what the CSS animations key off.
  const pulseOn = useResolvedMotion(settings.pulseAnimation);
  const motionOn = useResolvedMotion(settings.subtitleAnimation);
  useEffect(() => {
    document.body.classList.toggle("motion-reduced", !motionOn);
    document.body.classList.toggle("pulse-off", !pulseOn);
  }, [motionOn, pulseOn]);
  const presentationCollapsed = collapsed && !blendsWithBackground;
  const phase = computeActivityPhase(session, settings);
  const detectedLanguage = session.detectedLanguage;
  const activeProvider = settings.profiles.find(profile => profile.id === settings.activeProfileId)?.provider;
  const preferAtomicPreview = session.subtitles.previewPair !== undefined &&
    (activeProvider === "alibabaCloud" || activeProvider === "deepLX");
  // The live tail is stabilized before it becomes the newest sentence block:
  // original-mode text settles quickly, translated text stays calmer, and
  // confirmed/removed tails update immediately. Source and translation
  // previews have separate stabilization identities so a display-mode change
  // cannot retain the previous source.
  const livePreviews = useMemo(
    () =>
      visibleLiveSubtitles(
        session.subtitles,
        settings,
        detectedLanguage,
        session.isTranslationPending,
        session.isTranslationTimedOut,
        preferAtomicPreview,
      ),
    [
      session.subtitles,
      session.isTranslationPending,
      session.isTranslationTimedOut,
      settings,
      detectedLanguage,
      preferAtomicPreview,
    ],
  );
  const sourcePreview = livePreviews.find((preview) => preview.kind === "source");
  const translationPreview = livePreviews.find(
    (preview) => preview.kind === "translation",
  );
  const latestCommittedAt = session.subtitles.history.at(-1)?.createdAt ?? null;
  const sourceDraftText = useStableText(
    sourcePreview?.text ?? "",
    sourcePreview === undefined || sourcePreview.isFinal || sourcePreview.isStable ? 0 : 180,
    750,
    subtitleStreamKey(settings.subtitleDisplayMode, "source", session.subtitles.source.utteranceId, latestCommittedAt),
  );
  const translationDraftText = useStableText(
    translationPreview?.text ?? "",
    translationPreview === undefined || translationPreview.isFinal || translationPreview.isStable ? 0 : 400,
    1_500,
    subtitleStreamKey(settings.subtitleDisplayMode, "translation", session.subtitles.translation.utteranceId, latestCommittedAt),
  );
  // Sentence blocks: committed utterances plus the live tail, original above
  // translation. The block carries the timestamp, the age fade and the live
  // line budget, so a long sentence that wraps over several lines stays one
  // visual unit. Rebuilt from committed history and the (settled) live text.
  const liveIsStreaming = OVERLAY_ACTIVITY_PHASES[phase].animationSpeed > 0 &&
    ((sourcePreview !== undefined && !sourcePreview.isFinal && !sourcePreview.isStable) ||
      (translationPreview !== undefined && !translationPreview.isFinal && !translationPreview.isStable));
  const blocks = useMemo(
    () =>
      buildSubtitleBlocks(session.subtitles.history, settings.subtitleDisplayMode, {
        source: sourceDraftText === "" ? null : sourceDraftText,
        translation: translationDraftText === "" ? null : translationDraftText,
        // Text only counts as still arriving while the session is actually
        // working: a paused session keeps its frozen draft, but nothing is
        // coming, so the typing wave must stop with it.
        isStreaming: liveIsStreaming,
      }),
    [
      session.subtitles.history,
      settings.subtitleDisplayMode,
      liveIsStreaming,
      sourceDraftText,
      translationDraftText,
    ],
  );
  const hasContent = hasSubtitleContent(session.subtitles);

  const phaseLabel = OVERLAY_ACTIVITY_PHASES[phase].accessibilityLabel;
  const pauseLabel = session.isPaused
    ? I18N.overlay.resume
    : I18N.overlay.pause;
  const sessionActionBusy = sessionAction.pending || session.status.kind === "connecting" || session.status.kind === "stopping";
  const sessionActionLabel = sessionActionBusy
    ? session.status.kind === "stopping" ? I18N.overlay.stopping : I18N.overlay.connecting
    : session.status.kind === "error" ? I18N.overlay.retry : pauseLabel;
  const runSessionAction = () => {
    void sessionAction.run(session.status.kind === "error" ? start : togglePaused);
  };

  const toggleCollapsed = () => {
    void setOverlayCollapsed(!collapsed);
  };

  useEffect(() => {
    if (blendsWithBackground && collapsed) {
      void setOverlayCollapsed(false);
    }
  }, [blendsWithBackground, collapsed, setOverlayCollapsed]);

  useEffect(() => {
    if (!isTauri) return;
    const syncViewportSize = () => {
      setOverlaySize({ width: window.innerWidth, height: window.innerHeight });
    };
    syncViewportSize();
    window.addEventListener("resize", syncViewportSize);
    return () => window.removeEventListener("resize", syncViewportSize);
  }, []);

  const handleResize = (width: number, height: number) => {
    setOverlaySize({ width, height });
  };

  const content = (
    <>
      <div className="h-full w-full" style={{ padding: OVERLAY_INSET }}>
        <div
          key={presentationCollapsed ? "collapsed" : "expanded"}
          className={
            presentationCollapsed
              ? "overlay-swap-collapsed"
              : "overlay-swap-expanded"
          }
          style={{ height: "100%", width: "100%" }}
        >
          {presentationCollapsed ? renderCompact() : renderExpanded()}
        </div>
      </div>
      {!settings.isOverlayLocked && !presentationCollapsed && !blendsWithBackground && (
        <ResizeHandles disabled={false} onResize={handleResize} />
      )}
    </>
  );

  if (isTauri) {
    return <div className="relative h-full w-full">{content}</div>;
  }

  // Plain `vite dev` preview: a fixed box anchored near the bottom-center.
  return (
    <div className="flex h-screen w-screen items-end justify-center pb-[72px]">
      <div
        className="relative"
        style={{ width: overlaySize.width, height: overlaySize.height }}
      >
        {content}
      </div>
    </div>
  );

  function renderStatusLine() {
    if (sessionAction.pending || sessionAction.failed) {
      return <div role={sessionAction.failed ? "alert" : "status"} className="overlay-action-feedback">
        {sessionAction.pending ? I18N.overlay.connecting : I18N.overlay.controlActionFailed}
      </div>;
    }
    return <OverlayLatency session={session} translationRequired={settings.targetLanguage !== "original"} />;
  }

  function renderExpanded() {
    const topBandHeight = topChromeLayout.topBandHeight;
    const emptyDensity = emptyStateDensity(overlaySize.height);
    const compactEmptyPulse = emptyDensity === "compact";
    const pulseBaseSize = compactEmptyPulse ? 48 : 80;
    const emptyFontSize = emptyDensity === "minimal" ? 12 : Math.max(12, settings.fontSize * 0.68);
    const emptyGap = emptyDensity === "comfortable" ? 4 : 2;
    const statusLines = overlaySize.width < 480 ? 2 : 1;
    // Subtract the canvas inset, border, padding and the actual status-line
    // budget so the prominent light also fits short native windows.
    const emptyPulseSize = Math.min(pulseBaseSize, Math.max(0,
      overlaySize.height - 24 - topBandHeight - emptyFontSize * 1.25 * statusLines - emptyGap,
    ));
    const showEmptyPulse = session.isActive && emptyDensity !== "minimal" && emptyPulseSize >= 24;

    if (blendsWithBackground) {
      return (
        <div
          className="relative flex h-full w-full overflow-hidden"
          data-presentation="background-blend"
        >
          {renderStatusLine()}
          <div
            className="flex min-h-0 w-full flex-col"
            style={{
              // Keep the same subtitle content origin as the regular canvas.
              // Only its chrome disappears in Immersive Mode; the text must
              // not jump upward when the presentation changes.
              paddingTop: topBandHeight + 5,
              height: "100%",
            }}
          >
            {blocks.length > 0 && (
              <Timeline
                blocks={blocks}
                fontSize={settings.fontSize}
                color={settings.subtitleColor}
                alignment={settings.subtitleAlignment}
                displayMode={settings.subtitleDisplayMode}
                showSubtitleDividers={settings.showSubtitleDividers}
                motionEnabled={motionOn}
                blendsWithBackground
              />
            )}
          </div>
        </div>
      );
    }

    const hoverHighlight = isHovering && !settings.isOverlayLocked;
    const borderColor = hoverHighlight
      ? hexToRgba(ACCENT, 0.34)
      : "rgba(255,255,255,0.12)";
    const borderWidth = hoverHighlight ? 1 : 0.75;
    return (
      <div
        className="relative h-full w-full overflow-hidden"
        style={{
          borderRadius: 16,
          background: "var(--overlay-card-background, rgba(0,0,0,0.62))",
          border: `${borderWidth}px solid ${borderColor}`,
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.035), rgba(255,255,255,0))",
            pointerEvents: "none",
          }}
        />

        <div className="relative flex h-full flex-col" style={{ padding: 5 }}>
          {renderStatusLine()}
          {/* Top band: the drag handle is absolutely positioned — centered
              horizontally on the window (left 50% + translateX) and pinned
              to the band's bottom — so no flex layout or the capsule/button
              widths can shift it. The band itself only carries the opacity
              fade and lets pointer events through except on the handle. */}
          <div
            className="absolute inset-x-0 top-0"
            style={{
              height: topBandHeight,
              pointerEvents: "none",
              // Always-visible drag affordance: dimmed while idle, full on
              // hover. A fully transparent handle leaves no cue that the
              // overlay can be moved.
              opacity: isHovering ? 1 : session.isActive ? 0.45 : 0.6,
              transition: "opacity 160ms ease-out",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: topChromeLayout.dragHandleCenterX,
                bottom: 0,
                transform: "translateX(-50%)",
                pointerEvents: "auto",
              }}
            >
              <DragHandle
                onToggleCollapsed={toggleCollapsed}
                width={topChromeLayout.dragHandleWidth}
              />
            </div>
          </div>

          {showSessionControls &&
            !settings.isOverlayLocked &&
            topChromeLayout.showPrimaryAction && (
            <div
              className="absolute flex"
              style={{
                top: 10,
                right: 10,
                gap: 4,
                opacity: isHovering || session.isPaused || session.status.kind === "error" ? 1 : 0.75,
                pointerEvents: "auto",
                transition: "opacity 120ms ease",
              }}
            >
              <ControlButton
                icon={session.status.kind === "error" || session.isPaused ? "play" : "pause"}
                label={sessionActionLabel}
                onClick={runSessionAction}
                busy={sessionActionBusy}
                disabled={sessionActionBusy}
              />
              {topChromeLayout.showActions && <>
              <ControlButton
                icon="chevron-up"
                label={I18N.overlay.collapseSubtitle}
                onClick={() => void setOverlayCollapsed(true)}
                data-testid="collapse-subtitles"
              />
              {hasContent && (
                <ControlButton
                  icon="eraser"
                  label={I18N.overlay.clearSubtitles}
                  onClick={() => void clearSubtitles()}
                />
              )}
              <ControlButton
                icon="blend"
                label={I18N.overlay.enterImmersiveMode}
                onClick={() =>
                  void saveSettings({ subtitleBlendsWithBackground: true })
                }
                data-testid="toggle-immersive-mode"
              />
              <ControlButton
                icon="lock"
                label={I18N.overlay.lockPosition}
                onClick={() => void setOverlayLocked(true)}
                data-testid="toggle-overlay-lock"
              />
              <ControlButton
                icon="gear"
                label={I18N.overlay.openSettings}
                onClick={() => void showSettings()}
              />
              </>}
            </div>
          )}

          <div
            className="flex min-h-0 flex-col"
            style={{
              // The top band floats over the canvas, so reserve its exact
              // height or subtitle rows will slide underneath the controls.
              // The band includes space below the native control capsule.
              paddingTop: topBandHeight,
              height: "100%",
            }}
          >
          {blocks.length === 0 ? (
            <div
              className="flex flex-1 flex-col items-center justify-center"
              style={{ gap: emptyGap }}
            >
              {showEmptyPulse && (
                <div
                  className="flex shrink-0 items-center justify-center"
                  style={{ height: emptyPulseSize, width: emptyPulseSize }}
                >
                  <div style={{ transform: `scale(${emptyPulseSize / pulseBaseSize})` }}>
                    <PulseRing phase={phase} prominent compact={compactEmptyPulse} motionEnabled={pulseOn} pulseStyle={settings.pulseStyle} />
                  </div>
                </div>
              )}
              <div
                style={{
                  width: "100%",
                  minWidth: 0,
                  fontSize: emptyFontSize,
                  lineHeight: 1.25,
                  fontWeight: 500,
                  color: emptyStateIsError(session)
                    ? "rgba(255,69,58,0.9)"
                    : "var(--overlay-empty-text, rgba(255,255,255,0.5))",
                  textAlign: settings.subtitleAlignment,
                  padding: "0 24px",
                  whiteSpace: emptyDensity === "minimal" ? "nowrap" : undefined,
                  overflow: emptyDensity === "minimal" ? "hidden" : undefined,
                  textOverflow:
                    emptyDensity === "minimal" ? "ellipsis" : undefined,
                }}
              >
                {emptyStateText(session, settings)}
              </div>
            </div>
          ) : (
            <Timeline
              blocks={blocks}
              fontSize={settings.fontSize}
              color={settings.subtitleColor}
              alignment={settings.subtitleAlignment}
              displayMode={settings.subtitleDisplayMode}
              showSubtitleDividers={settings.showSubtitleDividers}
              motionEnabled={motionOn}
            />
          )}
          </div>
        </div>
      </div>
    );
  }

  function renderCompact() {
    return (
      <div
        className="relative h-full w-full"
        role="group"
        aria-label={`${I18N.overlay.collapsedAccessibilityPrefix}${phaseLabel}`}
        style={{
          borderRadius: 14,
          background: "var(--overlay-card-background, rgba(0,0,0,0.68))",
          border: `0.75px solid ${hexToRgba(ACCENT, isHovering ? 0.3 : 0.16)}`,
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onWheel={(event) => {
          if (event.deltaY !== 0) {
            event.preventDefault();
            void setOverlayCollapsed(false);
          }
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 14,
            background:
              "linear-gradient(to bottom, rgba(255,255,255,0.05), rgba(255,255,255,0))",
            pointerEvents: "none",
          }}
        />
        <div
          className="relative flex h-full items-center"
          style={{ gap: 8, padding: "0 10px" }}
        >
          <DragHandle onToggleCollapsed={toggleCollapsed} compact />
          <PulseRing phase={phase} compact motionEnabled={pulseOn} pulseStyle={settings.pulseStyle} />
          <span
            className="truncate"
            style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.76)" }}
          >
            {phaseLabel}
          </span>
          <span className="flex-1" style={{ minWidth: 4 }} />
          <ControlButton
            icon={session.status.kind === "error" || session.isPaused ? "play" : "pause"}
            label={sessionActionLabel}
            onClick={runSessionAction}
            busy={sessionActionBusy}
            disabled={sessionActionBusy}
          />
          <ControlButton
            icon="chevron-down"
            label={I18N.overlay.expandSubtitle}
            onClick={() => void setOverlayCollapsed(false)}
            data-testid="expand-subtitles"
          />
        </div>
      </div>
    );
  }
}
