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

async function render(blocks: SubtitleBlock[], fontSize = 18, motionEnabled = false, showSubtitleDividers = false) {
  await act(async () => root.render(<Timeline blocks={blocks} fontSize={fontSize} alignment="center" color="white" displayMode="bilingual" motionEnabled={motionEnabled} showSubtitleDividers={showSubtitleDividers} />));
  return host.firstElementChild as HTMLDivElement;
}

it("keeps full confirmed history open when sentence dividers are toggled", async () => {
  measuredHeight = 240;
  const blocks = [{ ...confirmed, presentation: "history" as const }, live];
  const timeline = await render(blocks, 18, false, true);
  await act(async () => timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -30 })));
  const read = timeline.querySelector<HTMLElement>('[data-utterance-id="confirmed"]')!;
  expect(read.querySelector("[aria-label]")).toBeNull();
  expect(timeline.querySelector(".subtitle-separator")).not.toBeNull();
  await render(blocks, 18, false, false);
  expect(timeline.querySelector('[data-utterance-id="confirmed"]')).toBe(read);
  expect(read.querySelector("[aria-label]")).toBeNull();
  expect(read.textContent).toContain(confirmed.source);
  expect(read.textContent).toContain(confirmed.translation);
  expect(timeline.querySelector(".subtitle-separator")).toBeNull();
});

it("uses only the actual line height for a short translation, then bounds later growth", async () => {
  const timeline = await render([{ ...confirmed, source: null, translation: "短句" }]);
  let viewport = timeline.querySelector<HTMLElement>('[aria-label="短句"]')!;
  expect(viewport.style.height).toBe("24px"); // Two reserved lines would waste another 24px.
  measuredHeight = 240;
  await act(async () => { resize.forEach(callback => callback()); });
  viewport = timeline.querySelector<HTMLElement>('[aria-label="短句"]')!;
  expect(viewport.style.height).toBe("72px");
  expect(viewport.firstElementChild?.textContent).toBe("短句");
});

