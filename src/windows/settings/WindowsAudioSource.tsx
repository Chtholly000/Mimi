import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { audioSourceCopy, type AudioSourceSnapshot } from "../../lib/windowsAudioSource";
import { isTauri } from "../../lib/ipc";
import { useStore } from "../../lib/store";
import { SettingsRow, SettingsSelect } from "./SettingsPrimitives";


export function WindowsAudioSource() {
  const [snapshot, setSnapshot] = useState<AudioSourceSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const selected = useStore((state) => state.settings.windowsAudioSource) ?? "";
  const active = useStore((state) => state.session.isActive);
  const paused = useStore((state) => state.session.isPaused);
  const save = useStore((state) => state.saveSettings);
  const text = audioSourceCopy();
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const value = await invoke<AudioSourceSnapshot | null>("windows_audio_status");
        if (disposed) return;
        setSnapshot(value);
        setFailed(false);
        if (value) timer = setTimeout(() => void refresh(), 1000);
      } catch {
        if (!disposed) {
          setFailed(true);
          if (/Windows/i.test(navigator.userAgent)) {
            setSnapshot((value) => value ?? { devices: [], currentDevice: null, receivingSound: false, receivingAudioData: false });
            timer = setTimeout(() => void refresh(), 1000);
          }
        }
      }
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  if (!snapshot) return null;
  const missing = selected !== "" && !snapshot.devices.some((device) => device.id === selected);
  const current = snapshot.devices.find((device) => device.id === snapshot.currentDevice)?.name;
  const status = failed ? text.failed : missing || snapshot.devices.length === 0 ? text.missing
    : active && !paused ? snapshot.receivingSound ? text.receiving : snapshot.receivingAudioData ? text.silent : text.noData : text.idle;
  return (
    <SettingsRow label={text.title} description={active ? text.stop : text.help}>
      <span>
        <SettingsSelect label={text.title} value={selected} disabled={active || failed}
          onChange={(value) => void save({ windowsAudioSource: value })}
          options={[{ value: "", label: text.system }, ...snapshot.devices.map((device) => ({ value: device.id, label: device.name })),
            ...(missing ? [{ value: selected, label: text.unavailable }] : [])]} />
        <span className="settings-row__description" role="status">{current && active ? `${current} · ` : ""}{status}</span>
      </span>
    </SettingsRow>
  );
}
