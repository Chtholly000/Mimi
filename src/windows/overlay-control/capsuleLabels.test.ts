import { expect, it } from "vitest";
import { capsuleLabels } from "./capsuleLabels";

it("keeps Chinese error and language complete with intentional short labels", () => {
  expect(capsuleLabels({ sourceLanguage: "auto", targetLanguage: "zh" }, "error", "zh"))
    .toEqual({ source: "自动", target: "中文", phase: "错误" });
});

it("preserves original-only meaning and full phase labels in every UI language", () => {
  for (const language of ["en", "zh", "ja"] as const) {
    const settings = { sourceLanguage: "auto", targetLanguage: "zh" } as const;
    expect(capsuleLabels({ ...settings, targetLanguage: "original" }, null, language).target)
      .not.toBe(capsuleLabels(settings, null, language).target);
    expect(capsuleLabels(settings, "error", language).phase).not.toContain("…");
    expect(capsuleLabels(settings, "paused", language)).not.toHaveProperty("mode");
  }
});
