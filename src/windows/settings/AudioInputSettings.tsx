import { useEffect, useRef, useState } from "react";
import { I18N } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { InlineFeedback, SettingsRow, SettingsSection, SettingsSelect } from "./SettingsPrimitives";
import { WindowsAudioSource } from "./WindowsAudioSource";

/** A saved choice only. Capture and microphone permission remain Start actions. */
export function AudioInputSettings() {
  const selected = useStore(state => state.settings.audioInput) ?? "system";
  const active = useStore(state => state.session.isActive);
  const paused = useStore(state => state.session.isPaused);
  const status = useStore(state => state.session.status.kind);
  const initialization = useStore(state => state.initializationStatus);
  const saveSettings = useStore(state => state.saveSettings);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const requiresStop = active || paused || status === "connecting" || status === "stopping";
  const disabled = requiresStop || busy || initialization !== "ready";
  const save = async (value: string) => {
    if (disabled || inFlight.current || value === selected || (value !== "system" && value !== "microphone")) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try { await saveSettings({ audioInput: value }); }
    catch { if (mounted.current) setFailed(true); }
    finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <SettingsSection id="audio-input" title={I18N.settings.audioInputTitle}>
    <SettingsRow label={I18N.settings.audioInputSource} description={I18N.settings.audioInputHelp}
      hint={requiresStop ? I18N.settings.audioInputRequiresStop : undefined}>
      <SettingsSelect label={I18N.settings.audioInputSource} value={selected} disabled={disabled}
        options={[{ value: "system", label: I18N.settings.audioInputSystem }, { value: "microphone", label: I18N.settings.audioInputMicrophone }]}
        onChange={value => void save(value)} />
    </SettingsRow>
    {selected === "system" && <WindowsAudioSource />}
    {failed && <InlineFeedback tone="error">{I18N.settings.audioInputSaveFailed}</InlineFeedback>}
  </SettingsSection>;
}