it.each(["Wait... really?", "等等……真的吗？", "待って…本当？", "잠깐... 정말?"])("keeps plain %s text and measured lane heights stable as streaming settles", async (source) => {
  // Model a phrase at the wrapping edge: an extra inline element would take
  // another visual line. The body's only child must remain its text node.
  HTMLElement.prototype.getBoundingClientRect = function () {
    const isBody = this.tagName === "SPAN" && this.parentElement?.hasAttribute("aria-label");
    const lineHeight = Math.round((Number.parseFloat(this.style.fontSize) || 18) * 1.32);
    const height = isBody ? lineHeight * (this.childElementCount > 0 ? 2 : 1) : 24;
    return { top: 0, bottom: height, height } as DOMRect;
  };
  for (const displayMode of ["original", "translation", "bilingual"] as const) {
    const block = { ...live, source, translation: "Plain translation..." };
    const mount = async (streaming?: true) => {
      await act(async () => root.render(<Timeline blocks={[{ ...block, streaming }]} fontSize={18}
        alignment="center" color="white" displayMode={displayMode} motionEnabled={false} />));
    };
    await mount(true);
    const lanes = Array.from(host.querySelectorAll<HTMLElement>("[aria-label]"));
    const initialHeights = lanes.map(lane => lane.style.height);
    for (const lane of lanes) {
      const body = lane.firstElementChild!;
      expect(body.children).toHaveLength(0);
      expect(body.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(body.textContent).toBe(lane.getAttribute("aria-label"));
      expect(Number.parseFloat(lane.style.height)).toBeLessThanOrEqual(24);
    }
    await mount();
    await act(async () => { resize.forEach(callback => callback()); });
    expect(Array.from(host.querySelectorAll<HTMLElement>("[aria-label]"))).toEqual(lanes);
    expect(lanes.map(lane => lane.style.height)).toEqual(initialHeights);
    await mount(true);
    await act(async () => { resize.forEach(callback => callback()); });
    expect(lanes.map(lane => lane.style.height)).toEqual(initialHeights);
    expect(host.querySelector(".stream-dots")).toBeNull();
  }
});

it("keeps genuine source ellipsis without adding a second marker or fading readable text", async () => {
  measuredHeight = 240;
  const source = "Genuine source... keeps going";
  const timeline = await render([{ ...confirmed, source, translation: null }]);
  const lane = timeline.querySelector<HTMLElement>(`[aria-label="${source}"]`)!;
  expect(lane.firstElementChild?.textContent).toBe(source);
  expect(lane.children).toHaveLength(1);
  expect(lane.style.maskImage).toBe("");
  expect(lane.querySelector(".stream-dots")).toBeNull();
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

it("keeps both previous bilingual lanes visible and restores full text on reading intent", async () => {
  measuredHeight = 240;
  const timeline = await render([{ ...confirmed, presentation: "history" }, live]);
  const previous = timeline.querySelector<HTMLElement>('[data-utterance-id="confirmed"]')!;
  const source = previous.querySelector<HTMLElement>(`[aria-label="${confirmed.source}"]`)!;
  const translation = previous.querySelector<HTMLElement>(`[aria-label="${confirmed.translation}"]`)!;
  expect(source.hidden).toBe(false);
  expect(source.getAttribute("aria-hidden")).toBeNull();
  expect(translation.style.height).toBe("24px");
  const newest = timeline.querySelector<HTMLElement>('[data-utterance-id="live"]')!;
  expect(newest.querySelector<HTMLElement>("[aria-label]")!.hidden).toBe(false);
  await act(async () => timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -30 })));
  expect(previous.querySelector("[aria-label]")).toBeNull();
  expect(previous.textContent).toContain(confirmed.source);
  expect(previous.textContent).toContain(confirmed.translation);
  await act(async () => timeline.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
  expect(previous.querySelector<HTMLElement>(`[aria-label="${confirmed.source}"]`)!.hidden).toBe(false);
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

it("fits both long bilingual lanes into the actual 51px body and uses added space after resize", async () => {
  measuredHeight = 240;
  viewportHeight = 51;
  const timeline = await render([confirmed], 20);
  const row = timeline.firstElementChild as HTMLElement;
  const lanes = Array.from(row.querySelectorAll<HTMLElement>("[aria-label]"));
  const laneHeights = lanes.map(lane => Number.parseFloat(lane.style.height));
  expect(laneHeights).toEqual([22, 27]);
  expect(laneHeights.reduce((sum, height) => sum + height, 0) + 1 + 1).toBeLessThanOrEqual(viewportHeight);
  expect(row.style.paddingTop).toBe("0px");
  viewportHeight = 130;
  await act(async () => { resize.forEach(callback => callback()); });
  expect(lanes[1].style.height).toBe("81px");
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

it.each([80, 81])("fits long original and short translation at the %ipx responsive boundary", async (height) => {
  viewportHeight = height;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.textContent === "短句" ? 27 : 240;
    return { top: 0, bottom: height, height } as DOMRect;
  };
  const timeline = await render([{ ...confirmed, translation: "短句" }], 20);
  const row = timeline.firstElementChild as HTMLElement;
  const lanes = Array.from(row.querySelectorAll<HTMLElement>("[aria-label]"));
  const textHeight = lanes.reduce((sum, lane) => sum + Number.parseFloat(lane.style.height), 0);
  expect(textHeight + 7).toBeLessThanOrEqual(viewportHeight);
  expect(lanes[0].style.height).toBe("44px");
});

it.each([83, 84, 85])("keeps the reference font stable as translation arrives and leaves at the %ipx boundary", async (height) => {
  viewportHeight = height;
  measuredHeight = 240;
  const waiting = { ...live, translation: null };
  const timeline = await render([waiting], 20);
  const original = timeline.querySelector<HTMLElement>(`[aria-label="${live.source}"]`)!;
  const text = original.firstElementChild as HTMLElement;
  const font = text.style.fontSize;
  const lineHeight = text.style.lineHeight;
  expect(font).toBe(height < 85 ? "16.4px" : "18px");

  await render([live], 20);
  expect(timeline.querySelector(`[aria-label="${live.source}"]`)).toBe(original);
  expect(original.firstElementChild).toBe(text);
  expect(text.style.fontSize).toBe(font);
  expect(text.style.lineHeight).toBe(lineHeight);
  const pairedLanes = Array.from(timeline.querySelectorAll<HTMLElement>("[aria-label]"));
  expect(pairedLanes.map(lane => lane.firstElementChild?.textContent)).toEqual([live.source, live.translation]);
  expect(pairedLanes.reduce((sum, lane) => sum + Number.parseFloat(lane.style.height), 0) + 7).toBeLessThanOrEqual(height);

  await render([waiting], 20);
  expect(original.firstElementChild).toBe(text);
  expect(text.style.fontSize).toBe(font);
  expect(text.style.lineHeight).toBe(lineHeight);
});

it("gives a bilingual translation the unused original lane's space before that original arrives", async () => {
  measuredHeight = 240;
  viewportHeight = 51;
  const timeline = await render([{ ...live, source: null }]);
  expect(timeline.querySelector<HTMLElement>("[aria-label]")?.style.height).toBe("48px");
});

it("rolls a newly clipped line up from its previous position without first opening a gap below the text", async () => {
  viewportHeight = 60;
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
  viewportHeight = 60;
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
