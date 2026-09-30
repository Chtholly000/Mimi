import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import type { SubtitleBlock } from "./overlayModel";

const LIVE_STREAMING: SubtitleBlock = {
  id: "live",
  createdAt: null,
  presentation: "live",
  source: "It is not attached",
  translation: "它并未附着",
  streaming: true,
};

const LIVE_SETTLED: SubtitleBlock = {
  id: "live",
  createdAt: null,
  presentation: "live",
  source: "It is not attached",
  translation: "它并未附着",
};

const COMMITTED: SubtitleBlock = {
  id: "history-1700",
  createdAt: 1_700_000_000_000,
  presentation: "latestCommitted",
  source: "It is not attached",
  translation: "它并未附着",
};

function render(blocks: SubtitleBlock[], displayMode: "bilingual" | "original" = "bilingual") {
  return renderToStaticMarkup(
    <Timeline
      blocks={blocks}
      fontSize={18}
      alignment="center"
      color="white"
      displayMode={displayMode}
      motionEnabled
    />,
  );
}

/** The markup of one lane, addressed by its accessible name. */
function laneMarkup(markup: string, label: string): string {
  const start = markup.indexOf(`aria-label="${label}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = markup.slice(start + 1);
  const next = rest.indexOf("aria-label=");
  return next === -1 ? rest : rest.slice(0, next);
}

/** Text of every element carrying a class inside one lane. */
function laneUnits(markup: string, label: string, className: string): string[] {
  return [
    ...laneMarkup(markup, label).matchAll(
      new RegExp(`class="${className}"[^>]*>([^<]*)<`, "g"),
    ),
  ].map((m) => m[1]);
}

describe("live streaming row", () => {
  it("marks the text still arriving with the typing wave", () => {
    const markup = render([LIVE_STREAMING]);
    expect(markup).toContain('class="stream-dots"');
    expect(markup.match(/<span><\/span>/g)?.length).toBe(3);
  });

  it("wraps each arriving unit so it can fade in, without losing text", () => {
    const markup = render([LIVE_STREAMING]);
    const units = laneUnits(markup, "它并未附着", "stream-chunk");
    expect(units.length).toBeGreaterThan(1);
    expect(units.join("")).toBe("它并未附着");
    expect(markup).toContain("It is not attached");
  });

  it("drops the wave when the session is not producing text", () => {
    expect(render([LIVE_SETTLED])).not.toContain("stream-dots");
  });
});

describe("committed row", () => {
  it("does not replay an entrance animation, so a commit never blinks", () => {
    const markup = render([COMMITTED]);
    expect(markup).not.toContain("subtitle-block");
    expect(markup).not.toContain("subtitle-lane");
  });

  it("renders plain text with no animation wrappers left behind", () => {
    const markup = render([COMMITTED]);
    expect(markup).not.toContain("stream-chunk");
    expect(markup).not.toContain("stream-dots");
    expect(markup).toContain("它并未附着");
  });

  it("keeps its timestamp, which the live row does not have", () => {
    expect(render([COMMITTED])).toContain("subtitle-timestamp");
    expect(render([LIVE_STREAMING])).not.toContain("subtitle-timestamp");
  });
});

describe("display modes", () => {
  it("marks the original when it is the lane being written", () => {
    const original = render([LIVE_STREAMING], "original");
    const dotsAt = original.indexOf("stream-dots");
    expect(dotsAt).toBeGreaterThan(-1);
    expect(dotsAt).toBeGreaterThan(original.indexOf("It is not attached"));
    expect(original).not.toContain("它并未附着");
  });

  it("keeps history rows free of wrappers in every mode", () => {
    for (const mode of ["bilingual", "original"] as const) {
      const markup = render([COMMITTED], mode);
      expect(markup).not.toContain("subtitle-block");
      expect(markup).not.toContain("stream-chunk");
    }
  });
});

describe("streaming units", () => {
  it("concatenate back to the lane text in both lanes", () => {
    const markup = render([LIVE_STREAMING]);
    expect(laneUnits(markup, "它并未附着", "stream-chunk").join("")).toBe("它并未附着");
    expect(laneUnits(markup, "It is not attached", "stream-chunk").join("")).toBe(
      "It is not attached",
    );
  });
});
