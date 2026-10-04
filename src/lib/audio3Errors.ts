import { effectiveUiLanguage } from "./i18n";

const copy = {
  en: {
    setup: "While starting speech recognition: ", recognition: "While recognizing audio: ", connection: "While connecting: ",
    timeout: "the service timed out. Check the sound status and your connection, then restart subtitles.",
    authentication: "the service rejected access. Check the API key and permissions in Settings.",
    request: "the service rejected this request. Check the service settings, then try again.",
    service: "the service reported an error. Try again later.",
    rate_limit: "the service is limiting requests. Wait a little before restarting subtitles.",
    task_failed: "the service ended the task without a recognized cause. Check the sound status, then try again.",
  },
  zh: {
    setup: "启动语音识别时：", recognition: "识别声音时：", connection: "连接服务时：",
    timeout: "服务超时。请检查声音状态和网络连接，再重新开启字幕。",
    authentication: "服务拒绝了访问。请在设置中检查 API 密钥和访问权限。",
    request: "服务拒绝了此次请求。请检查服务设置后重试。",
    service: "服务报告了错误，请稍后重试。",
    rate_limit: "服务正在限制请求，请稍等再重新开启字幕。",
    task_failed: "服务结束了任务，原因尚不明确。请检查声音状态后重试。",
  },
  ja: {
    setup: "音声認識の開始時：", recognition: "音声認識中：", connection: "サービスへの接続時：",
    timeout: "サービスがタイムアウトしました。音声の状態とネットワークを確認して、字幕を再開してください。",
    authentication: "サービスがアクセスを拒否しました。設定で API キーとアクセス権限を確認してください。",
    request: "サービスがリクエストを拒否しました。サービスの設定を確認して再試行してください。",
    service: "サービスがエラーを報告しました。後で再試行してください。",
    rate_limit: "サービスがリクエストを制限しています。少し待ってから字幕を再開してください。",
    task_failed: "サービスがタスクを終了しましたが、原因はまだ不明です。音声の状態を確認して再試行してください。",
  },
};

export function audio3ErrorMessage(message: string): string | null {
  const match = /^audio3_error\.(setup|recognition|connection)\.(timeout|authentication|request|service|rate_limit|task_failed)\.(CLIENT_ERROR|SERVER_ERROR|INVALID_API_KEY|UNAUTHORIZED|REQUEST_TIMEOUT|THROTTLED|OTHER|LOCAL_TIMEOUT|HTTP_AUTH)$/.exec(message);
  if (!match) return null;
  const text = copy[effectiveUiLanguage()];
  return text[match[1] as "setup" | "recognition" | "connection"] + text[match[2] as "timeout" | "authentication" | "request" | "service" | "rate_limit" | "task_failed"];
}
