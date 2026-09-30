import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { capturePresentation, type CaptureStatus } from "../../lib/captureStatus";
import { isTauri } from "../../lib/ipc";
import { useStore } from "../../lib/store";

/** Mounted only in the expanded panel. Names stay local to this window. */
export function CaptureStatusRow() {
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
  return <div className="overlay-control-capture" aria-label={text.title}>
    <span>{text.title} · {text.source}</span>
    <strong title={text.device}>{text.device}</strong>
    <span role="status">{text.observation}</span>
  </div>;
}
