// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N } from "../../lib/i18n";
import type { ServiceProfile } from "../../lib/types";
import { AlibabaCredentialEditor } from "./AlibabaCredentialEditor";

let root: Root;
let host: HTMLDivElement;
let props: Parameters<typeof AlibabaCredentialEditor>[0];
const profile: ServiceProfile = { id: "synthetic", name: "Alibaba", provider: "alibabaCloud", credentialState: "present" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("scrollIntoView", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { profile, inputId: "test", disabled: false, busy: false, feedback: null, onSave: vi.fn().mockResolvedValue(null), onRequestDelete: vi.fn(), onConfirmDelete: vi.fn(), confirmingDelete: false, onCancelDelete: vi.fn() };
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(next = props) { props = next; await act(() => root.render(<AlibabaCredentialEditor {...props} />)); }
async function change(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  await act(() => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }

it("keeps normal first-time setup to one key and a collapsed default translation setting", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "missing" } });
  expect(host.querySelector("details")!.open).toBe(false);
  expect(host.querySelectorAll("input")).toHaveLength(1);
  expect(host.querySelector("select")!.value).toBe("followService");
  expect(host.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
  await change("input", "synthetic-asr"); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "synthetic-asr", textTranslation: "followService", endpoint: "", token: "" });
});

it("configures only the advanced text destination while reusing a saved key", async () => {
  await render();
  await change("select", "deepLX");
  expect(host.textContent).toContain(I18N.settings.deepLXChain);
  expect(host.querySelector('input[id="test-apiKey"]')).toBeNull();
  await change("#test-endpoint", "https://example.com/translate"); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "", textTranslation: "deepLX", endpoint: "https://example.com/translate", token: "" });
});

it("retains invalid input and focuses the adjacent error before any credential call", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "missing" } });
  await change("input", "synthetic-asr"); await change("select", "deepLX"); await change("#test-endpoint", "bad"); await submit();
  expect(props.onSave).not.toHaveBeenCalled();
  expect((host.querySelector("#test-apiKey") as HTMLInputElement).value).toBe("synthetic-asr");
  expect((host.querySelector("#test-endpoint") as HTMLInputElement).value).toBe("bad");
  expect(document.activeElement?.id).toBe("test-endpoint");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(I18N.settings.deepLXEndpointInvalid);
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  await change("#test-endpoint", "http://localhost:1188");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("preserves an unsaved key when saving succeeds but activation fails", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "missing" } });
  await change("input", "synthetic-asr"); await submit();
  await render({ ...props, profile });
  expect((host.querySelector("#test-apiKey") as HTMLInputElement).value).toBe("synthetic-asr");
});

it("retains the historical DeepLX route and switches back without repeating the key", async () => {
  await render({ ...props, profile: { ...profile, provider: "deepLX" } });
  expect(host.querySelector("select")!.value).toBe("deepLX");
  expect(host.textContent).toContain(I18N.settings.deepLXChain);
  expect(host.querySelector('input[type="password"]')?.getAttribute("id")).toBe("test-token");
  await change("select", "followService"); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "", textTranslation: "followService", endpoint: "", token: "" });
});

it("clears drafts before confirmed deletion and respects an active-session lock", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "missing" } });
  await change("input", "synthetic-asr");
  await render({ ...props, confirmingDelete: true });
  const buttons = [...host.querySelectorAll("button")];
  await act(async () => buttons.find((button) => button.textContent === I18N.settings.confirmDelete)!.click());
  expect(props.onConfirmDelete).toHaveBeenCalledOnce();
  expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
  await render({ ...props, disabled: true });
  expect([...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].every((node) => node.disabled)).toBe(true);
});
