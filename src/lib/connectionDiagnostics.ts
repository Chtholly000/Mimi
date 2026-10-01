import { effectiveUiLanguage, I18N } from "./i18n";
import type { ConnectionDiagnostic } from "./ipc";

export type DiagnosticPlatform = "macos" | "windows" | "linux";
const copy = {
  en: {
    storage: "Cannot read service credentials. Handle the system unlock prompt, then check again.",
    linuxStorage: "Cannot access your desktop password store. Confirm a Secret Service provider, such as GNOME Keyring, is installed and enabled in this desktop session. Unlock it or allow the system prompt, then check again.",
    serviceUnavailable: "Linux Secret Service is unavailable. Install or enable a Secret Service provider, such as GNOME Keyring, in this desktop session. Sign out and back in if required by your desktop setup, then check again.",
    accessDenied: "The system credential store is locked or access was denied. Unlock it or allow the system prompt, then check again.",
    missing: "No credentials configured. Save your service settings first.",
    invalid: "Cannot read the saved credentials. Save them again.",
    auth: "The service rejected authentication. Check your key and account access, then update the credentials.",
    reachable: "Server reachable; service authentication is not verified.",
    timeout: "Connection timed out. Check your network or proxy, then try again.",
    unreachable: "Secure connection failed. Check your network, proxy and system clock.",
    notTested: "Connection has not been checked.",
    present: "Credentials saved.",
    test: "Check connection", testing: "Checking…", help: "Connection details",
    details: "This checks reachability, not service access. An HTTP 401/403 response can still mean the server is reachable. Authentication is checked when captions start.",
    macos: "If credentials cannot be read, handle the macOS Keychain prompt and try again.",
    windows: "If credentials cannot be read, check Windows Credential Manager and try again.",
    linux: "Linux needs a Secret Service provider, such as GNOME Keyring, installed and enabled in the current desktop session. Sign out and back in if required by your desktop setup. Unlock the password store or allow the system prompt, then check again.",
  },
  zh: {
    storage: "无法读取服务凭据。先处理系统解锁提示，再重新检查。",
    linuxStorage: "无法访问桌面密码存储。请确认当前桌面会话已安装并启用 Secret Service 服务（例如 GNOME Keyring）。解锁密码存储或允许系统授权提示后，重新检查。",
    serviceUnavailable: "Linux Secret Service 服务不可用。请在当前桌面会话安装或启用兼容服务，例如 GNOME Keyring。若桌面配置要求，请注销并重新登录后再检查。",
    accessDenied: "系统凭据存储已锁定或访问被拒绝。解锁密码存储或允许系统授权提示后，重新检查。",
    missing: "尚未配置凭据。请先保存服务配置。",
    invalid: "无法读取已保存的凭据，请重新保存。",
    auth: "服务拒绝了认证。请检查密钥和账号权限，再更新凭据。",
    reachable: "服务器可连接，服务授权尚未验证。",
    timeout: "连接超时。检查网络或代理后重试。",
    unreachable: "安全连接失败。请检查网络、代理和系统时间。",
    notTested: "尚未检查连接。",
    present: "凭据已保存。",
    test: "检查连接", testing: "正在检查…", help: "连接详情",
    details: "这里只检查能否连接服务器。HTTP 401/403 也可能表示可连接，不代表认证成功；服务授权会在启动字幕时验证。",
    macos: "若无法读取凭据，请先处理 macOS 钥匙串提示，再重新检查。",
    windows: "若无法读取凭据，请检查 Windows 凭据管理器，再重新检查。",
    linux: "Linux 需要在当前桌面会话安装并启用 Secret Service 服务，例如 GNOME Keyring。若桌面配置要求，请注销并重新登录。解锁密码存储或允许系统授权提示后，重新检查。",
  },
  ja: {
    storage: "サービスの認証情報を読めません。システムの解除案内を確認し、もう一度お試しください。",
    linuxStorage: "デスクトップのパスワードストアにアクセスできません。現在のデスクトップセッションで GNOME Keyring などの Secret Service がインストールされ、有効になっていることを確認してください。ストアのロックを解除するかシステムのアクセス許可を承認して、再確認してください。",
    serviceUnavailable: "Linux Secret Service を利用できません。現在のデスクトップセッションで GNOME Keyring などの対応サービスをインストールするか有効にしてください。デスクトップの設定に応じてログアウトして再ログインし、再確認してください。",
    accessDenied: "システムの認証情報ストアがロックされているか、アクセスが拒否されました。ロックを解除するかシステムのアクセス許可を承認して、再確認してください。",
    missing: "認証情報が未設定です。まずサービス設定を保存してください。",
    invalid: "保存された認証情報を読めません。もう一度保存してください。",
    auth: "認証が拒否されました。キーとアカウントの権限を確認し、認証情報を更新してください。",
    reachable: "サーバーに接続できます。サービスの認証は未確認です。",
    timeout: "接続がタイムアウトしました。ネットワークやプロキシを確認してください。",
    unreachable: "安全な接続に失敗しました。ネットワーク、プロキシ、システム時刻を確認してください。",
    notTested: "接続は未確認です。",
    present: "認証情報を保存済みです。",
    test: "接続を確認", testing: "確認中…", help: "接続の詳細",
    details: "サーバーへの到達性だけを確認します。HTTP 401/403 も到達性を示す場合があり、認証成功ではありません。サービスの認証は字幕開始時に確認します。",
    macos: "認証情報を読めない場合は macOS のキーチェーンの案内を確認し、もう一度お試しください。",
    windows: "認証情報を読めない場合は Windows 資格情報マネージャーを確認してください。",
    linux: "Linux では現在のデスクトップセッションで GNOME Keyring などの Secret Service をインストールし、有効にする必要があります。デスクトップの設定に応じてログアウトして再ログインしてください。ストアのロックを解除するかシステムのアクセス許可を承認して、再確認してください。",
  },
};
export function diagnosticPlatform(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): DiagnosticPlatform {
  return /Mac/.test(userAgent) ? "macos" : /Windows/.test(userAgent) ? "windows" : "linux";
}
export function diagnosticCopy(platform: DiagnosticPlatform = diagnosticPlatform()) {
  const labels = copy[effectiveUiLanguage()];
  return { ...labels, storage: platform === "linux" ? labels.linuxStorage : labels.storage, details: `${labels[platform]} ${labels.details}` };
}
export function credentialUnavailableHelp(platform: DiagnosticPlatform = diagnosticPlatform()): string {
  return platform === "linux" ? diagnosticCopy(platform).storage : I18N.settings.credentialUnavailableHelp;
}
export function connectionDiagnosticMessage(result: ConnectionDiagnostic, platform?: DiagnosticPlatform): string {
  const labels = diagnosticCopy(platform);
  // Keep independent failures visible without repeating authentication disclaimers.
  const credential = result.credential === "unavailable" ? labels.storage : result.credential === "present" && result.network === "reachable" ? "" : labels[result.credential];
  return [credential, labels[result.network]].filter(Boolean).join(" ");
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
export function credentialErrorMessage(error: unknown, platform?: DiagnosticPlatform): string | null {
  if (typeof error !== "string") return null;
  const dlx = deepLXErrors[effectiveUiLanguage()];
  if (error.startsWith("DeepLX timed out.")) return dlx.timeout;
  if (error.startsWith("Could not connect to DeepLX.")) return dlx.connection;
  if (error.startsWith("DeepLX returned an invalid or empty translation.")) return dlx.response;
  if (error.startsWith("DeepLX returned too much data.")) return dlx.size;
  const rejected = /^DeepLX rejected the request \(code (\d{1,3})\)\./.exec(error);
  if (rejected) return `${dlx.rejected} (${rejected[1]})`;

  if (error === "credential_service_unavailable") return diagnosticCopy(platform).serviceUnavailable;
  if (error === "credential_store_access_denied") return diagnosticCopy(platform).accessDenied;
  if (error === "credential_store_unavailable" || error === "The system credential store is unavailable.") return diagnosticCopy(platform).storage;
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
