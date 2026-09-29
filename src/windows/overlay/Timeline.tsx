import { memo, useEffect, useMemo, useRef } from "react";
import { hexToRgba } from "../../lib/types";
import { subtitleColorHex } from "../../lib/subtitleColor";
import type { SettingsSnapshot, SubtitleAlignment, SubtitleColor } from "../../lib/types";
import { observeTimelineResize } from "./timelineResize";
import { rowHorizontalPadding } from "./alignment";
import { timelineClassName, type SubtitleBlock } from "./overlayModel";

const ACCENT = "#7AA8FF";
const MONO_FONT =
  '"SF Mono", Menlo, Consolas, "Courier New", monospace';
const IMMERSIVE_TEXT_SHADOW =
  "0 2px 5px rgba(0,0,0,0.98), 0 0 2px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.72)";

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
        const isLast = index === blocks.length - 1;
        const distance = blocks.length - 1 - index;
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
              paddingTop: isLast ? 7 : 5,
              paddingBottom: isLast ? 7 : 5,
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
            {block.source !== null ? (
              <Lane
                text={block.source}
                kind="source"
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
                fontSize={fontSize}
                alignment={alignment}
                displayMode={displayMode}
                color={color}
                blendsWithBackground={blendsWithBackground}
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
  fontSize: number;
  alignment: SubtitleAlignment;
  displayMode: SettingsSnapshot["subtitleDisplayMode"];
  color: SubtitleColor;
  blendsWithBackground: boolean;
}

function Lane({
  text,
  kind,
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
  return (
    <span
      className="block min-w-0"
      style={{
        textAlign: alignment,
        fontSize: isSource ? Math.max(12, fontSize * 0.82) : fontSize,
        fontWeight: isSource ? 400 : 500,
        color: hexToRgba(isReference ? "#FFFFFF" : subtitleColorHex(color), isReference ? 0.72 : 1),
        lineHeight: 1.45,
        overflowWrap: "break-word",
        textShadow: blendsWithBackground ? IMMERSIVE_TEXT_SHADOW : undefined,
      }}
    >
      {text}
    </span>
  );
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
