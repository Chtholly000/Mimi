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
let observers: Array<{ targets: Set<Element>; resized: () => void }>;
function resizeRow(element: Element) { for (const observer of observers) if (observer.targets.has(element)) observer.resized(); }
const scrollTo = vi.fn((options: ScrollToOptions) => { scrollTop = Math.min(options.top ?? 0, scrollHeight - 80); });
const blocks: SubtitleBlock[] = [
  { id: "old", createdAt: 1, presentation: "history", source: "Older source", translation: "较早译文" },
  { id: "latest", createdAt: 2, presentation: "latestCommitted", source: "Current source", translation: "当前译文" },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers = [];
  vi.stubGlobal("ResizeObserver", class {
    private targets = new Set<Element>();
    constructor(resized: () => void) { observers.push({ targets: this.targets, resized }); }
    observe(element: Element) { this.targets.add(element); }
    disconnect() { this.targets.clear(); }
  });
  scrollTop = 0; scrollHeight = 200; scrollTo.mockClear();
  HTMLElement.prototype.scrollTo = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); HTMLElement.prototype.scrollTo = originalScrollTo; vi.unstubAllGlobals(); });
async function render(mode: "original" | "translation" | "bilingual", list = blocks, followTailRequest = 0, onReadingHistoryChange?: (reading: boolean) => void) {
  await act(async () => root.render(<Timeline blocks={list.map(b => mode === "translation" ? { ...b, source: null } : mode === "original" ? { ...b, translation: null } : b)} displayMode={mode} fontSize={18} alignment="center" color="white" motionEnabled={true}
    followTailRequest={followTailRequest} onReadingHistoryChange={onReadingHistoryChange} />));
}
async function mount(list = blocks) {
  await render("translation", list); timeline = host.firstElementChild as HTMLDivElement;
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

it("keeps a live reader's position through equal-length rewraps, growth, modes and confirmation without following the tail", async () => {
  const live: SubtitleBlock = { id: "live", createdAt: null, presentation: "live", streaming: true,
    source: "Long synthetic original. ".repeat(20), translation: "Long synthetic translation. ".repeat(20) };
  await mount([live]);
  const reading = vi.fn();
  await render("translation", [live], 0, reading);
  const row = timeline.firstElementChild!;
  row.getBoundingClientRect = () => ({ top: -scrollTop, bottom: scrollHeight - scrollTop } as DOMRect);
  scrollTop = 30;
  await act(async () => timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -30 })));
  expect(reading).toHaveBeenLastCalledWith(true);
  expect(row.querySelector("[aria-label]")).toBeNull();

  scrollTo.mockClear(); scrollHeight = 350;
  const corrected = { ...live, translation: live.translation!.replaceAll("Long", "Wide") };
  expect(corrected.translation.length).toBe(live.translation!.length);
  await render("translation", [corrected], 0, reading);
  await act(async () => resizeRow(row));
  expect(scrollTop).toBe(30); // A same-length rewrap restores the read anchor instead of following the tail.
  expect(row.textContent).toContain(corrected.translation);

  const growing = { ...corrected, source: `${live.source}New raw recognition.`, translation: `${corrected.translation}New complete translation.` };
  scrollHeight = 400;
  for (const mode of ["bilingual", "original", "translation"] as const) {
    await render(mode, [growing], 0, reading);
    expect(timeline.firstElementChild).toBe(row);
    expect(scrollTop).toBe(30);
    expect(reading).toHaveBeenLastCalledWith(true);
    expect(row.querySelector("[aria-label]")).toBeNull();
  }

  scrollTo.mockClear();
  await render("translation", [{ ...growing, id: "history-2", createdAt: 2, presentation: "latestCommitted", streaming: undefined }], 0, reading);
  expect(scrollTop).toBe(30);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(reading).toHaveBeenLastCalledWith(true);
  expect(timeline.querySelector("[aria-label]")).toBeNull();
  await render("translation", [{ ...growing, id: "history-2", createdAt: 2, presentation: "latestCommitted", streaming: undefined }], 1, reading);
  expect(scrollTop).toBe(320);
  expect(reading).toHaveBeenLastCalledWith(false);
  expect(timeline.querySelector("[aria-label]")).not.toBeNull();
});

it("keeps return-to-live intent through later compact row growth, shrink and replacement while preserving a reader on resize", async () => {
  await mount();
  await act(async () => {
    timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -30 }));
    scrollTop = 30; timeline.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  scrollHeight = 320;
  await render("bilingual", blocks, 1);
  expect(scrollTop).toBe(240);

  // Compact lanes initially use their budget. Actual inner measurement can
  // then transfer height between languages without changing the viewport or text.
  scrollHeight = 390;
  await act(async () => resizeRow(timeline.lastElementChild!));
  expect(scrollTop).toBe(310);
  scrollHeight = 260;
  await act(async () => resizeRow(timeline.firstElementChild!));
  expect(scrollTop).toBe(180);

  const replacement = { ...blocks[1], id: "final-next" };
  await render("bilingual", [blocks[0], replacement], 1);
  scrollHeight = 350;
  await act(async () => resizeRow(timeline.lastElementChild!));
  expect(scrollTop).toBe(270);

  await act(async () => {
    timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -30 }));
    scrollTop = 30; timeline.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  scrollHeight = 440;
  await act(async () => resizeRow(timeline.firstElementChild!));
  expect(scrollTop).toBe(30); // Content resize restores the same reading anchor, not the tail.
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

it("returns to the live tail only on a new explicit request and reports subsequent reading intent", async () => {
  await mount();
  const reading = vi.fn();
  await render("translation", blocks, 0, reading);
  expect(reading).toHaveBeenLastCalledWith(false);
  await act(async () => {
    timeline.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
    scrollTop = 30; timeline.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(reading).toHaveBeenLastCalledWith(true);
  scrollHeight = 320;
  await render("bilingual", blocks, 0, reading);
  expect(scrollTop).toBe(30);
  expect(reading).toHaveBeenLastCalledWith(true);

  await render("bilingual", blocks, 1, reading);
  expect(scrollTop).toBe(240);
  expect(reading).toHaveBeenLastCalledWith(false);
  expect(timeline.querySelector("[aria-label]")).not.toBeNull();
  scrollHeight = 350;
  await render("bilingual", [blocks[0], { ...blocks[1], translation: "新的译文继续流入" }], 1, reading);
  expect(scrollTop).toBe(270);

  await act(async () => timeline.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
  expect(reading).toHaveBeenLastCalledWith(true);
  await render("bilingual", blocks, 1, reading);
  expect(reading).toHaveBeenLastCalledWith(true); // Re-rendering the request is not another command.
});
