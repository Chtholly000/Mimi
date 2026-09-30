// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PulseRing } from "./PulseRing";
import type { OverlayActivityPhaseKind, PulseStyle } from "../../lib/types";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function render(phase: OverlayActivityPhaseKind, pulseStyle?: PulseStyle, motionEnabled = true, compact = false) {
  await act(async () => root.render(<PulseRing phase={phase} pulseStyle={pulseStyle} motionEnabled={motionEnabled} compact={compact} />));
  return host.firstElementChild as HTMLElement;
}

describe("selectable pulse styles", () => {
  it("preserves the original style by default and exposes both sound styles in the same bounds", async () => {
    expect((await render("listening")).dataset.pulseStyle).toBe("classic");
    expect(host.querySelector(".phase-light__dot")).not.toBeNull();
    for (const style of ["syllable", "ribbon"] as const) {
      const normal = await render("listening", style);
      expect(normal.dataset.soundStyle).toBe(style);
      expect(normal.style.width).toBe("40px");
      expect((await render("listening", style, true, true)).style.width).toBe("18px");
    }
  });

  it.each(["syllable", "ribbon"] as const)("keeps %s track nodes across phases and pauses/resumes its clock", async style => {
    const light = await render("recognizing", style);
    const track = host.querySelector(".sound-light__beat");
    await render("translating", style);
    expect(host.querySelector(".sound-light__beat")).toBe(track);
    await render("paused", style);
    expect(light.dataset.clock).toBe("running");
    await act(async () => { await vi.advanceTimersByTimeAsync(520); });
    expect(light.dataset.clock).toBe("paused");
    await render("listening", style);
    expect(host.querySelector(".sound-light__beat")).toBe(track);
    expect(light.dataset.clock).toBe("running");
    await render("recognizing", style, false);
    expect(light.dataset.clock).toBe("paused");
    expect(light.classList.contains("sound-light--still")).toBe(true);
  });
});
