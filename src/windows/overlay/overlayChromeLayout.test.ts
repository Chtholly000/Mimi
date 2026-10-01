import { describe, expect, it } from "vitest";
import { overlayTopChromeLayout, overlaySessionChromeLayout } from "./overlayChromeLayout";

const CONTROL_ISLAND_RIGHT = 298;
const CHROME_GAP = 6;

function handleEdges(layout: ReturnType<typeof overlayTopChromeLayout>) {
  return {
    left: layout.dragHandleCenterX - layout.dragHandleWidth / 2,
    right: layout.dragHandleCenterX + layout.dragHandleWidth / 2,
  };
}

describe("overlay top chrome layout", () => {
  it("keeps the native capsule clearance and recovery actions after a session fails", () => {
    const error = overlaySessionChromeLayout(640, { isActive: false, status: { kind: "error", message: "unavailable" } });
    const listening = overlaySessionChromeLayout(640, { isActive: true, status: { kind: "listening" } });
    expect(error).toEqual(listening);
    expect(error.topBandHeight).toBe(61);
    expect(error.showActions).toBe(true);
    expect(error.showControls).toBe(true);
  });
  it("leaves an idle overlay without an island in its smaller chrome layout", () => {
    const idle = overlaySessionChromeLayout(640, { isActive: false, status: { kind: "idle" } });
    expect(idle.showActions).toBe(false);
    expect(idle.showControls).toBe(false);
    expect(idle.topBandHeight).toBe(37);
  });
  it("keeps the drag handle reachable to the right of the island at 360px", () => {
    const layout = overlayTopChromeLayout(360, true);
    const handle = handleEdges(layout);

    expect(layout.showActions).toBe(false);
    expect(handle.left).toBeGreaterThanOrEqual(
      CONTROL_ISLAND_RIGHT + CHROME_GAP,
    );
    expect(handle.right).toBeLessThanOrEqual(360 - 10 - CHROME_GAP);
  });

  it("keeps the compact fallback through widths that cannot fit all actions", () => {
    for (const width of [400, 480]) {
      const layout = overlayTopChromeLayout(width, true);
      expect(layout.showActions).toBe(false);
      expect(handleEdges(layout).left).toBeGreaterThanOrEqual(
        CONTROL_ISLAND_RIGHT + CHROME_GAP,
      );
    }
  });

  it("restores actions without shifting the handle off the window center", () => {
    const layout = overlayTopChromeLayout(552, true);

    expect(layout.showActions).toBe(true);
    expect(layout.dragHandleCenterX).toBe(276);
    expect(layout.dragHandleWidth).toBe(68);
  });

  it("preserves the centered 120px handle and all actions at 640px", () => {
    expect(overlayTopChromeLayout(640, true)).toEqual({
      dragHandleCenterX: 320,
      dragHandleWidth: 120,
      showActions: true,
    });
  });

  it("keeps an inactive overlay centered because it has no control island", () => {
    expect(overlayTopChromeLayout(360, false)).toEqual({
      dragHandleCenterX: 180,
      dragHandleWidth: 100,
      showActions: false,
    });
  });
});
