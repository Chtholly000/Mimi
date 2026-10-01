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
async function render(phase: OverlayActivityPhaseKind, pulseStyle?: PulseStyle, motionEnabled = true, compact = false, prominent = false) {
  await act(async () => root.render(<PulseRing phase={phase} pulseStyle={pulseStyle} motionEnabled={motionEnabled} compact={compact} prominent={prominent} />));
  return host.firstElementChild as HTMLElement;
}

describe("selectable pulse styles", () => {
  it("defaults to ribbon without the old breathing light and gives both styles readable bounds", async () => {
    expect((await render("listening")).dataset.pulseStyle).toBe("ribbon");
    expect(host.querySelector(".phase-light__dot")).toBeNull();
    for (const style of ["syllable", "ribbon"] as const) {
      const normal = await render("listening", style);
      expect(normal.dataset.soundStyle).toBe(style);
      expect(normal.style.width).toBe("40px");
      expect((await render("listening", style, true, true)).style.width).toBe("24px");
      expect((await render("listening", style, true, false, true)).style.width).toBe("80px");
      expect((await render("listening", style, true, true, true)).style.width).toBe("48px");
    }
  });

  it.each(["syllable", "ribbon"] as const)("keeps %s tracks mounted when empty-overlay space changes with motion off", async style => {
    const light = await render("listening", style, false, false, true);
    const track = host.querySelector(".sound-light__beat");
    expect(light.dataset.clock).toBe("paused");
    await render("listening", style, false, true, true);
    expect(host.querySelector(".sound-light__beat")).toBe(track);
    expect(light.dataset.size).toBe("prominent-compact");
    expect(light.dataset.clock).toBe("paused");
    expect(light.getAttribute("aria-hidden")).toBe("true");
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
