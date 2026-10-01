import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "./i18n";
import { connectionDiagnosticMessage, credentialErrorMessage, credentialUnavailableHelp, profileErrorMessage, diagnosticCopy, diagnosticPlatform } from "./connectionDiagnostics";
import { I18N } from "./i18n";
afterEach(() => setStoredUiLanguage("en"));
it("localizes shortcut and storage errors without losing recovery guidance", () => {
  setStoredUiLanguage("zh");
  expect(credentialErrorMessage("credential_store_unavailable", "macos")).toContain("无法读取服务凭据");
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
  expect(diagnosticCopy("linux").details).toContain("Secret Service");
  expect(diagnosticCopy("linux").details).toContain("GNOME Keyring");
  expect(diagnosticCopy("linux").details).not.toContain(".deb");
  for (const platform of ["macos", "windows", "linux"] as const) {
    expect(diagnosticCopy(platform).details).not.toContain("测试模式");
  }
});

it.each([
  ["en", "Install or enable", "Sign out and back in", "locked or access was denied", "Unlock it or allow", "No credentials configured"],
  ["zh", "安装或启用", "注销并重新登录", "已锁定或访问被拒绝", "解锁密码存储或允许", "尚未配置凭据"],
  ["ja", "インストールするか有効", "ログアウトして再ログイン", "ロックされているか、アクセスが拒否", "解除するかシステムのアクセス許可を承認", "認証情報が未設定"],
] as const)("distinguishes missing Linux services, denied access and missing credentials in %s", (language, setup, login, denied, unlock, missing) => {
  setStoredUiLanguage(language);
  const service = credentialErrorMessage("credential_service_unavailable", "linux")!;
  expect(service).toContain("Secret Service");
  expect(service).toContain("GNOME Keyring");
  expect(service).toContain(setup);
  expect(service).toContain(login);
  expect(service).not.toContain(unlock);
  expect(connectionDiagnosticMessage({ credential: "serviceUnavailable", network: "notTested" }, "linux")).toContain(service);

  const access = credentialErrorMessage("credential_store_access_denied", "linux")!;
  expect(access).toContain(denied);
  expect(access).toContain(unlock);
  expect(access).not.toContain(setup);
  expect(connectionDiagnosticMessage({ credential: "accessDenied", network: "notTested" }, "linux")).toContain(access);
  expect(connectionDiagnosticMessage({ credential: "missing", network: "notTested" }, "linux")).toContain(missing);
});

it("gives general Linux storage errors provider setup guidance while preserving Mac unlock copy", () => {
  setStoredUiLanguage("en");
  expect(diagnosticCopy("linux").storage).toContain("installed and enabled in this desktop session");
  expect(credentialErrorMessage("credential_store_unavailable", "linux")).toBe(diagnosticCopy("linux").storage);
  expect(connectionDiagnosticMessage({ credential: "unavailable", network: "notTested" }, "linux")).toContain("Secret Service");
  expect(diagnosticCopy("macos").storage).toBe("Cannot read service credentials. Handle the system unlock prompt, then check again.");
  expect(diagnosticCopy("macos").storage).not.toContain("Secret Service");
  expect(credentialUnavailableHelp("linux")).toBe(diagnosticCopy("linux").storage);
  expect(credentialUnavailableHelp("macos")).toBe(I18N.settings.credentialUnavailableHelp);
  expect(credentialUnavailableHelp("windows")).toBe(I18N.settings.credentialUnavailableHelp);
});
