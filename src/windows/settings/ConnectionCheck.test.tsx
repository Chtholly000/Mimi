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
    expect(host.querySelector('.settings-feedback[data-tone="info"]')?.textContent).toBe(diagnosticCopy().checkSkipped);
  }
});
it("does not treat a legacy reachable response as an authenticated success", async () => {
  await render({ credential: "present", network: "reachable" } as unknown as ConnectionDiagnostic);
  expect(host.querySelector('[data-tone="success"]')).toBeNull();
  expect(host.querySelector('.settings-feedback')?.textContent).toBe(diagnosticCopy().checkFailed);
});
it("checks only on explicit click and blocks repeat checks while pending", async () => {
  const onCheck = vi.fn();
  await act(() => root.render(<ConnectionCheck result={null} error={null} pending={false} disabled={false} onCheck={onCheck} />));
  expect(host.querySelector("details")).toBeNull(); expect(onCheck).not.toHaveBeenCalled();
  expect(host.querySelector(".settings-feedback")).toBeNull();
  expect(host.textContent).not.toContain(diagnosticCopy().notTested);
  await act(() => host.querySelector("button")!.click()); expect(onCheck).toHaveBeenCalledOnce();
  await act(() => root.render(<ConnectionCheck result={null} error={null} pending disabled={false} onCheck={onCheck} />));
  expect(host.querySelector("button")?.getAttribute("aria-busy")).toBe("true");
  expect(host.querySelector("button .settings-spinner")).not.toBeNull();
  expect(host.querySelector("button")?.textContent).toBe(diagnosticCopy().testing);
  expect(host.querySelector(".settings-feedback")).toBeNull();
  await act(() => host.querySelector("button")!.click()); expect(onCheck).toHaveBeenCalledOnce();
});

it.each(["zh", "en", "ja"] as const)("shows actionable credential recovery after an untested result in %s", async language => {
  setStoredUiLanguage(language);
  for (const reason of ["credentialsMissing", null] as const) {
    await render({ credential: "missing", service: "notTested", reason });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(diagnosticCopy().reasons.credentialsMissing);
    expect(host.textContent).not.toContain(diagnosticCopy().notTested);
    expect(host.querySelector('[data-tone="success"], [data-tone="info"]')).toBeNull();
  }
});

it("places one compact outcome before its check button and exposes an optional stage label", async () => {
  await act(() => root.render(<ConnectionCheck result={{ credential: "present", service: "available", reason: null }} error={null} pending={false} disabled={false} onCheck={vi.fn()} label="Check speech recognition" />));
  const check = host.querySelector<HTMLDivElement>(".connection-check")!;
  expect(check.firstElementChild?.classList.contains("settings-feedback")).toBe(true);
  expect(check.lastElementChild?.tagName).toBe("BUTTON");
  expect(check.querySelector("button")?.textContent).toBe("Check speech recognition");
  expect(host.querySelector("small, details, summary")).toBeNull();
});

it.each(["zh", "en", "ja"] as const)("shows measured check duration with its meaning in help instead of claiming live latency in %s", async language => {
  setStoredUiLanguage(language);
  await render({ credential: "present", service: "available", reason: null, elapsedMs: 123.4 });
  expect(host.querySelector(".connection-check__elapsed")?.textContent).toBe(`${diagnosticCopy().elapsed}: 123 ms`);
  expect(host.querySelector(".settings-help-control__description")?.textContent).toBe(diagnosticCopy().elapsedHelp);
  expect(host.querySelector(".settings-feedback")?.textContent).toContain(diagnosticCopy().available);
  expect(host.querySelector("small")).toBeNull();
});

it("omits absent, invalid and unmeasured preview-mode durations", async () => {
  for (const elapsedMs of [undefined, null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await render({ credential: "present", service: "available", reason: null, elapsedMs });
    expect(host.querySelector(".connection-check__elapsed")).toBeNull();
    expect(host.querySelector(".settings-help-control")).toBeNull();
  }
  await render({ credential: "present", service: "notTested", reason: null, elapsedMs: 123 });
  expect(host.querySelector(".connection-check__elapsed")).toBeNull();
  expect(host.querySelector(".settings-help-control")).toBeNull();
});

it("shows distinct recovery for Linux service and access failures without reporting a saved key", async () => {
  for (const language of ["en", "zh", "ja"] as const) {
    setStoredUiLanguage(language);
    for (const [credential, reason] of [["serviceUnavailable", "credentialsServiceUnavailable"], ["accessDenied", "credentialsAccessDenied"], ["missing", "credentialsMissing"]] as const) {
      await act(() => root.render(<ConnectionCheck result={{ credential, service: "unavailable", reason }} error={null} pending={false} disabled={false} onCheck={vi.fn()} platform="linux" />));
      expect(host.querySelector('.settings-feedback[data-tone="error"]')?.textContent).toBe(`${diagnosticCopy("linux").unavailable}: ${diagnosticCopy("linux").reasons[reason]}`);
      expect(host.querySelector("details")).toBeNull();
      expect(host.querySelector('[data-tone="success"]')).toBeNull();
    }
  }
});
