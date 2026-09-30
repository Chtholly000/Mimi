import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { hexToRgba } from "../../lib/types";
import { subtitleColorHex } from "../../lib/subtitleColor";
import type { SettingsSnapshot, SubtitleAlignment, SubtitleColor } from "../../lib/types";
import { observeTimelineResize } from "./timelineResize";
import { unitSpans } from "./animation";
import { rowHorizontalPadding } from "./alignment";
import {
  subtitleLaneBudget,
  timelineClassName,
  type SubtitleBlock,
} from "./overlayModel";

const ACCENT = "#7AA8FF";
const MONO_FONT =
  '"SF Mono", Menlo, Consolas, "Courier New", monospace';
const IMMERSIVE_TEXT_SHADOW =
  "0 2px 5px rgba(0,0,0,0.98), 0 0 2px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.72)";
const LINE_HEIGHT = 1.45;
const SOURCE_SCALE = 0.82;
/** Vertical rhythm: lines of one utterance sit close, sentences breathe. */
const LANE_GAP = 2;
const BLOCK_PADDING_Y = 4;
const LAST_BLOCK_PADDING_Y = 7;
/** Separator gap for the card presentation; immersive mode uses space only. */
const SEPARATOR_MARGIN_Y = 8;
const IMMERSIVE_BLOCK_GAP = 12;
interface TimelineProps {
  blocks: SubtitleBlock[];
  fontSize: number;
  alignment: SubtitleAlignment;
  color: SubtitleColor;
  /** Lane hierarchy follows the display mode: bilingual keeps the recognized
   * original as a neutral reference lane, single-language modes read in the
   * user's subtitle color. */
  displayMode: SettingsSnapshot["subtitleDisplayMode"];
  /** Optional metadata; hidden by default so sentence boundaries lead. */
  showTimestamps?: boolean;
  blendsWithBackground?: boolean;
  /** Resolved motion setting: gates the roll-up glide. */
  motionEnabled?: boolean;
}

/** Scrolling sentence blocks; auto-scrolls to the newest block. Memoized:
 * during live streaming the overlay re-renders on every session-state event,
 * but the timeline DOM only needs rebuilding when its blocks actually
 * change. */
