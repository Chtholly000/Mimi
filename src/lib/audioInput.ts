import { effectiveUiLanguage } from "./i18n";

const copy = {
  en: {
    missing: "No microphone is available. Connect one and select it as the system’s default input.",
    permission: "Microphone access was denied. Allow Mimi to use the microphone in system privacy settings, then try again.",
    start: "Could not start the microphone. Check the system’s default input and its permissions, then try again.",
    running: "Audio capture is already running.", cancelled: "Audio capture was cancelled.",
    stopping: "Audio capture is still stopping. Try again in a moment.",
    format: "This audio format could not be processed. Check the selected input in system sound settings.",
    stopped: "Audio capture stopped unexpectedly. Check the selected input, then start subtitles again.",
    timeout: "Audio capture setup timed out. Check the selected input, then try again.",
    server: "Connect to PulseAudio or PipeWire with PulseAudio support, then try again.",
  },
  zh: {
    missing: "没有可用的麦克风。请连接麦克风，并将其设为系统默认输入。",
    permission: "麦克风权限被拒绝。请在系统隐私设置中允许 Mimi 使用麦克风，然后重试。",
    start: "无法启动麦克风。请检查系统默认输入和麦克风权限，然后重试。",
    running: "音频采集已在运行。", cancelled: "音频采集已取消。",
    stopping: "音频采集仍在停止，请稍后重试。",
    format: "无法处理此音频格式，请在系统声音设置中检查所选输入。",
    stopped: "音频采集意外停止，请检查所选输入，然后重新开启字幕。",
    timeout: "音频采集启动超时，请检查所选输入后重试。",
    server: "请连接支持 PulseAudio 的 PipeWire 或 PulseAudio 服务，然后重试。",
  },
  ja: {
    missing: "利用できるマイクがありません。接続して、システムの既定の入力に設定してください。",
    permission: "マイクへのアクセスが拒否されました。システムのプライバシー設定で Mimi のマイク利用を許可し、再試行してください。",
    start: "マイクを開始できませんでした。システムの既定の入力とマイクの権限を確認し、再試行してください。",
    running: "音声の取得はすでに実行中です。", cancelled: "音声の取得をキャンセルしました。",
    stopping: "音声の取得を停止中です。しばらくしてから再試行してください。",
    format: "この音声形式を処理できません。システムのサウンド設定で選択した入力を確認してください。",
    stopped: "音声の取得が予期せず停止しました。選択した入力を確認し、字幕を再開してください。",
    timeout: "音声の取得開始がタイムアウトしました。選択した入力を確認し、再試行してください。",
    server: "PulseAudio、または PulseAudio 対応の PipeWire に接続して、再試行してください。",
  },
};

const errors: Record<string, keyof typeof copy.en> = {
  "No default microphone is available.": "missing",
  "Microphone capture permission was denied.": "permission",
  "Microphone capture could not be started.": "start",
  "Audio capture is already running.": "running",
  "Audio capture start was cancelled.": "cancelled",
  "The previous audio capture is still stopping.": "stopping",
  "Audio capture could not process the device audio format.": "format",
  "Audio capture stopped unexpectedly.": "stopped",
  "Audio capture setup timed out.": "timeout",
  "Connect to PulseAudio or PipeWire with PulseAudio support to capture audio.": "server",
};

/** Match only safe native labels; never reinterpret arbitrary provider messages. */
export function audioInputErrorMessage(message: string): string | null {
  const key = errors[message];
  return key ? copy[effectiveUiLanguage()][key] : null;
}
