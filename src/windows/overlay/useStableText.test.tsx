// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subtitleStreamKey, useStableText } from "./animation";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface PairProps {
  id?: string;
  committedAt?: number;
  source?: string;
  translation?: string;
  final?: boolean;
}
function Pair({ id, committedAt = 1, source = "Old source", translation = "旧译文", final = false }: PairProps) {
  const sourceText = useStableText(source, final ? 0 : 180, 750, subtitleStreamKey("bilingual", "source", id, committedAt));
  const translationText = useStableText(translation, final ? 0 : 400, 1500, subtitleStreamKey("bilingual", "translation", id, committedAt));
  return <><span data-lane="source">{sourceText}</span><span data-lane="translation">{translationText}</span></>;
}
async function render(props: PairProps) {
  await act(async () => root.render(<Pair {...props} />));
}
function texts() {
  return Array.from(host.children).map(lane => lane.textContent);
}

it("resets both lanes together when a coalesced snapshot replaces their utterance stamps", async () => {
  await render({ id: "old" });
  await render({ id: "new", source: "New source", translation: "新译文" });
  expect(texts()).toEqual(["New source", "新译文"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  // The shorter source timer must not leave a new original beside the old
  // translation until the independent 400ms translation timer completes.
  expect(texts()).toEqual(["New source", "新译文"]);
});

it("resets unstamped previews when the previous sentence is confirmed in the same snapshot", async () => {
  await render({ committedAt: 1 });
  await render({ committedAt: 2, source: "Next original", translation: "下一句译文" });
  expect(texts()).toEqual(["Next original", "下一句译文"]);
});

it("keeps the independent settling delays for updates within one stamped utterance", async () => {
  await render({ id: "same" });
  await render({ id: "same", committedAt: 2, source: "Same source grows", translation: "同句译文增加" });
  expect(texts()).toEqual(["Old source", "旧译文"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(texts()).toEqual(["Same source grows", "旧译文"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(220); });
  expect(texts()).toEqual(["Same source grows", "同句译文增加"]);
});

it("still clears removed previews and accepts final text immediately", async () => {
  await render({ id: "same" });
  await render({ id: "same", source: "Confirmed source", translation: "最终译文", final: true });
  expect(texts()).toEqual(["Confirmed source", "最终译文"]);
  await render({ id: "same", source: "", translation: "" });
  expect(texts()).toEqual(["", ""]);
});
