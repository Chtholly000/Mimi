// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import type { SubtitleBlock } from "./overlayModel";

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalScrollTo = HTMLElement.prototype.scrollTo;
const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
let root: Root;
let host: HTMLDivElement;
let measuredHeight = 24;
let viewportHeight = 100;
let resize: Array<() => void>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resize = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize.push(callback); }
    observe() {}
    disconnect() {}
  });
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, bottom: measuredHeight, height: measuredHeight } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) { return Number.parseFloat(this.style.height) || viewportHeight; },
  });
  measuredHeight = 24;
  viewportHeight = 100;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  HTMLElement.prototype.scrollTo = originalScrollTo;
  if (clientHeightDescriptor) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  vi.unstubAllGlobals();
});

const confirmed: SubtitleBlock = {
  id: "confirmed",
  createdAt: 1,
  presentation: "latestCommitted",
  source: "完整原文。".repeat(30),
  translation: "完整译文。".repeat(30),
};
const live: SubtitleBlock = {
  id: "live", createdAt: null, presentation: "live",
  source: "新的流式原文。", translation: "新的流式译文。", streaming: true,
};

async function render(blocks: SubtitleBlock[], fontSize = 18, motionEnabled = false) {
  await act(async () => root.render(<Timeline blocks={blocks} fontSize={fontSize} alignment="center" color="white" displayMode="bilingual" motionEnabled={motionEnabled} />));
  return host.firstElementChild as HTMLDivElement;
}

it("uses only the actual line height for a short translation, then bounds later growth", async () => {
  const timeline = await render([{ ...confirmed, source: null, translation: "短句" }]);
  let viewport = timeline.querySelector<HTMLElement>('[aria-label="短句"]')!;
  expect(viewport.style.height).toBe("24px"); // Two reserved lines would waste another 24px.
  measuredHeight = 240;
  await act(async () => { resize.forEach(callback => callback()); });
  viewport = timeline.querySelector<HTMLElement>('[aria-label="短句"]')!;
  expect(viewport.style.height).toBe("48px");
  expect(viewport.firstElementChild?.textContent).toBe("短句");
});

it("keeps the same confirmed long sentence bounded when the next live sentence appears", async () => {
  measuredHeight = 240;
  const timeline = await render([confirmed]);
  const before = timeline.querySelector<HTMLElement>('[data-utterance-id="confirmed"]')!;
  const viewport = before.querySelector<HTMLElement>("[aria-label]");
  expect(before.textContent).toContain(confirmed.source);
  expect(before.textContent).toContain(confirmed.translation);
  await render([{ ...confirmed, presentation: "history" }, live]);
  const after = timeline.querySelector<HTMLElement>('[data-utterance-id="confirmed"]')!;
  expect(after).toBe(before);
  expect(after.querySelector("[aria-label]")).toBe(viewport);
  expect(after.textContent).toContain(confirmed.source);
  expect(after.textContent).toContain(confirmed.translation);
});

it("reveals full confirmed history on upward intent and returns to compact following with End", async () => {
  measuredHeight = 240;
  const timeline = await render([{ ...confirmed, presentation: "history" }, live]);
  await act(async () => { timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -30 })); });
  const read = timeline.querySelector<HTMLElement>('[data-utterance-id="confirmed"]')!;
  expect(read.querySelector("[aria-label]")).toBeNull();
  expect(read.textContent).toContain(confirmed.source);
  expect(read.textContent).toContain(confirmed.translation);
  expect(timeline.querySelector('[data-utterance-id="live"] [aria-label]')).not.toBeNull();
  await render([{ ...confirmed, presentation: "history" }, { ...live, translation: "仍然流入" }]);
  expect(read.querySelector("[aria-label]")).toBeNull();
  await act(async () => { timeline.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })); });
  expect(read.querySelector("[aria-label]")).not.toBeNull();
});

it("opens a single compact confirmed sentence without needing a scrollbar, while clicks keep following", async () => {
  measuredHeight = 240;
  const timeline = await render([confirmed]);
  await act(async () => { timeline.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  expect(timeline.querySelector("[aria-label]")).not.toBeNull();
  await act(async () => { timeline.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })); });
  expect(timeline.querySelector("[aria-label]")).toBeNull();
  // With no remaining overflow, a downward wheel must restore following even
  // though the browser does not produce a scroll event.
  await act(async () => { timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 30 })); });
  expect(timeline.querySelector("[aria-label]")).not.toBeNull();
});

