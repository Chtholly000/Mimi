// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import type { SubtitleBlock } from "./overlayModel";

const originalScrollTo = HTMLElement.prototype.scrollTo;
let root: Root, host: HTMLDivElement;
let timeline: HTMLDivElement;
let scrollTop = 0, scrollHeight = 200;
const scrollTo = vi.fn((options: ScrollToOptions) => { scrollTop = Math.min(options.top ?? 0, scrollHeight - 80); });
const blocks: SubtitleBlock[] = [
  { id: "old", createdAt: 1, presentation: "history", source: "Older source", translation: "较早译文" },
  { id: "latest", createdAt: 2, presentation: "latestCommitted", source: "Current source", translation: "当前译文" },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  scrollTop = 0; scrollHeight = 200; scrollTo.mockClear();
  HTMLElement.prototype.scrollTo = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); HTMLElement.prototype.scrollTo = originalScrollTo; vi.unstubAllGlobals(); });
async function render(mode: "translation" | "bilingual", list = blocks) {
  await act(async () => root.render(<Timeline blocks={list.map(b => mode === "translation" ? { ...b, source: null } : b)} displayMode={mode} fontSize={18} alignment="center" color="white" motionEnabled={true} />));
}
async function mount() {
  await render("translation"); timeline = host.firstElementChild as HTMLDivElement;
  Object.defineProperties(timeline, { scrollHeight: { get: () => scrollHeight }, clientHeight: { get: () => 80 }, scrollTop: { get: () => scrollTop, set: (top: number) => { scrollTop = Math.min(top, scrollHeight - 80); } } });
  timeline.scrollTo = scrollTo as HTMLElement["scrollTo"];
  timeline.getBoundingClientRect = () => ({ top: 0, bottom: 80 } as DOMRect);
  for (const child of Array.from(timeline.children)) {
    const index = Array.from(timeline.children).indexOf(child);
    child.getBoundingClientRect = () => ({ top: (index === 0 ? 0 : 220) - scrollTop, bottom: (index === 0 ? 220 : scrollHeight) - scrollTop } as DOMRect);
  }
  // Equivalent to the existing resize pin after the initial native layout.
  scrollTop = 120;
}
it("switches to bilingual at the latest sentence's start rather than hiding its original at the old bottom", async () => {
  await mount(); scrollHeight = 320;
  await render("bilingual");
  expect(scrollTop).toBe(220); // source and actual translated line fit; unused compact budget extends below
});
it("continues following a growing live tail after a display change", async () => {
  await mount(); scrollHeight = 320; await render("bilingual");
  scrollHeight = 350; await render("bilingual", [blocks[0], { ...blocks[1], translation: "当前译文继续流入" }]);
  expect(scrollTop).toBe(270);
});
it("does not pull a user reading history to the tail on a mode change or incoming text", async () => {
  await mount();
  await act(async () => { timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 })); scrollTop = 30; timeline.dispatchEvent(new Event("scroll", { bubbles: true })); });
  scrollHeight = 320; await render("bilingual"); expect(scrollTop).toBe(30);
  scrollHeight = 350; await render("bilingual", [blocks[0], { ...blocks[1], translation: "新译文" }]); expect(scrollTop).toBe(30);
});
