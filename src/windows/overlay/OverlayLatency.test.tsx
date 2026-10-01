// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStoredUiLanguage } from "../../lib/i18n";
import type { SessionStateEvent } from "../../lib/types";
import { OverlayLatency } from "./OverlayLatency";
import { formatLatency } from "./latencyFormat";

let host: HTMLDivElement;
let root: Root;
const session: SessionStateEvent = {
  status: { kind: "listening" }, isActive: true, isPaused: false,
  isOverlayCollapsed: false, detectedLanguage: null,
  isTranslationPending: false, isTranslationTimedOut: false,
  subtitles: { source: { text: "", isFinal: false }, translation: { text: "", isFinal: false }, history: [] },
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setStoredUiLanguage("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(overrides: Partial<SessionStateEvent> = {}) {
  await act(async () => root.render(<OverlayLatency session={{ ...session, ...overrides }} />));
}

describe("overlay timing observations", () => {
  it("keeps unavailable and invalid samples distinct from a measured zero", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(formatLatency(value)).toBe("—");
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(238)).toBe("238 ms");
    expect(formatLatency(1250)).toBe("1.3 s");
  });
  it("shows missing measurements without inventing a timing", async () => {
    await render();
    expect(host.querySelectorAll("strong")[0].textContent).toBe("—");
    expect(host.querySelectorAll("strong")[1].textContent).toBe("—");
    expect(host.textContent).not.toContain("0 ms");
  });
  it("distinguishes translation request time from matching-final wait", async () => {
    await render({ apiLatencyMs: 120, translationLatencyMs: 700, translationLatencyKind: "request" });
    expect(host.textContent).toContain("Translation700 ms");
    await render({ apiLatencyMs: 120, translationLatencyMs: 0, translationLatencyKind: "follow" });
    expect(host.textContent).toContain("Translation wait0 ms");
    expect(host.querySelector('[aria-label="Translation wait: 0 ms"]')?.getAttribute("title")).toContain("translation arrived first");
  });
  it("suppresses stale observations while paused, connecting, failed, or stopped", async () => {
    const sample = { apiLatencyMs: 120, translationLatencyMs: 700, translationLatencyKind: "request" as const };
    for (const state of [{ isPaused: true }, { status: { kind: "connecting" as const } }, { status: { kind: "error" as const, message: "unavailable" } }]) {
      await render({ ...sample, ...state });
      expect(host.textContent).not.toContain("120 ms");
      expect(host.textContent).not.toContain("700 ms");
    }
    await render({ ...sample, isActive: false, status: { kind: "idle" } });
    expect(host.firstElementChild).toBeNull();
  });
  it.each(["zh", "en", "ja"] as const)("localizes the visible and accessible timing labels in %s", async language => {
    setStoredUiLanguage(language);
    await render({ apiLatencyMs: 120, translationLatencyMs: 200, translationLatencyKind: "follow" });
    expect(host.textContent).toContain({ zh: "译文等待", en: "Translation wait", ja: "訳文待ち" }[language]);
    expect(host.querySelectorAll("[aria-label]").length).toBe(2);
  });
});
