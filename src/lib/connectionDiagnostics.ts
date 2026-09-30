import { effectiveUiLanguage, I18N } from "./i18n";
import type { ConnectionDiagnostic } from "./ipc";

const copy = {
  en: {
    storage: "Mimi cannot securely save or read your key. Allow the system password-storage unlock prompt, then test again. Keys are never saved as plain text.",
    missing: "No credentials configured. Save this service's credentials in Settings, then start subtitles to verify authentication.",
    invalid: "The saved credentials could not be read. Save them again.",
    auth: "The service rejected authentication. Check the key, service region, account permissions and expiry in the provider console, then replace the saved credentials.",
    reachable: "Network: server reachable. Authentication has not been verified. Start subtitles to verify service access; provider charges may apply.",
    timeout: "Network: connection timed out. Check your network, proxy and firewall, then test again.",
    unreachable: "Network: secure connection failed. Check your network, proxy, firewall and system clock, then test again.",
    notTested: "Network: not tested. Azure and DeepLX require their configured endpoints. UI test mode never contacts providers.",
    present: "Secure storage: credentials configured; validity has not been verified.",
    test: "Test connection",
    testing: "Checking…",
    authentication: "Authentication: not tested.",
    help: "Still having trouble?",
    details: "On supported Debian/Ubuntu desktops, the Mimi .deb package lets the package manager provide password storage. AppImage needs an existing desktop password store. Your desktop session must be unlocked. This check sends no key: HTTP 401/403 means the server is reachable, not that authentication succeeded. Azure, DeepLX and UI-test mode skip the network check.",
    note: "Checks secure storage and server reachability without sending credentials or audio. Does not start a translation session or verify authentication.",
  },
  zh: {
    storage: "Mimi 暂时无法安全保存或读取密钥。请允许系统解锁密码存储的提示，然后点击“测试连接”重试。密钥不会以明文保存。",
    missing: "尚未配置凭据。请在设置中保存此服务的凭据，再启动字幕验证认证。",
    invalid: "无法读取已保存的凭据，请重新保存。",
    auth: "服务拒绝了认证。请在服务商控制台检查密钥、服务区域、账号权限和有效期，再替换已保存的凭据。",
    reachable: "网络：服务器可达。尚未验证认证或服务权限，请启动字幕验证；可能产生服务商费用。",
    timeout: "网络：连接超时。请检查网络、代理和防火墙，然后重新测试。",
    unreachable: "网络：安全连接失败。请检查网络、代理、防火墙和系统时间，然后重新测试。",
    notTested: "网络：未测试。Azure 和 DeepLX 需要已配置的服务地址；界面测试模式不会连接服务商。",
    present: "安全存储：已配置凭据，尚未验证有效性。",
    test: "测试连接",
    testing: "正在检查…",
    authentication: "认证：尚未验证。",
    help: "仍然遇到问题？",
    details: "受支持的 Debian/Ubuntu 桌面使用 Mimi .deb 安装包时，软件包管理器会提供密码存储；AppImage 需要桌面已有密码存储，桌面会话仍需解锁。此检查不发送密钥，HTTP 401/403 表示服务器可达，不代表认证成功。Azure、DeepLX 和界面测试模式跳过网络检查。",
    note: "检查安全存储和服务器可达性，不发送凭据或音频，不启动翻译会话，也不验证认证。",
  },
  ja: {
    storage: "Mimi がキーを安全に読み書きできません。システムのパスワードストレージ解除を許可して再テストしてください。キーは平文で保存しません。",
    missing: "認証情報が未設定です。設定で保存してから字幕を開始し認証を確認してください。",
    invalid: "保存された認証情報を読めません。もう一度保存してください。",
    auth: "認証が拒否されました。プロバイダーでキー、リージョン、権限、有効期限を確認し、保存した認証情報を更新してください。",
    reachable: "ネットワーク：サーバーに到達できました。サービス権限は字幕を開始して確認してください。料金が発生する場合があります。",
    timeout: "ネットワーク：タイムアウト。接続、プロキシ、ファイアウォールを確認して再テストしてください。",
    unreachable: "ネットワーク：安全な接続に失敗。接続、プロキシ、ファイアウォール、システム時刻を確認してください。",
    notTested: "ネットワーク：未確認。Azure と DeepLX は設定された URL が必要です。UI テストでは通信しません。",
    present: "安全なストレージ：認証情報は設定済み、有効性は未確認です。",
    test: "接続をテスト",
    testing: "確認中…",
    authentication: "認証：未確認。",
    help: "問題が続く場合",
    details: "対応する Debian/Ubuntu デスクトップでは .deb のパッケージマネージャーがパスワードストレージを提供します。AppImage は既存のストレージが必要です。デスクトップセッションの解除が必要です。キーなしの HTTP 401/403 は到達性のみを示します。Azure、DeepLX と UI テストではネットワーク確認を行いません。",
    note: "認証情報や音声を送信せずストレージと到達性を確認します。翻訳セッションの開始や認証確認は行いません。",
  },
};
export function diagnosticCopy() { return copy[effectiveUiLanguage()]; }
export function connectionDiagnosticMessage(result: ConnectionDiagnostic): string {
  const labels = diagnosticCopy();
  return `${result.credential === "unavailable" ? labels.storage : labels[result.credential]} ${labels[result.network]} ${labels.authentication}`;
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
  if (typeof error === "string" && error.startsWith("Use an HTTPS DeepLX endpoint")) return I18N.settings.deepLXNote;
  return credentialErrorMessage(error) ?? I18N.settings.profileActionFailed;
}
