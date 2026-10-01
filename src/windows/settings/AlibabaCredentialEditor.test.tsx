// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import { diagnosticCopy } from "../../lib/connectionDiagnostics";
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
afterEach(async () => { await act(() => root.unmount()); host.remove(); setStoredUiLanguage("en"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(next = props) { props = next; await act(() => root.render(<AlibabaCredentialEditor {...props} />)); }
async function change(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(selector)!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function picker() { return host.querySelector<HTMLButtonElement>('[role="combobox"]')!; }
async function expandAdvanced() {
  await act(() => {
    const advanced = host.querySelector("details")!;
    advanced.open = true;
    advanced.dispatchEvent(new Event("toggle"));
  });
}
async function chooseTranslation(value: "followService" | "deepL" | "deepLX") {
  await expandAdvanced();
  await act(() => picker().click());
  const label = value === "deepLX" ? I18N.settings.textTranslationCustom : value === "deepL" ? "DeepL" : I18N.settings.textTranslationFollow;
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)!;
  await act(() => option.click());
}
async function key(value: string) {
  await act(() => picker().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }

it("keeps normal first-time setup to one key and a collapsed default translation setting", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "missing" } });
  expect(host.querySelector("details")!.open).toBe(false);
  expect(host.querySelectorAll("input")).toHaveLength(1);
  expect(host.querySelector("select")).toBeNull();
  expect(picker().textContent).toBe(I18N.settings.textTranslationFollow);
  expect(host.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
  await change("input", "synthetic-asr"); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "synthetic-asr", textTranslation: "followService", endpoint: "", token: "" });
});

it("configures only the advanced text destination while reusing a saved key", async () => {
  await render();
  await chooseTranslation("deepLX");
  expect(host.textContent).toContain(I18N.settings.deepLXChain);
  expect(host.querySelector('input[id="test-apiKey"]')).toBeNull();
  await change("#test-endpoint", "https://example.com/translate"); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "", textTranslation: "deepLX", endpoint: "https://example.com/translate", token: "" });
});

it("retains invalid input and focuses the adjacent error before any credential call", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "missing" } });
  await change("input", "synthetic-asr"); await chooseTranslation("deepLX"); await change("#test-endpoint", "bad"); await submit();
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
  expect(picker().textContent).toBe(I18N.settings.textTranslationCustom);
  expect(host.textContent).toContain(I18N.settings.deepLXChain);
  expect(host.querySelector('input[type="password"]')?.getAttribute("id")).toBe("test-token");
  expect(host.querySelector<HTMLInputElement>("#test-endpoint")!.placeholder).toBe(I18N.settings.savedServiceAddressPlaceholder);
  await chooseTranslation("followService"); await submit();
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
  expect([...host.querySelectorAll<HTMLInputElement>("input")].every((node) => node.disabled)).toBe(true);
  expect(picker().disabled).toBe(true);
});

it("uses the unified picker with keyboard selection without submitting the form", async () => {
  await render();
  await expandAdvanced();
  expect(picker().getAttribute("aria-label")).toBe(I18N.settings.textTranslationLabel);
  await key("Enter"); await key("End"); await key("Enter");
  expect(picker().textContent).toBe(I18N.settings.textTranslationCustom);
  expect(document.activeElement).toBe(picker());
  expect(props.onSave).not.toHaveBeenCalled();
  expect(host.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
});

it("follows externally updated saved destinations while the picker is open", async () => {
  await render(); await expandAdvanced();
  await act(() => picker().click());
  await render({ ...props, profile: { ...profile, textTranslation: "deepLX" } });
  expect(picker().textContent).toBe(I18N.settings.textTranslationCustom);
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe(I18N.settings.textTranslationCustom);
  await key("Enter");
  expect(picker().textContent).toBe(I18N.settings.textTranslationCustom);
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(props.onSave).not.toHaveBeenCalled();
});

it("configures the official DeepL destination with a key and no address field", async () => {
  await render(); await chooseTranslation("deepL");
  expect(picker().textContent).toBe("DeepL");
  expect(host.querySelector("#test-endpoint")).toBeNull();
  expect(host.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
  expect(host.textContent).toContain(I18N.settings.deepLApiKey);
  await change("#test-token", " synthetic-deepl-key "); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "", textTranslation: "deepL", endpoint: "", token: "synthetic-deepl-key" });
});

it("clears destination secrets when switching between DeepL and a custom service", async () => {
  await render(); await chooseTranslation("deepL");
  await change("#test-token", "synthetic-deepl-key");
  await chooseTranslation("deepLX");
  expect(host.querySelector<HTMLInputElement>("#test-token")!.value).toBe("");
  await change("#test-endpoint", "https://example.com/translate");
  await change("#test-token", "synthetic-custom-token");
  await chooseTranslation("deepL");
  expect(host.querySelector("#test-endpoint")).toBeNull();
  expect(host.querySelector<HTMLInputElement>("#test-token")!.value).toBe("");
  expect(host.querySelector('button[type="submit"]')!.hasAttribute("disabled")).toBe(true);
  expect(props.onSave).not.toHaveBeenCalled();
});

it("keeps a saved DeepL key write-only and permits replacing only the Alibaba key", async () => {
  await render({ ...props, profile: { ...profile, textTranslation: "deepL" } });
  expect(host.querySelector("#test-endpoint")).toBeNull();
  expect(host.querySelector<HTMLInputElement>("#test-token")!.value).toBe("");
  expect(host.querySelector<HTMLInputElement>("#test-token")!.placeholder).toBe(I18N.settings.savedTranslationKeyPlaceholder);
  const replace = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === I18N.settings.replaceCredentials)!;
  await act(() => replace.click()); await change("#test-apiKey", "synthetic-new-asr"); await submit();
  expect(props.onSave).toHaveBeenCalledWith({ kind: "alibabaTranslation", apiKey: "synthetic-new-asr", textTranslation: "deepL", endpoint: "", token: "" });
});

it("does not carry a DeepL key draft into an externally selected custom destination", async () => {
  await render({ ...props, profile: { ...profile, textTranslation: "deepL" } });
  await change("#test-token", "synthetic-deepl-key");
  await render({ ...props, profile: { ...profile, textTranslation: "deepLX" } });
  expect(picker().textContent).toBe(I18N.settings.textTranslationCustom);
  expect(host.querySelector<HTMLInputElement>("#test-token")!.value).toBe("");
  expect(host.querySelector<HTMLInputElement>("#test-endpoint")!.value).toBe("");
  expect(props.onSave).not.toHaveBeenCalled();
});

it("uses platform-aware Linux guidance for unavailable storage in each language", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla Linux");
  for (const language of ["en", "zh", "ja"] as const) {
    setStoredUiLanguage(language);
    await render({ ...props, profile: { ...profile, credentialState: "unavailable" } });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(diagnosticCopy("linux").storage);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("GNOME Keyring");
  }
});

it("discards the write-only draft after a successful save", async () => {
  await render({ ...props, profile: { ...profile, credentialState: "unavailable" }, onSave: vi.fn().mockResolvedValue({}) });
  await change("input", "synthetic-asr"); await submit();
  expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
});
