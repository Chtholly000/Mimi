import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { capturePresentation, type CaptureStatus } from "../../lib/captureStatus";
import { isTauri } from "../../lib/ipc";
import { useStore } from "../../lib/store";
import { Icon } from "../../components/Icon";
import { effectiveUiLanguage, I18N } from "../../lib/i18n";

const systemOutputLabels = { zh: "系统输出", en: "System output", ja: "システム出力" };

/** Mounted only in the expanded panel. Names stay local to this window. */
export function CaptureStatusRow({ onShowAudioSettings, disabled = false }: {
  onShowAudioSettings?: () => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const active = useStore((state) => state.session.isActive);
  const paused = useStore((state) => state.session.isPaused);
  const input = useStore((state) => state.settings.audioInput) ?? "system";
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await invoke<CaptureStatus>("capture_status");
        if (disposed) return;
        setStatus(value);
      } catch { if (!disposed) setStatus(null); }
      if (!disposed) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [input]);
  // Source changes invalidate the previous poll before a new response arrives.
  const statusInput = status?.kind === "both" ? "both" : status?.kind === "microphone" ? "microphone" : "system";
  const currentStatus = input === statusInput ? status : null;
  const language = effectiveUiLanguage();
  const text = capturePresentation(currentStatus, active, paused, language, input);
  // The system output is useful context, not a claim that a system mix is
  // bound to that device. Missing names never manufacture an Unknown row.
  const outputName = input === "system" ? currentStatus?.systemOutputDeviceName : null;
  const microphoneName = input === "microphone" ? currentStatus?.actualDeviceName : null;
  const source = microphoneName ? `${text.source}${language === "en" ? ": " : "："}${microphoneName}` : outputName
    ? `${systemOutputLabels[language]}${language === "en" ? ": " : "："}${outputName}`
    : text.source;
  return <div className="overlay-control-capture" aria-label={text.title} title={`${source} · ${text.source} · ${text.observation}`}>
    <span className="overlay-control-capture__summary" role="status">
      <span className="overlay-control-capture__source">{source}</span>
      <span aria-hidden="true"> · </span>
      <span className="overlay-control-capture__observation">{text.observation}</span>
    </span>
    {onShowAudioSettings && <button
      type="button"
      className="overlay-control-capture__settings"
      aria-label={I18N.settings.audioInputTitle}
      disabled={disabled}
      onClick={onShowAudioSettings}
    ><Icon name="gear" /></button>}
  </div>;
}
