import { effectiveUiLanguage } from "./i18n";
import type { AudioInput } from "./types";

export interface CaptureStatus {
  kind: "windows_output" | "macos_system_mix" | "linux_output_monitor" | "microphone" | "both" | "unknown";
  strategy: "follow_system" | "manual_output" | "platform_capture" | "default_input" | "independent_inputs";
  actualDeviceName: string | null;
  /** Default system output, independent of the macOS mixed-audio capture route. */
  systemOutputDeviceName?: string | null;
  observation: { pcmDataRecent: boolean; soundRecent: boolean } | null;
}

const copy = {
  en: { title: "Sound source", system: "Follow system", manual: "Selected output", mac: "System sound mix", linux: "Output monitor selected at start", unknown: "Source unknown", deviceUnknown: "Actual device unknown", idle: "Not capturing", paused: "Capture paused", unobserved: "Audio not observed yet", sound: "Receiving sound", silent: "Audio data, no clear sound", noData: "No audio data — play sound and check your app’s output" },
  zh: { title: "声音来源", system: "跟随系统", manual: "手动选择输出", mac: "系统声音混音", linux: "启动时选定的输出监听", unknown: "来源未知", deviceUnknown: "实际设备未知", idle: "尚未采音", paused: "采音已暂停", unobserved: "尚未观察到音频", sound: "收到声音", silent: "已采到数据，暂无明显声音", noData: "暂未采到数据，请播放声音并检查应用的输出" },
  ja: { title: "音声の取得元", system: "システムに合わせる", manual: "選択した出力先", mac: "システム音声ミックス", linux: "開始時に選択した出力のモニター", unknown: "取得元は不明", deviceUnknown: "実際のデバイスは不明", idle: "音声取得前", paused: "音声取得を一時停止中", unobserved: "音声はまだ未確認", sound: "音声を受信中", silent: "データ受信中、明確な音なし", noData: "音声データなし。音を再生し、アプリの出力先を確認してください" },
};

const bothCopy = {
  en: { source: "System audio + microphone", noData: "No audio data — check system playback and the default microphone" },
  zh: { source: "系统声音与麦克风", noData: "暂未采到数据，请检查系统播放和默认麦克风" },
  ja: { source: "システム音声とマイク", noData: "音声データなし。システムの再生と既定のマイクを確認してください" },
};

const microphoneCopy = {
  en: { source: "Microphone", noData: "No audio data — check the system’s default microphone" },
  zh: { source: "麦克风", noData: "暂未采到数据，请检查系统默认麦克风" },
  ja: { source: "マイク", noData: "音声データなし。システムの既定のマイクを確認してください" },
};

export function capturePresentation(value: CaptureStatus | null, active: boolean, paused: boolean, language = effectiveUiLanguage(), input: AudioInput = "system") {
  const text = copy[language];
  const both = input === "both" || value?.kind === "both";
  const microphone = input === "microphone" || value?.kind === "microphone";
  const source = both ? bothCopy[language].source : microphone ? microphoneCopy[language].source : value?.kind === "windows_output" ? value.strategy === "follow_system" ? text.system : text.manual
    : value?.kind === "macos_system_mix" ? text.mac : value?.kind === "linux_output_monitor" ? text.linux : text.unknown;
  const device = value?.actualDeviceName || text.deviceUnknown;
  const observation = !active ? text.idle : paused ? text.paused : !value?.observation ? text.unobserved
    : value.observation.soundRecent && value.observation.pcmDataRecent ? text.sound
    : value.observation.pcmDataRecent ? text.silent : both ? bothCopy[language].noData : microphone ? microphoneCopy[language].noData : text.noData;
  return { title: text.title, source, device, observation };
}
