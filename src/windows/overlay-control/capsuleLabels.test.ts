import { expect, it } from "vitest";
import { capsuleLabels } from "./capsuleLabels";

it("keeps Chinese error, language and mode complete with intentional short labels", () => {
  expect(capsuleLabels({ sourceLanguage: "auto", targetLanguage: "zh" }, "turbo", "error", "zh"))
    .toEqual({ source: "自动", target: "中文", mode: "极速", phase: "错误" });
});

it("preserves mode distinctions and original-only meaning in every UI language", () => {
  for (const language of ["en", "zh", "ja"] as const) {
    const settings = { sourceLanguage: "auto", targetLanguage: "zh" } as const;
    const modes = ["lowLatency", "highQuality", "turbo"].map((mode) => capsuleLabels(settings, mode as "lowLatency" | "highQuality" | "turbo", "paused", language).mode);
    expect(new Set(modes).size).toBe(3);
    expect(capsuleLabels({ ...settings, targetLanguage: "original" }, "turbo", null, language).mode).not.toBe(modes[2]);
    expect(capsuleLabels(settings, "turbo", "error", language).phase).not.toContain("…");
  }
});
