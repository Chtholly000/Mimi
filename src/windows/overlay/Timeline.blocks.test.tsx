import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "./Timeline";
import type { SubtitleBlock } from "./overlayModel";
import type { SettingsSnapshot } from "../../lib/types";

const HISTORY: SubtitleBlock = {
  id: "history-1",
  createdAt: 1,
  presentation: "history",
  source: "Hello world",
  translation: "你好世界",
};

const LIVE: SubtitleBlock = {
  id: "live",
  createdAt: null,
  presentation: "live",
  source: "Streaming source",
  translation: "流式译文",
};

function render(
  blocks: SubtitleBlock[],
  displayMode: SettingsSnapshot["subtitleDisplayMode"] = "bilingual",
  blendsWithBackground = false,
): string {
  return renderToStaticMarkup(
    <Timeline
      blocks={blocks}
      fontSize={18}
      alignment="center"
      color="white"
      displayMode={displayMode}
      blendsWithBackground={blendsWithBackground}
    />,
  ).replaceAll(" ", "");
}

const SOURCE_FONT_PX = Math.max(12, 18 * 0.82);
/** Mirrors the lane viewport height: whole lines are reserved, then rounded. */
const laneHeight = (lines: number, fontPx: number) =>
  Math.round(lines * fontPx * 1.32);

describe("sentence block presentation", () => {
  it("keeps long confirmed history compact while following, retaining its full text", () => {
    const html = render([HISTORY]);
    expect(html).toContain("Helloworld");
    expect(html).toContain("overflow:hidden");
    expect(html).toContain('aria-label="Helloworld"');
  });

  it("clips the live tail to its line budget and keeps the full text accessible", () => {
    const html = render([HISTORY, LIVE]);
    // Bilingual live budget: one recognized line, two translation lines.
    expect(html).toContain(`height:${laneHeight(1, SOURCE_FONT_PX)}px`);
    expect(html).toContain(`height:${laneHeight(2, 18)}px`);
    expect(html).toContain("overflow:hidden");
    expect(html).toContain('aria-label="Streamingsource"');
    expect(html).toContain('aria-label="流式译文"');
  });

  it("sizes the compact budget from the display mode", () => {
    // Translation-only keeps two translation lines and no recognized lane.
    const translationOnly = render([{ ...LIVE, source: null }], "translation");
    expect(translationOnly).toContain(`height:${laneHeight(2, 18)}px`);
    expect(translationOnly).not.toContain('aria-label="Streamingsource"');

    // Original-only, and bilingual before its translation arrives, keep two
    // recognized lines.
    for (const mode of ["original", "bilingual"] as const) {
      const html = render([{ ...LIVE, translation: null }], mode);
      expect(html).toContain(`height:${laneHeight(2, SOURCE_FONT_PX)}px`);
    }
  });

  it("draws a sentence separator in the card presentation only", () => {
    expect(render([HISTORY, LIVE])).toContain("subtitle-separator");
    expect(render([HISTORY, LIVE], "bilingual", true)).not.toContain(
      "subtitle-separator",
    );
  });
});
