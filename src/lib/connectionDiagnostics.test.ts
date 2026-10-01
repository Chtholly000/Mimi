import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "./i18n";
import { connectionDiagnosticMessage, credentialErrorMessage, profileErrorMessage, diagnosticCopy } from "./connectionDiagnostics";
import type { ConnectionDiagnostic } from "./ipc";
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
it("shows a short unavailable reason instead of a reachability disclaimer", () => {
  setStoredUiLanguage("zh");
  const message = connectionDiagnosticMessage({ credential: "missing", service: "unavailable", reason: "credentialsMissing" });
  expect(message).toBe("不可用: 请先保存凭据。");
  expect(message).not.toContain("HTTP");
  expect(message).not.toContain("认证成功");
});
it("localizes every service failure reason and leaves untested availability neutral", () => {
  const reasons = ["credentialsMissing", "credentialsUnavailable", "invalidConfiguration", "authenticationRejected", "serviceRejected", "timeout", "unreachable"] as const;
  for (const language of ["zh", "en", "ja"] as const) {
    setStoredUiLanguage(language);
    for (const reason of reasons) {
      expect(connectionDiagnosticMessage({ credential: "present", service: "unavailable", reason })).toBe(`${diagnosticCopy().unavailable}: ${diagnosticCopy().reasons[reason]}`);
    }
    expect(connectionDiagnosticMessage({ credential: "present", service: "notTested", reason: null })).toBe(diagnosticCopy().notTested);
    expect(connectionDiagnosticMessage({ credential: "present", service: "available", reason: null })).toBe(diagnosticCopy().available);
  }
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

it("never upgrades the former network-only contract to available", () => {
  const legacy = { credential: "present", network: "reachable" } as unknown as ConnectionDiagnostic;
  expect(connectionDiagnosticMessage(legacy)).toBe(diagnosticCopy().notTested);
});
