import { expect, it, vi } from "vitest";
import { TimelineScroll } from "./timelineScroll";

function fixture() {
  let top = 200;
  const older = { dataset: { utteranceId: "old" }, getBoundingClientRect: () => ({ top: -top, bottom: 160 - top }) };
  const latest = { dataset: { utteranceId: "last" }, getBoundingClientRect: () => ({ top: 160 - top, bottom: 300 - top }) };
  const scrollTo = vi.fn((options: ScrollToOptions) => { top = Math.max(0, Math.min(options.top ?? 0, 200)); });
  const element = { get scrollTop() { return top; }, set scrollTop(t: number) { top = t; }, scrollHeight: 300, clientHeight: 100, getBoundingClientRect: () => ({ top: 0 }), children: [older, latest], lastElementChild: latest, scrollTo } as unknown as HTMLElement;
  return { element, scrollTo, scroll: new TimelineScroll() };
}
it("keeps the mode sentence anchor after layout resize, then resumes tail-following for new content", () => {
  const { element, scroll } = fixture();
  scroll.displayChanged(element); expect(element.scrollTop).toBe(160);
  scroll.reflow(element); expect(element.scrollTop).toBe(160);
  scroll.contentChanged(element, "instant"); expect(element.scrollTop).toBe(200);
});
it("keeps a reader on their sentence through reflow and resumes following only after returning to the tail", () => {
  const { element, scroll, scrollTo } = fixture();
  scroll.userIntent(element); element.scrollTop = 30; scroll.scrolled(element);
  scroll.reflow(element); expect(element.scrollTop).toBe(30);
  scroll.contentChanged(element, "smooth"); expect(element.scrollTop).toBe(30);
  scroll.userIntent(element); element.scrollTop = 200; scroll.scrolled(element);
  scroll.contentChanged(element, "smooth"); expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "smooth" });
});
it("ignores programmatic scroll events while revealing the bilingual original", () => {
  const { element, scroll } = fixture();
  scroll.displayChanged(element); scroll.scrolled(element);
  scroll.contentChanged(element, "instant"); expect(element.scrollTop).toBe(200);
});

it("does not stop following merely because someone clicks or selects text without scrolling", () => {
  const { element, scroll, scrollTo } = fixture();
  scroll.userIntent(element);
  scroll.contentChanged(element, "smooth");
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "smooth" });
});

it("reveals the same read sentence when removing a lane makes its previous offset exceed the new height", () => {
  const { element, scroll } = fixture();
  scroll.userIntent(element); element.scrollTop = 30; scroll.scrolled(element);
  const older = element.children[0] as HTMLElement;
  older.getBoundingClientRect = () => ({ top: -element.scrollTop, bottom: 20 - element.scrollTop } as DOMRect);
  scroll.displayChanged(element);
  expect(element.scrollTop).toBe(0);
});
