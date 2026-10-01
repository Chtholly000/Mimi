// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setStoredUiLanguage } from "../../lib/i18n";
import { SupportDiagnostics } from "./SupportDiagnostics";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), clipboard: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/ipc", () => ({ isTauri: true }));
vi.mock("../../lib/diagnosticClipboard", () => ({ writeDiagnosticClipboard: mocks.clipboard }));

let host: HTMLDivElement;
let root: Root;
const report = "Mimi diagnostics\nStatus: idle\nRecent audio frames: 0";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setStoredUiLanguage("en");
  mocks.invoke.mockResolvedValue(report);
  mocks.clipboard.mockImplementation(async (value: Promise<string>) => { await value; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setStoredUiLanguage("system");
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function mount() { await act(async () => root.render(<SupportDiagnostics />)); }
async function copy() { await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); }

it("prepares diagnostics only after copy and removes the extra details control", async () => {
  await mount();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(host.querySelector("details, summary, textarea")).toBeNull();
  await copy();
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("support_diagnostics");
  expect(mocks.clipboard).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Copied successfully");
  expect(host.querySelector("textarea")).toBeNull();
});

it("offers a selectable report directly when clipboard access fails", async () => {
  mocks.clipboard.mockRejectedValue(new Error("synthetic-clipboard-denial"));
  await mount();
  await copy();
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(report);
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not copy");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click());
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(report);
  expect(host.querySelector("details, summary")).toBeNull();
});

it("reports preparation failure without exposing a previous or invalid report", async () => {
  mocks.invoke.mockRejectedValue(new Error("synthetic-diagnostic-failure"));
  await mount();
  await copy();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not prepare diagnostics");
  expect(host.querySelector("textarea")).toBeNull();
});

it("keeps the existing reviewed public feedback action", async () => {
  mocks.invoke.mockResolvedValue({ report, requiresPaste: false });
  await mount();
  await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1].click());
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("app_open_support_issue");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Review the report");
});
