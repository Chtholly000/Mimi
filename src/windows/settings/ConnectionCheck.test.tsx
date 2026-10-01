// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { diagnosticCopy } from "../../lib/connectionDiagnostics";
import { setStoredUiLanguage } from "../../lib/i18n";
import type { ConnectionDiagnostic } from "../../lib/ipc";
import { ConnectionCheck } from "./ConnectionCheck";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); setStoredUiLanguage("zh"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); setStoredUiLanguage("en"); });
async function render(result: ConnectionDiagnostic) {
  await act(() => root.render(<ConnectionCheck result={result} error={null} pending={false} disabled={false} onCheck={vi.fn()} />));
}
it("shows one short unavailable reason without a technical details section", async () => {
  await render({ credential: "unavailable", service: "unavailable", reason: "credentialsUnavailable" });
  expect(host.querySelector("details, summary")).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(`${diagnosticCopy().unavailable}: ${diagnosticCopy().reasons.credentialsUnavailable}`);
  expect(host.textContent).not.toMatch(/HTTP|Debian|授权尚未验证|测试模式/);
});
it("shows success only for verified service availability in all languages", async () => {
  for (const language of ["zh", "en", "ja"] as const) {
    setStoredUiLanguage(language);
    await render({ credential: "present", service: "available", reason: null });
    expect(host.querySelector('.settings-feedback[data-tone="success"]')?.textContent).toBe(diagnosticCopy().available);
    await render({ credential: "present", service: "notTested", reason: null });
    expect(host.querySelector('[data-tone="success"]')).toBeNull();
    expect(host.querySelector('.settings-feedback[data-tone="info"]')?.textContent).toBe(diagnosticCopy().notTested);
  }
});
it("does not treat a legacy reachable response as an authenticated success", async () => {
  await render({ credential: "present", network: "reachable" } as unknown as ConnectionDiagnostic);
  expect(host.querySelector('[data-tone="success"]')).toBeNull();
  expect(host.querySelector('.settings-feedback')?.textContent).toBe(diagnosticCopy().notTested);
});
it("checks only on explicit click and blocks repeat checks while pending", async () => {
  const onCheck = vi.fn();
  await act(() => root.render(<ConnectionCheck result={null} error={null} pending={false} disabled={false} onCheck={onCheck} />));
  expect(host.querySelector("details")).toBeNull(); expect(onCheck).not.toHaveBeenCalled();
  await act(() => host.querySelector("button")!.click()); expect(onCheck).toHaveBeenCalledOnce();
  await act(() => root.render(<ConnectionCheck result={null} error={null} pending disabled={false} onCheck={onCheck} />));
  await act(() => host.querySelector("button")!.click()); expect(onCheck).toHaveBeenCalledOnce();
});
