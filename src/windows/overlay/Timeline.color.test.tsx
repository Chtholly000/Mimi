import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "./Timeline";
import type { SubtitleColor } from "../../lib/types";

describe("subtitle colors", () => {
  it.each([false, true])("renders every preset in immersive=%s", (immersive) => {
    const palette: [SubtitleColor, string][] = [
      ["white", "255,255,255"], ["teal", "79,209,197"],
      ["yellow", "255,213,79"], ["green", "154,230,110"], ["pink", "244,154,181"], ["#123456", "18,52,86"],
    ];
    for (const [color, rgb] of palette) {
      const html = renderToStaticMarkup(<Timeline rows={[{ id: "line", text: "Subtitle", createdAt: null }]} fontSize={18} alignment="center" color={color} blendsWithBackground={immersive} />);
      expect(html.replaceAll(" ", "")).toContain(`color:rgba(${rgb},1)`);
    }
  });

  it("keeps bilingual sources neutral and drafts/history dimmed", () => {
    const html = renderToStaticMarkup(<Timeline rows={[
      { id: "old", text: "Old", createdAt: null },
      { id: "draft-source", text: "Source", createdAt: null, pairId: "live", kind: "source" },
      { id: "draft-translation", text: "Translation", createdAt: null, pairId: "live", kind: "translation" },
    ]} fontSize={18} alignment="left" color="#123456" draft />).replaceAll(" ", "");
    expect(html).toContain("color:rgba(18,52,86,0.34)");
    expect(html).toContain("color:rgba(255,255,255,0.72)");
    expect(html).toContain("color:rgba(18,52,86,0.72)");
  });
});
