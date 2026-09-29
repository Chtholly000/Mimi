import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { hexToRgba } from "../../lib/types";
import { subtitleColorHex } from "../../lib/subtitleColor";
import type { SettingsSnapshot, SubtitleAlignment, SubtitleColor } from "../../lib/types";
import { observeTimelineResize } from "./timelineResize";
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
const SEPARATOR_MARGIN_Y = 6;
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
  blendsWithBackground?: boolean;
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
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    } else {
      // Same block, text grew: pin instantly so per-character streaming
      // never stutters.
      element.scrollTop = element.scrollHeight;
    }
  }, [blocks.length, lastTextLength, fontSize, alignment, blendsWithBackground]);

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
        const budget = subtitleLaneBudget(displayMode, block.translation !== null);
        return (
          <div
            key={block.id}
            className="relative"
            style={{
              paddingLeft: rowHorizontalPadding(
                alignment,
                "left",
                blendsWithBackground,
              ),
              paddingRight: rowHorizontalPadding(
                alignment,
                "right",
                blendsWithBackground,
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
              // New blocks settle in with a brief rise-and-fade (CSS animation
              // runs once on mount; the key is stable per block, so streaming
              // text updates do not re-trigger it).
              animation: "subtitle-row-enter 240ms ease-out",
            }}
          >
            {!blendsWithBackground && block.createdAt !== null ? (
              <span
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
                />
              ) : null}
            </div>
            {/* The separator belongs to the sentence above: it fades and
                scrolls away with it, and Immersive Mode keeps space only. */}
            {!isLast && !blendsWithBackground ? (
              <div
                aria-hidden="true"
                style={{
                  height: 1,
                  margin: `${SEPARATOR_MARGIN_Y}px 24px ${SEPARATOR_MARGIN_Y}px 0`,
                  background: "rgba(255,255,255,0.12)",
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
}: LaneProps) {
  const isSource = kind === "source";
  // In bilingual mode the recognized original is the reference lane: neutral
  // white, slightly smaller. In a single-language mode the visible lane is the
  // reading target and uses the user's subtitle color.
  const isReference = isSource && displayMode === "bilingual";
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
      <span className="block min-w-0" style={{ textAlign: alignment, ...textStyle }}>
        {text}
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
    />
  );
}

interface CompactLaneProps {
  text: string;
  lines: number;
  lineHeightPx: number;
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
  alignment,
  textStyle,
}: CompactLaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowed = useLaneOverflow(viewportRef);
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
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          textAlign: alignment,
          ...textStyle,
        }}
      >
        {text}
      </span>
      {overflowed ? (
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
          }}
        >
          {"…"}
        </span>
      ) : null}
    </div>
  );
}

/** True once the lane's full text is taller than the lines it may show. */
function useLaneOverflow(viewportRef: RefObject<HTMLDivElement | null>): boolean {
  const [overflowed, setOverflowed] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const measure = () => {
      const inner = viewport.firstElementChild;
      if (inner === null) return;
      setOverflowed(inner.getBoundingClientRect().height > viewport.clientHeight + 1);
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
  return overflowed;
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
