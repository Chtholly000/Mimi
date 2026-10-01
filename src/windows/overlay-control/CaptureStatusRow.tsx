import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { capturePresentation, type CaptureStatus } from "../../lib/captureStatus";
import { isTauri } from "../../lib/ipc";
import { useStore } from "../../lib/store";
import { Icon } from "../../components/Icon";
import { effectiveUiLanguage } from "../../lib/i18n";
import { audioSourceCopy } from "../../lib/windowsAudioSource";

const systemOutputLabels = { zh: "系统输出", en: "System output", ja: "システム出力" };

/** Mounted only in the expanded panel. Names stay local to this window. */
export function CaptureStatusRow({ onShowAudioSettings, disabled = false }: {
  onShowAudioSettings?: () => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const active = useStore((state) => state.session.isActive);
  const paused = useStore((state) => state.session.isPaused);
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
  }, []);
  const text = capturePresentation(status, active, paused);
  // The system output is useful context, not a claim that a system mix is
  // bound to that device. Missing names never manufacture an Unknown row.
  const outputName = status?.systemOutputDeviceName;
  const language = effectiveUiLanguage();
  const source = outputName
    ? `${systemOutputLabels[language]}${language === "en" ? ": " : "："}${outputName}`
    : text.source;
  const windows = status?.kind === "windows_output" || /Windows|Win32/i.test(`${navigator.userAgent} ${navigator.platform}`);
  return <div className="overlay-control-capture" aria-label={text.title} title={`${source} · ${text.source} · ${text.observation}`}>
    <span className="overlay-control-capture__summary" role="status">
      <span className="overlay-control-capture__source">{source}</span>
      <span aria-hidden="true"> · </span>
      <span className="overlay-control-capture__observation">{text.observation}</span>
    </span>
    {windows && onShowAudioSettings && <button
      type="button"
      className="overlay-control-capture__settings"
      aria-label={audioSourceCopy().title}
      disabled={disabled}
      onClick={onShowAudioSettings}
    ><Icon name="gear" /></button>}
  </div>;
}
