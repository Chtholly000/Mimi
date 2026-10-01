import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "./i18n";
import { connectionDiagnosticMessage, credentialErrorMessage, profileErrorMessage, diagnosticCopy, diagnosticPlatform } from "./connectionDiagnostics";
afterEach(() => setStoredUiLanguage("en"));
it("localizes shortcut and storage errors without losing recovery guidance", () => {
  setStoredUiLanguage("zh");
  expect(credentialErrorMessage("credential_store_unavailable")).toContain("无法读取服务凭据");
  expect(credentialErrorMessage("The system credential store is unavailable.")).not.toContain("The system");
  expect(credentialErrorMessage("credential_authentication_failed")).toContain("服务拒绝了认证");
});
it("never interpolates arbitrary native errors or synthetic secrets", () => {
  expect(profileErrorMessage("synthetic-secret-private-value")).not.toContain("synthetic-secret");
});
it("keeps unauthenticated reachability distinct from valid credentials", () => {
  setStoredUiLanguage("zh");
  const message = connectionDiagnosticMessage({ credential: "missing", network: "reachable" });
  expect(message).toContain("尚未配置凭据");
  expect(message).toContain("服务授权尚未验证");
  expect(diagnosticCopy().details).toContain("HTTP 401");
  expect(message).not.toContain("认证成功");
});
it("reports independent storage and network failures", () => {
  setStoredUiLanguage("en");
  expect(connectionDiagnosticMessage({ credential: "unavailable", network: "timeout" })).toContain("timed out");
  expect(connectionDiagnosticMessage({ credential: "invalid", network: "reachable" })).toContain("Cannot read");
});

it("shows a short endpoint correction instead of the whole provider description", () => {
  for (const language of ["en", "zh", "ja"] as const) {
    setStoredUiLanguage(language);
    const message = profileErrorMessage("Use an HTTPS DeepLX endpoint (or HTTP on localhost), without URL credentials, query or fragment.");
    expect(message).toContain("HTTPS");
    expect(message).toContain("localhost");
    expect(message).toContain("?");
    expect(message).toContain("#");
    expect(message).not.toContain("Audio 3.0");
  }
});

it("limits desktop recovery guidance to the detected platform", () => {
  setStoredUiLanguage("zh");
  expect(diagnosticPlatform("Mozilla Mac OS X")).toBe("macos");
  expect(diagnosticCopy("macos").details).toContain("钥匙串");
  expect(diagnosticCopy("macos").details).not.toContain("Debian");
  expect(diagnosticCopy("windows").details).toContain("凭据管理器");
  expect(diagnosticCopy("linux").details).toContain("Debian");
  for (const platform of ["macos", "windows", "linux"] as const) {
    expect(diagnosticCopy(platform).details).not.toContain("测试模式");
  }
});