it("fits both long bilingual lanes into the actual 51px body at font size 20 and restores the second translation line after resize", async () => {
  measuredHeight = 240;
  viewportHeight = 51;
  const timeline = await render([confirmed], 20);
  const row = timeline.firstElementChild as HTMLElement;
  const lanes = Array.from(row.querySelectorAll<HTMLElement>("[aria-label]"));
  const laneHeights = lanes.map(lane => Number.parseFloat(lane.style.height));
  expect(laneHeights).toEqual([22, 26]);
  expect(laneHeights.reduce((sum, height) => sum + height, 0) + 1 + 1).toBeLessThanOrEqual(viewportHeight);
  expect(row.style.paddingTop).toBe("0px");
  viewportHeight = 130;
  await act(async () => { resize.forEach(callback => callback()); });
  expect(lanes[1].style.height).toBe("53px");
  expect(row.textContent).toContain(confirmed.source);
  expect(row.textContent).toContain(confirmed.translation);
});

it("uses a downward finger gesture to open full confirmed text while keeping touch taps compact", async () => {
  measuredHeight = 240;
  const timeline = await render([confirmed]);
  const touch = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "touches", { value: [{ clientY: y }] });
    timeline.dispatchEvent(event);
  };
  await act(async () => { touch("touchstart", 20); });
  expect(timeline.querySelector("[aria-label]")).not.toBeNull();
  await act(async () => { touch("touchmove", 40); });
  expect(timeline.querySelector("[aria-label]")).toBeNull();
});

it("gives a bilingual translation the unused original lane's space before that original arrives", async () => {
  measuredHeight = 240;
  viewportHeight = 51;
  const timeline = await render([{ ...live, source: null }]);
  expect(timeline.querySelector<HTMLElement>("[aria-label]")?.style.height).toBe("48px");
});

it("rolls a newly clipped line up from its previous position without first opening a gap below the text", async () => {
  measuredHeight = 48;
  const timeline = await render([{ ...confirmed, source: null }], 18, true);
  const inner = timeline.querySelector<HTMLElement>("[aria-label]")!.firstElementChild as HTMLElement;
  const transforms = vi.spyOn(inner.style, "transform", "set");
  measuredHeight = 72;
  await act(async () => { resize.forEach(callback => callback()); });
  expect(transforms.mock.calls.map(([value]) => value)).toEqual(["translateY(24px)", "translateY(0)"]);
  expect(inner.style.transition).toBe("transform 180ms ease-out");
  transforms.mockRestore();
});

it("does not glide a new line that still fits the compact lane", async () => {
  measuredHeight = 24;
  const timeline = await render([{ ...confirmed, source: null }], 18, true);
  const inner = timeline.querySelector<HTMLElement>("[aria-label]")!.firstElementChild as HTMLElement;
  const transforms = vi.spyOn(inner.style, "transform", "set");
  measuredHeight = 48;
  await act(async () => { resize.forEach(callback => callback()); });
  expect(transforms.mock.calls.map(([value]) => value)).toEqual(["translateY(0)"]);
  expect(inner.style.transition).toBe("none");
  transforms.mockRestore();
});

it("stops an active glide and keeps further growth still when motion is disabled", async () => {
  measuredHeight = 48;
  const blocks = [{ ...confirmed, source: null }];
  const timeline = await render(blocks, 18, true);
  const inner = timeline.querySelector<HTMLElement>("[aria-label]")!.firstElementChild as HTMLElement;
  measuredHeight = 72;
  await act(async () => { resize.forEach(callback => callback()); });
  expect(inner.style.transition).toBe("transform 180ms ease-out");
  const transforms = vi.spyOn(inner.style, "transform", "set");
  await render(blocks, 18, false);
  expect(inner.style.transition).toBe("none");
  measuredHeight = 96;
  await act(async () => { resize.forEach(callback => callback()); });
  expect(transforms.mock.calls.map(([value]) => value)).toEqual(["translateY(0)", "translateY(0)"]);
  transforms.mockRestore();
});
