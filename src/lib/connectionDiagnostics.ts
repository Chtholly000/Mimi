import { effectiveUiLanguage, I18N } from "./i18n";
import type { ConnectionDiagnostic } from "./ipc";

const copy = {
  en: {
    storage: "Cannot read service credentials. Handle the system unlock prompt, then check again.",
    missing: "No credentials configured. Save your service settings first.",
    invalid: "Cannot read the saved credentials. Save them again.",
    auth: "The service rejected authentication. Check your key and account access, then update the credentials.",
    timeout: "Connection timed out. Check your network or proxy, then try again.",
    unreachable: "Secure connection failed. Check your network, proxy and system clock.",
    test: "Check connection", testing: "Checking…",
    available: "Available", unavailable: "Unavailable", notTested: "Not checked",
    checkFailed: "Check failed. Try again.",
    reasons: {
      credentialsMissing: "Save your credentials first.",
      credentialsUnavailable: "Unlock your system credential store.",
      invalidConfiguration: "Check the service settings.",
      authenticationRejected: "Check your credentials and account access.",
      serviceRejected: "The service rejected the request.",
      timeout: "Connection timed out.",
      unreachable: "Could not connect to the service.",
    },
  },
  zh: {
    storage: "无法读取服务凭据。先处理系统解锁提示，再重新检查。",
    missing: "尚未配置凭据。请先保存服务配置。",
    invalid: "无法读取已保存的凭据，请重新保存。",
    auth: "服务拒绝了认证。请检查密钥和账号权限，再更新凭据。",
    timeout: "连接超时。检查网络或代理后重试。",
    unreachable: "安全连接失败。请检查网络、代理和系统时间。",
    test: "检查连接", testing: "正在检查…",
    available: "可用", unavailable: "不可用", notTested: "尚未检查",
    checkFailed: "检查失败，请重试。",
    reasons: {
      credentialsMissing: "请先保存凭据。",
      credentialsUnavailable: "请先解锁系统凭据存储。",
      invalidConfiguration: "请检查服务配置。",
      authenticationRejected: "请检查凭据和账号权限。",
      serviceRejected: "服务拒绝了请求。",
      timeout: "连接超时。",
      unreachable: "无法连接服务。",
    },
  },
  ja: {
    storage: "サービスの認証情報を読めません。システムの解除案内を確認し、もう一度お試しください。",
    missing: "認証情報が未設定です。まずサービス設定を保存してください。",
    invalid: "保存された認証情報を読めません。もう一度保存してください。",
    auth: "認証が拒否されました。キーとアカウントの権限を確認し、認証情報を更新してください。",
    timeout: "接続がタイムアウトしました。ネットワークやプロキシを確認してください。",
    unreachable: "安全な接続に失敗しました。ネットワーク、プロキシ、システム時刻を確認してください。",
    test: "接続を確認", testing: "確認中…",
    available: "利用可能", unavailable: "利用不可", notTested: "未確認",
    checkFailed: "確認に失敗しました。もう一度お試しください。",
    reasons: {
      credentialsMissing: "認証情報を保存してください。",
      credentialsUnavailable: "認証情報の保存先を解除してください。",
      invalidConfiguration: "サービス設定を確認してください。",
      authenticationRejected: "認証情報とアカウントの権限を確認してください。",
      serviceRejected: "サービスがリクエストを拒否しました。",
      timeout: "接続がタイムアウトしました。",
      unreachable: "サービスに接続できません。",
    },
  },
};
export function diagnosticCopy() {
  return copy[effectiveUiLanguage()];
}
export function connectionDiagnosticMessage(result: ConnectionDiagnostic): string {
  const labels = diagnosticCopy();
  if (result.service === "available") return labels.available;
  if (result.service !== "unavailable") return labels.notTested;
  const reason = result.reason === null ? null : labels.reasons[result.reason];
  return reason ? `${labels.unavailable}: ${reason}` : labels.unavailable;
}
const deepLXErrors = {
  zh: {
    timeout: "DeepLX 响应超时。请检查文字翻译地址、网络和服务器，再重新启动字幕。",
    connection: "无法连接 DeepLX。请检查文字翻译地址、网络和服务器，再重新启动字幕。",
    response: "DeepLX 返回无效或空翻译。请确认文字翻译地址支持 DeepLX /translate JSON 接口。",
    size: "DeepLX 返回数据过大。请检查服务器的 /translate 响应。",
    rejected: "DeepLX 拒绝请求。请向服务器管理员确认文字翻译地址和可选 Bearer token。",
  },
  en: {
    timeout: "DeepLX timed out. Check the text translation endpoint, network and server, then restart subtitles.",
    connection: "Could not connect to DeepLX. Check the text translation endpoint, network and server, then restart subtitles.",
    response: "DeepLX returned an invalid or empty translation. Check that the text endpoint supports the DeepLX /translate JSON API.",
    size: "DeepLX returned too much data. Check the server's /translate response.",
    rejected: "DeepLX rejected the request. Confirm the text translation endpoint and optional Bearer token with your server administrator.",
  },
  ja: {
    timeout: "DeepLX がタイムアウトしました。文字翻訳 URL、ネットワーク、サーバーを確認し、字幕を再開してください。",
    connection: "DeepLX に接続できません。文字翻訳 URL、ネットワーク、サーバーを確認し、字幕を再開してください。",
    response: "DeepLX の翻訳が無効または空です。文字翻訳 URL が DeepLX /translate JSON API に対応しているか確認してください。",
    size: "DeepLX の応答が大きすぎます。サーバーの /translate 応答を確認してください。",
    rejected: "DeepLX がリクエストを拒否しました。文字翻訳 URL と任意の Bearer token をサーバー管理者に確認してください。",
  },
};
/** Match only sanitized backend labels; never interpolate arbitrary native errors. */
export function credentialErrorMessage(error: unknown): string | null {
  if (typeof error !== "string") return null;
  const dlx = deepLXErrors[effectiveUiLanguage()];
  if (error.startsWith("DeepLX timed out.")) return dlx.timeout;
  if (error.startsWith("Could not connect to DeepLX.")) return dlx.connection;
  if (error.startsWith("DeepLX returned an invalid or empty translation.")) return dlx.response;
  if (error.startsWith("DeepLX returned too much data.")) return dlx.size;
  const rejected = /^DeepLX rejected the request \(code (\d{1,3})\)\./.exec(error);
  if (rejected) return `${dlx.rejected} (${rejected[1]})`;

  if (error === "credential_store_unavailable" || error === "The system credential store is unavailable.") return diagnosticCopy().storage;
  if (["The live translation transport failed.", "The OpenAI Realtime Translation connection failed."].includes(error)) return diagnosticCopy().unreachable;
  if (["The live translation connection could not be established in time.", "The live translation connection stopped responding.", "The OpenAI Realtime Translation connection stopped responding."].includes(error)) return diagnosticCopy().timeout;
  if (error === "credential_authentication_failed") return diagnosticCopy().auth;
  if (/^Add the connection credentials for .+ in Settings\.$/.test(error)) return diagnosticCopy().missing;
  if (/^(The saved credentials could not be read\.|The saved credentials do not match the selected service\.|One or more credential fields are invalid\.)$/.test(error)) return diagnosticCopy().invalid;
  return null;
}
export function profileErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.startsWith("Use an HTTPS DeepLX endpoint")) return I18N.settings.deepLXEndpointInvalid;
  return credentialErrorMessage(error) ?? I18N.settings.profileActionFailed;
}