export const Timeline = memo(function Timeline({
  blocks,
  fontSize,
  alignment,
  color,
  displayMode,
  blendsWithBackground = false,
  motionEnabled = true,
  showTimestamps = false,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the newest content pinned to the bottom: the block count changes when
  // an utterance is committed, and the live lanes grow while streaming (the
  // last block grows taller without changing the block count).
  const lastTextLength = useMemo(() => {
    const last = blocks[blocks.length - 1];
    return (last?.source?.length ?? 0) + (last?.translation?.length ?? 0);
  }, [blocks]);
  const prevBlockCountRef = useRef(blocks.length);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    if (blocks.length !== prevBlockCountRef.current) {
      // A new block glides to the bottom. Skip live-growth pinning in this
      // render so the two scroll updates never fight.
      prevBlockCountRef.current = blocks.length;
      element.scrollTo({ top: element.scrollHeight, behavior: motionEnabled ? "smooth" : "instant" });
    } else {
      // Same block, text grew: pin instantly so per-character streaming
      // never stutters.
      element.scrollTop = element.scrollHeight;
    }
  }, [blocks.length, lastTextLength, fontSize, alignment, blendsWithBackground, motionEnabled]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    return observeTimelineResize(element);
  }, []);

  return (
    <div
      ref={containerRef}
      className={timelineClassName(blendsWithBackground)}
      style={{ overscrollBehavior: "contain" }}
    >
      {blocks.map((block, index) => {
        const isFirst = index === 0;
        const isLast = index === blocks.length - 1;
        const distance = blocks.length - 1 - index;
        // The live tail and the newest committed utterance share the compact
        // presentation, so committing an utterance does not resize the panel;
        // it expands only once the next utterance starts.
        const compact = block.presentation !== "history";
        // Only a sentence that appears for the first time animates in. A
        // committed utterance replaces the live row it was already visible as,
        // so animating it again would blink the text the user is reading.
        const entering = block.presentation === "live";
        const streaming = block.streaming === true;
        const budget = subtitleLaneBudget(displayMode, block.translation !== null);
        return (
          <div
            key={block.id}
            className={entering ? "relative subtitle-block" : "relative"}
            style={{
              paddingLeft: rowHorizontalPadding(
                alignment,
                "left",
                blendsWithBackground || !showTimestamps,
              ),
              paddingRight: rowHorizontalPadding(
                alignment,
                "right",
                blendsWithBackground || !showTimestamps,
              ),
              paddingTop: isFirst
                ? blendsWithBackground
                  ? IMMERSIVE_BLOCK_GAP
                  : BLOCK_PADDING_Y
                : blendsWithBackground
                  ? IMMERSIVE_BLOCK_GAP
                  : BLOCK_PADDING_Y,
              paddingBottom: isLast ? LAST_BLOCK_PADDING_Y : BLOCK_PADDING_Y,
              // One age fade for the whole utterance: a long sentence that
              // wraps over several lines keeps a single visual level.
              opacity: blockOpacity(distance),
              // New blocks settle in with a brief rise-and-fade; the class runs
              // the animation once on mount (the key is stable per block, so
              // streaming text updates do not re-trigger it) and is skipped
              // when motion is off.
            }}
          >
            {showTimestamps && !blendsWithBackground && block.createdAt !== null ? (
              <span
                className="subtitle-timestamp"
                style={{
                  position: "absolute",
                  left: 18,
                  top: isLast ? 12 : 10,
                  width: 31,
                  textAlign: "right",
                  fontSize: 9,
                  fontWeight: 500,
                  fontFamily: MONO_FONT,
                  fontVariantNumeric: "tabular-nums",
                  color: hexToRgba(ACCENT, distance <= 1 ? 0.46 : 0.28),
                }}
              >
                {formatTimestamp(block.createdAt)}
              </span>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: LANE_GAP }}>
              {block.source !== null ? (
                <Lane
                  text={block.source}
                  kind="source"
                  lines={compact && budget.source > 0 ? budget.source : null}
                  fontSize={fontSize}
                  alignment={alignment}
                  displayMode={displayMode}
                  color={color}
                  blendsWithBackground={blendsWithBackground}
                  motionEnabled={motionEnabled}
                  entering={entering}
                  streaming={streaming}
                />
              ) : null}
              {block.translation !== null ? (
                <Lane
                  text={block.translation}
                  kind="translation"
                  lines={compact && budget.translation > 0 ? budget.translation : null}
                  fontSize={fontSize}
                  alignment={alignment}
                  displayMode={displayMode}
                  color={color}
                  blendsWithBackground={blendsWithBackground}
                  motionEnabled={motionEnabled}
                  entering={entering}
                  streaming={streaming}
                />
              ) : null}
            </div>
            {/* The separator belongs to the sentence above: it fades and
                scrolls away with it, and Immersive Mode keeps space only. */}
            {!isLast && !blendsWithBackground ? (
              <div
                aria-hidden="true"
                className="subtitle-separator"
                style={{
                  height: 1,
                  margin: `${SEPARATOR_MARGIN_Y}px 0`,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

interface LaneProps {
  text: string;
  kind: "source" | "translation";
  /** Visual lines to keep, newest text first in view; `null` renders the whole
   * text, which is what history blocks do. */
  lines: number | null;
  fontSize: number;
  alignment: SubtitleAlignment;
  displayMode: SettingsSnapshot["subtitleDisplayMode"];
  color: SubtitleColor;
  blendsWithBackground: boolean;
  motionEnabled: boolean;
  /** Runs the lane fade only for text that was not on screen before. */
  entering: boolean;
  /** The lane may still change: it carries the streaming marker. */
  streaming: boolean;
}

/**
 * Lane text while it is still arriving: each unit is its own element keyed by
 * its offset, so the CSS fade runs once per unit as it mounts and never replays
 * for text that is already on screen. Settled rows render plain text instead,
 * which leaves no wrappers behind once the stream ends.
 */
function renderLaneText(text: string, entering: boolean): ReactNode {
  if (!entering) return text;
  return unitSpans(text).map((unit) => (
    <span key={unit.start} className="stream-chunk">
      {unit.text}
    </span>
  ));
}

/** The typing wave that rides the end of the text still arriving. */
function StreamingDots() {
  return (
    <span className="stream-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Lane({
  text,
  kind,
  lines,
  fontSize,
  alignment,
  displayMode,
  color,
  blendsWithBackground,
  motionEnabled,
  entering,
  streaming,
}: LaneProps) {
  const isSource = kind === "source";
  // In bilingual mode the recognized original is the reference lane: neutral
  // white, slightly smaller. In a single-language mode the visible lane is the
  // reading target and uses the user's subtitle color.
  const isReference = isSource && displayMode === "bilingual";
  // The marker follows the text that is still arriving: the translation when
  // there is one, otherwise the recognized original.
  const streamingMarker = streaming && (kind === "translation" || displayMode === "original");
  const body = renderLaneText(text, entering);
  const laneFontSize = isSource ? Math.max(12, fontSize * SOURCE_SCALE) : fontSize;
  const textStyle = {
    fontSize: laneFontSize,
    fontWeight: isSource ? 400 : 500,
    color: hexToRgba(isReference ? "#FFFFFF" : subtitleColorHex(color), isReference ? 0.72 : 1),
    lineHeight: LINE_HEIGHT,
    overflowWrap: "break-word" as const,
    textShadow: blendsWithBackground ? IMMERSIVE_TEXT_SHADOW : undefined,
  };

  if (lines === null) {
    return (
      <span
        className={entering ? "block min-w-0 subtitle-lane" : "block min-w-0"}
        style={{ textAlign: alignment, ...textStyle }}
      >
        {body}
        {streamingMarker ? <StreamingDots /> : null}
      </span>
    );
  }

  return (
    <CompactLane
      text={text}
      lines={lines}
      lineHeightPx={laneFontSize * LINE_HEIGHT}
      alignment={alignment}
      textStyle={textStyle}
      motionEnabled={motionEnabled}
      entering={entering}
      streamingMarker={streamingMarker}
    />
  );
}

interface CompactLaneProps {
  text: string;
  lines: number;
  lineHeightPx: number;
  motionEnabled: boolean;
  entering: boolean;
  streamingMarker: boolean;
  alignment: SubtitleAlignment;
  textStyle: {
    fontSize: number;
    fontWeight: number;
    color: string;
    lineHeight: number;
    overflowWrap: "break-word";
    textShadow: string | undefined;
  };
}

/**
 * A lane that keeps only its newest `lines` visual lines. The full text is laid
 * out by the browser and anchored to the bottom, so the line breaker, CJK
 * wrapping, and font metrics stay the platform's job; the viewport clips the
 * old content from the top. A continuation marker appears only once the text
 * actually overflows, and the accessible name stays the full sentence.
 */
function CompactLane({
  text,
  lines,
  lineHeightPx,
  motionEnabled,
  entering,
  streamingMarker,
  alignment,
  textStyle,
}: CompactLaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const { overflowed, innerHeight } = useLaneOverflow(viewportRef);
  // Let the text glide upward when a new line pushes it instead of jumping.
  useRollupGlide(innerRef, innerHeight, motionEnabled);
  const body = renderLaneText(text, entering);
  return (
    <div
      ref={viewportRef}
      aria-label={text}
      style={{
        position: "relative",
        height: Math.round(lines * lineHeightPx),
        overflow: "hidden",
        // Fade the clipped edge so the roll-up reads as continuing text rather
        // than a cut.
        maskImage: overflowed
          ? "linear-gradient(to bottom, transparent 0, black 7px)"
          : undefined,
        WebkitMaskImage: overflowed
          ? "linear-gradient(to bottom, transparent 0, black 7px)"
          : undefined,
      }}
    >
      <span
        ref={innerRef}
        className={entering ? "subtitle-lane" : undefined}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          // Text starts on the first line while it fits; once it fills the
          // budget the same element stays pinned to the bottom so new content
          // grows upward and the old content rolls off the top.
          ...(overflowed ? { bottom: 0 } : { top: 0 }),
          textAlign: alignment,
          ...textStyle,
        }}
      >
        {body}
        {streamingMarker ? <StreamingDots /> : null}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 2,
          top: 0,
          width: 14,
          textAlign: "center",
          color: "rgba(255,255,255,0.42)",
          fontSize: Math.max(10, textStyle.fontSize * 0.62),
          lineHeight: textStyle.lineHeight,
          opacity: overflowed ? 1 : 0,
          transition: "opacity 180ms ease-out",
        }}
      >
        {"…"}
      </span>
    </div>
  );
}

/** Whether the lane's text overflows its budget, plus its laid-out height. */
function useLaneOverflow(viewportRef: RefObject<HTMLDivElement | null>): {
  overflowed: boolean;
  innerHeight: number;
} {
  const [measured, setMeasured] = useState({ overflowed: false, innerHeight: 0 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const measure = () => {
      const inner = viewport.firstElementChild;
      if (inner === null) return;
      const height = Math.round(inner.getBoundingClientRect().height);
      // Two pixels of hysteresis keep the marker from flickering on the exact
      // boundary while the text streams in.
      setMeasured({
        overflowed: height > viewport.clientHeight + 2,
        innerHeight: height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    // The viewport pins the height, so streaming text growth shows up on the
    // inner element; a font or width change shows up on the viewport.
    observer.observe(viewport);
    const inner = viewport.firstElementChild;
    if (inner !== null) observer.observe(inner);
    return () => observer.disconnect();
  }, [viewportRef]);
  return measured;
}

/**
 * Bottom-anchored text moves up by one line whenever it grows past the
 * budget. Shifting it back by the growth and releasing that offset turns the
 * jump into a short glide, which is what makes a roll-up feel continuous.
 */
function useRollupGlide(
  innerRef: RefObject<HTMLSpanElement | null>,
  innerHeight: number,
  enabled: boolean,
): void {
  const previousHeightRef = useRef(0);
  useEffect(() => {
    const inner = innerRef.current;
    const previous = previousHeightRef.current;
    previousHeightRef.current = innerHeight;
    if (inner === null || previous === 0 || innerHeight === previous) return;
    if (!enabled) return;
    const shift = previous - innerHeight;
    inner.style.transition = "none";
    inner.style.transform = `translateY(${shift}px)`;
    void inner.offsetHeight;
    inner.style.transition = "transform 180ms ease-out";
    inner.style.transform = "translateY(0)";
  }, [innerRef, innerHeight, enabled]);
}

function blockOpacity(distance: number): number {
  switch (distance) {
    case 0:
      return 1;
    case 1:
      return 0.68;
    default:
      return 0.44;
  }
}

/** HH:mm in local time using a 24-hour clock. */
function formatTimestamp(createdAt: number): string {
  const date = new Date(createdAt);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
