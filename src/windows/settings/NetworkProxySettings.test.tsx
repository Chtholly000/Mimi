// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18N, setStoredUiLanguage } from "../../lib/i18n";
import type { NetworkProxyConfig } from "../../lib/types";
import { NetworkProxySettings } from "./NetworkProxySettings";

let host: HTMLDivElement, root: Root;
const system: NetworkProxyConfig = { mode: "system", url: null };
const save = vi.fn<(config: NetworkProxyConfig) => Promise<void>>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  setStoredUiLanguage("en"); save.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount()); host.remove();
  setStoredUiLanguage("system"); vi.unstubAllGlobals();
});
async function render(value = system, disabled = false) { await act(() => root.render(<NetworkProxySettings value={value} disabled={disabled} onSave={save} />)); }
async function choose(value: string) {
  await act(() => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === value)!;
  expect(option).toBeTruthy(); await act(() => option.click());
}
async function address(value: string) {
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it.each(["zh", "en", "ja"] as const)("uses the unified selector and accurate system limitations in %s without auto saving or probing", async language => {
  setStoredUiLanguage(language); await render();
  expect(host.textContent).toContain(I18N.settings.networkProxyTitle);
  expect(host.querySelector('[role="combobox"]')?.textContent).toContain(I18N.settings.networkProxySystem);
  expect(host.textContent).toContain(I18N.settings.networkProxySystemHelp);
  expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector('button[type="submit"]')).toBeNull();
  await choose(I18N.settings.networkProxyCustom);
  expect(host.querySelector("input")?.getAttribute("autocomplete")).toBe("off");
  expect(host.textContent).toContain(I18N.settings.networkProxyCustomHelp);
  expect(save).not.toHaveBeenCalled();
});

it("saves the normalized custom route only on explicit submit and shows success", async () => {
  await render(); await choose(I18N.settings.networkProxyCustom); await address(" socks5h://127.0.0.1 "); await submit();
  expect(save).toHaveBeenCalledExactlyOnceWith({ mode: "custom", url: "socks5h://127.0.0.1:1080" });
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("socks5h://127.0.0.1:1080");
  expect(host.querySelector('[role="status"]')?.textContent).toContain(I18N.settings.networkProxySaved);
});

it("discards an old custom address when saving system/direct", async () => {
  await render({ mode: "custom", url: "http://127.0.0.1:7890/" });
  await choose(I18N.settings.networkProxyDirect); await submit();
  expect(save).toHaveBeenCalledExactlyOnceWith({ mode: "direct", url: null });
  expect(host.querySelector("input")).toBeNull();
});

it("rejects proxy authentication locally and keeps it out of save and feedback", async () => {
  await render(); await choose(I18N.settings.networkProxyCustom); await address("http://user:synthetic-secret@127.0.0.1"); await submit();
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(I18N.settings.networkProxyAuthenticationUnsupported);
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("synthetic-secret");
});

it("locks selectors/inputs for active or paused subtitles and never saves a disabled form", async () => {
  await render({ mode: "custom", url: "http://127.0.0.1:7890/" }, true);
  expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  expect(host.textContent).toContain(I18N.settings.networkProxyLocked);
  await submit(); expect(save).not.toHaveBeenCalled();
});

it("guards overlapping submissions, preserves a failed draft across optimistic rollback and permits explicit retry", async () => {
  let reject!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await render(); await choose(I18N.settings.networkProxyCustom); await address("http://127.0.0.1:7890");
  await submit(); await submit();
  expect(save).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true);
  expect(host.querySelector('button[aria-busy="true"]')?.textContent).toContain(I18N.settings.networkProxySaving);
  expect(host.querySelector(".settings-session-resume__busy")).not.toBeNull();
  await render({ mode: "custom", url: "http://127.0.0.1:7890/" });
  await render(system);
  await act(async () => { reject(new Error("unexpected failure containing synthetic-secret")); });
  expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("http://127.0.0.1:7890");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(I18N.settings.networkProxySaveFailed);
  expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("synthetic-secret");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await submit(); expect(save).toHaveBeenCalledTimes(2);
});

it.each([
  ["network_proxy_change_requires_stop", "networkProxyLocked"],
  ["network_proxy_builder_failed", "networkProxyBuilderFailed"],
  ["network_proxy_invalid_url", "networkProxyInvalidUrl"],
  ["network_proxy_unsupported_scheme", "networkProxyUnsupportedScheme"],
  ["network_proxy_authentication_unsupported", "networkProxyAuthenticationUnsupported"],
] as const)("maps the safe native error %s", async (label, key) => {
  save.mockRejectedValueOnce(new Error(label));
  await render(); await choose(I18N.settings.networkProxyDirect); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(I18N.settings[key]);
});
