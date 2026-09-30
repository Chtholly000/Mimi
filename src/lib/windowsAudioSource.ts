import { effectiveUiLanguage } from "./i18n";

export interface AudioSourceSnapshot {
  devices: { id: string; name: string }[];
  currentDevice: string | null;
  receivingSound: boolean;
}

const copy = {
  en: {
    title: "Sound source", system: "Follow system", unavailable: "Unavailable output",
    help: "Choose the headphones or speakers your app plays through.",
    stop: "Stop subtitles before changing the sound source.",
    missing: "This output is unavailable. Choose another sound source.",
    receiving: "Receiving sound", silent: "No sound yet. Play something, or check your app’s sound output.",
    idle: "Start subtitles and play something to check the sound.",
    failed: "Sound outputs could not be loaded. Try reopening Settings.",
  },
  zh: {
    title: "声音来源", system: "跟随系统", unavailable: "不可用的输出设备",
    help: "选择应用实际播放声音的耳机或扬声器。",
    stop: "更换声音来源前，请先停止字幕。",
    missing: "此输出设备不可用，请选择其他声音来源。",
    receiving: "收到声音", silent: "暂未收到声音。请播放声音，或检查应用的声音输出。",
    idle: "开启字幕并播放声音，即可检查是否收到声音。",
    failed: "无法加载声音输出设备，请重新打开设置。",
  },
  ja: {
    title: "音声の取得元", system: "システムに合わせる", unavailable: "利用できない出力先",
    help: "アプリが音声を再生しているヘッドホンやスピーカーを選んでください。",
    stop: "取得元を変更する前に、字幕を停止してください。",
    missing: "この出力先は利用できません。別の取得元を選んでください。",
    receiving: "音声を受信中", silent: "まだ音声がありません。音声を再生するか、アプリの音声出力先を確認してください。",
    idle: "字幕を開始して音声を再生すると、受信を確認できます。",
    failed: "音声出力先を読み込めませんでした。設定を開き直してください。",
  },
};


export function audioSourceCopy() { return copy[effectiveUiLanguage()]; }

export function audioSourceErrorMessage(message: string): string | null {
  return message === "The selected sound output is unavailable. Stop subtitles and choose another sound source in Settings."
    ? audioSourceCopy().missing : null;
}
