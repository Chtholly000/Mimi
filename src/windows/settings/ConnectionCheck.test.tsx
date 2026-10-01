// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setStoredUiLanguage } from "../../lib/i18n";
import { ConnectionCheck } from "./ConnectionCheck";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); setStoredUiLanguage("zh"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); setStoredUiLanguage("en"); });
it("keeps technical recovery collapsed and excludes Linux instructions on Mac", async () => {
  await act(() => root.render(<ConnectionCheck result={{ credential: "unavailable", network: "reachable" }} error={null} pending={false} disabled={false} onCheck={vi.fn()} platform="macos" />));
  expect(host.querySelector("details")!.open).toBe(false); expect(host.textContent).not.toContain("Debian");
  expect(host.querySelector(".settings-feedback")!.textContent).toContain("先处理系统解锁提示");
  expect(host.querySelector(".settings-feedback")!.textContent).toContain("授权尚未验证");
  expect(host.textContent).not.toContain("测试模式");
});
it("does not turn unauthenticated reachability into a success indication", async () => {
  for (const language of ["zh", "en", "ja"] as const) {
    setStoredUiLanguage(language);
    await act(() => root.render(<ConnectionCheck result={{ credential: "present", network: "reachable" }} error={null} pending={false} disabled={false} onCheck={vi.fn()} />));
    expect(host.querySelector('.settings-feedback[data-tone="info"]')).toBeTruthy();
    expect(host.querySelector('[data-tone="success"]')).toBeNull();
  }
});
it("checks only on explicit click and blocks repeat checks while pending", async () => {
  const onCheck = vi.fn();
  await act(() => root.render(<ConnectionCheck result={null} error={null} pending={false} disabled={false} onCheck={onCheck} />));
  expect(host.querySelector("details")).toBeNull(); expect(onCheck).not.toHaveBeenCalled();
  await act(() => host.querySelector("button")!.click()); expect(onCheck).toHaveBeenCalledOnce();
  await act(() => root.render(<ConnectionCheck result={null} error={null} pending disabled onCheck={onCheck} />));
  await act(() => host.querySelector("button")!.click()); expect(onCheck).toHaveBeenCalledOnce();
});
