// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { DestructiveConfirmation, SettingsConfirmation, type SettingsConfirmationProps } from "./DestructiveConfirmation";

let host: HTMLDivElement, root: Root;
let extras: HTMLElement[];
const actions = { onCancel: vi.fn(), onConfirm: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setStoredUiLanguage("en");
  actions.onCancel.mockReset(); actions.onConfirm.mockReset();
  host = document.createElement("div");
  host.className = "settings-console settings-console--light";
  document.body.append(host);
  root = createRoot(host);
  extras = [];
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove(); extras.forEach(element => element.remove());
  document.body.style.overflow = "";
  setStoredUiLanguage("en");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function render(props: Partial<SettingsConfirmationProps> = {}) {
  await act(() => root.render(<SettingsConfirmation message="Delete this configuration?" {...actions} {...props} />));
}
function modal() { return document.querySelector<HTMLDivElement>(".settings-confirmation")!; }
function cancel() { return modal().querySelector<HTMLButtonElement>(".settings-confirmation__cancel")!; }
function confirm() { return modal().querySelector<HTMLButtonElement>(".settings-confirmation__confirm")!; }
async function key(value: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  await act(() => document.activeElement!.dispatchEvent(event));
  return event;
}

it("opens a real body modal, focuses Cancel, and retains the destructive confirmation defaults", async () => {
  await act(() => root.render(<DestructiveConfirmation message="Delete this configuration?" disabled={false} {...actions} />));
  expect(host.querySelector(".settings-confirmation")).toBeNull();
  expect(modal().parentElement?.parentElement).toBe(document.body);
  expect(modal().getAttribute("role")).toBe("alertdialog");
  expect(modal().getAttribute("aria-modal")).toBe("true");
  expect(document.getElementById(modal().getAttribute("aria-labelledby")!)?.textContent).toBe("Delete this configuration?");
  expect(modal().querySelector("small")).toBeNull();
  expect(confirm().textContent).toBe(I18N.settings.confirmDelete);
  expect(confirm().classList.contains("settings-confirmation__confirm--danger")).toBe(true);
  expect(confirm().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(cancel());
  expect([...modal().querySelectorAll("button")].every(button => button.type === "button")).toBe(true);
  await act(() => confirm().click());
  expect(actions.onConfirm).toHaveBeenCalledOnce();
});

it("shares the modal with normal Add confirmation content, icon, and label", async () => {
  await render({ variant: "default", confirmLabel: "Add service", confirmIcon: "plus", children: <div className="provider-picker__preview"><h3>Selected service</h3></div> });
  expect(modal().getAttribute("role")).toBe("dialog");
  expect(confirm().textContent).toBe("Add service");
  expect(confirm().classList.contains("settings-confirmation__confirm--default")).toBe(true);
  expect(confirm().querySelector(".lucide-plus")).not.toBeNull();
  expect(modal().querySelector(".provider-picker__preview h3")?.textContent).toBe("Selected service");
});

it("shows a single Close action for read-only content and preserves Escape and focus restoration", async () => {
  const previous = document.createElement("button"); extras.push(previous); document.body.append(previous);
  previous.focus();
  await render({ variant: "default", hideConfirm: true, cancelLabel: "Close", children: <pre>mimi --toggle</pre> });
  expect(modal().getAttribute("role")).toBe("dialog");
  expect(modal().querySelectorAll("button")).toHaveLength(1);
  expect(modal().querySelector(".settings-confirmation__confirm")).toBeNull();
  expect(cancel().textContent).toBe("Close");
  expect(document.activeElement).toBe(cancel());
  await key("Tab"); expect(document.activeElement).toBe(cancel());
  await key("Tab", true); expect(document.activeElement).toBe(cancel());
  await key("Escape");
  expect(actions.onCancel).toHaveBeenCalledOnce();
  expect(actions.onConfirm).not.toHaveBeenCalled();
  await act(() => root.render(null));
  expect(document.activeElement).toBe(previous);
});

it("traps keyboard and programmatic focus within the modal, including optional body controls", async () => {
  const outside = document.createElement("button"); extras.push(outside); document.body.append(outside);
  await render({ children: <button type="button" className="body-help">Requirements</button> });
  const help = modal().querySelector<HTMLButtonElement>(".body-help")!;
  expect(document.activeElement).toBe(cancel());
  expect((await key("Tab")).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(confirm());
  await key("Tab"); expect(document.activeElement).toBe(help);
  await key("Tab"); expect(document.activeElement).toBe(cancel());
  await key("Tab", true); expect(document.activeElement).toBe(help);
  outside.focus(); expect(document.activeElement).toBe(cancel());
  expect((await key("Escape")).defaultPrevented).toBe(true);
  expect(actions.onCancel).toHaveBeenCalledOnce();
  expect(actions.onConfirm).not.toHaveBeenCalled();
});

it("keeps confirmation disabled while Cancel and Escape remain available", async () => {
  await render({ disabled: true });
  expect(confirm().disabled).toBe(true);
  expect(cancel().disabled).toBe(false);
  expect(document.activeElement).toBe(cancel());
  await act(() => confirm().click());
  expect(actions.onConfirm).not.toHaveBeenCalled();
  await key("Tab"); expect(document.activeElement).toBe(cancel());
  await key("Escape"); expect(actions.onCancel).toHaveBeenCalledOnce();
});

it("blocks background interaction and restores prior focus, inert attributes, accessibility, and scroll", async () => {
  const previous = document.createElement("button"); extras.push(previous); document.body.append(previous);
  const outsideClick = vi.fn(); previous.addEventListener("click", outsideClick);
  const alreadyInert = document.createElement("div"); extras.push(alreadyInert);
  alreadyInert.setAttribute("inert", "existing"); alreadyInert.setAttribute("aria-hidden", "false");
  document.body.append(alreadyInert);
  host.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "scroll";
  previous.focus();
  await render();
  expect(host.hasAttribute("inert")).toBe(true);
  expect(host.getAttribute("aria-hidden")).toBe("true");
  expect(document.body.style.overflow).toBe("hidden");
  previous.click(); expect(outsideClick).not.toHaveBeenCalled();
  const addedBackground = document.createElement("button"); extras.push(addedBackground);
  await act(() => document.body.append(addedBackground));
  expect(addedBackground.hasAttribute("inert")).toBe(true);
  await act(() => root.render(null));
  expect(document.querySelector(".settings-confirmation-backdrop")).toBeNull();
  expect(host.hasAttribute("inert")).toBe(false);
  expect(host.getAttribute("aria-hidden")).toBe("false");
  expect(alreadyInert.getAttribute("inert")).toBe("existing");
  expect(alreadyInert.getAttribute("aria-hidden")).toBe("false");
  expect(addedBackground.hasAttribute("inert")).toBe(false);
  expect(document.body.style.overflow).toBe("scroll");
  expect(document.activeElement).toBe(previous);
  previous.click(); expect(outsideClick).toHaveBeenCalledOnce();
});

it("copies the surrounding settings theme and keeps modal help portals accessible", async () => {
  host.style.setProperty("--settings-text", "#171717");
  host.style.setProperty("--settings-panel-raised", "#f5f5f5");
  host.style.setProperty("--provider-light-display", "block");
  host.style.setProperty("--settings-text-faint", "#777777");
  host.style.setProperty("--settings-border", "#dddddd");
  host.style.setProperty("--settings-danger", "#b42318");
  await render({ children: <button type="button" aria-describedby="modal-tooltip">Requirements</button> });
  const backdrop = modal().parentElement!;
  expect(backdrop.style.getPropertyValue("--settings-text")).toBe("#171717");
  expect(backdrop.style.getPropertyValue("--settings-panel-raised")).toBe("#f5f5f5");
  expect(backdrop.style.getPropertyValue("--provider-light-display")).toBe("block");
  expect(backdrop.style.getPropertyValue("--settings-text-faint")).toBe("#777777");
  expect(backdrop.style.getPropertyValue("--settings-border")).toBe("#dddddd");
  expect(backdrop.style.getPropertyValue("--settings-danger")).toBe("#b42318");
  const tooltip = document.createElement("div"); extras.push(tooltip);
  tooltip.id = "modal-tooltip"; tooltip.setAttribute("role", "tooltip");
  await act(() => document.body.append(tooltip));
  expect(tooltip.hasAttribute("inert")).toBe(false);
  expect(tooltip.hasAttribute("aria-hidden")).toBe(false);
  await act(() => host.style.setProperty("--settings-text", "#f4f4f4"));
  expect(backdrop.style.getPropertyValue("--settings-text")).toBe("#f4f4f4");
});

it("keeps SettingsHelp tooltips available when their persistent description supplies accessibility", async () => {
  await render({ children: <span className="settings-help-control"><button type="button">Requirements</button><span className="settings-help-control__description">Protocol requirements</span></span> });
  const tooltip = document.createElement("div"); extras.push(tooltip);
  tooltip.id = "separate-tooltip"; tooltip.setAttribute("role", "tooltip"); tooltip.textContent = "Protocol requirements";
  await act(() => document.body.append(tooltip));
  expect(tooltip.hasAttribute("inert")).toBe(false);
  expect(tooltip.hasAttribute("aria-hidden")).toBe(false);
});

it("uses the latest cancel handler without remounting or resetting focus", async () => {
  const latest = vi.fn();
  await render(); confirm().focus();
  await render({ onCancel: latest });
  expect(document.activeElement).toBe(confirm());
  await key("Escape");
  expect(latest).toHaveBeenCalledOnce();
  expect(actions.onCancel).not.toHaveBeenCalled();
});

it("does not submit a surrounding settings form when confirming", async () => {
  const submit = vi.fn();
  await act(() => root.render(<form onSubmit={submit}><SettingsConfirmation message="Delete?" {...actions} /></form>));
  await act(() => confirm().click());
  expect(actions.onConfirm).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});
