// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Select } from "./Select";

const options = [
  { value: "translation", label: "仅译文" },
  { value: "bilingual", label: "双语" },
  { value: "original", label: "仅原文" },
];
let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  onChange.mockReset();
  vi.unstubAllGlobals();
});
async function render(value: string) {
  await act(() => root.render(<Select label="字幕显示" value={value} options={options} onChange={onChange} />));
}
function trigger() { return host.querySelector<HTMLButtonElement>('[role="combobox"]')!; }

it("updates the visible label on an external value change without losing trigger focus", async () => {
  await render("translation");
  const button = trigger();
  button.focus();
  for (const value of ["bilingual", "original", "translation", "bilingual"]) {
    await render(value);
    expect(button.textContent).toBe(options.find(option => option.value === value)!.label);
    expect(trigger()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(onChange).not.toHaveBeenCalled();
  }
});

it("follows an external value while the menu is open, including its keyboard choice", async () => {
  await render("translation");
  await act(() => trigger().click());
  await render("bilingual");
  const selected = document.querySelector('[role="option"][aria-selected="true"]')!;
  expect(selected.textContent).toBe("双语");
  expect(trigger().getAttribute("aria-activedescendant")).toBe(selected.id);
  await act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("original");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
