import { useEffect, useRef, useState } from "react";
import { I18N } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { InlineFeedback, SettingsRow, SettingsSection } from "./SettingsPrimitives";
import { Switch } from "../../components/Switch";
import type { AudioInput, AudioSource } from "../../lib/types";
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
  const save = async (source: AudioSource, checked: boolean) => {
    // One source must remain selected. Enabling the other source means both,
    // never implicitly replaces the user's existing choice.
    if (disabled || inFlight.current || (!checked && selected === source)) return;
    const value: AudioInput = checked ? "both" : source === "system" ? "microphone" : "system";
    if (value === selected) return;
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
    <SettingsRow label={I18N.settings.audioInputSystem} description={I18N.settings.audioInputHelp}
      hint={requiresStop ? I18N.settings.audioInputRequiresStop : selected === "system" ? I18N.settings.audioInputAtLeastOne : undefined}>
      <Switch aria-label={I18N.settings.audioInputSystem} checked={selected !== "microphone"}
        disabled={disabled || selected === "system"} onChange={checked => void save("system", checked)} />
    </SettingsRow>
    <SettingsRow label={I18N.settings.audioInputMicrophone} description={I18N.settings.audioInputMicrophoneHelp}
      hint={requiresStop ? I18N.settings.audioInputRequiresStop : selected === "microphone" ? I18N.settings.audioInputAtLeastOne : undefined}>
      <Switch aria-label={I18N.settings.audioInputMicrophone} checked={selected !== "system"}
        disabled={disabled || selected === "microphone"} onChange={checked => void save("microphone", checked)} />
    </SettingsRow>
    {selected !== "microphone" && <WindowsAudioSource />}
    {failed && <InlineFeedback tone="error">{I18N.settings.audioInputSaveFailed}</InlineFeedback>}
  </SettingsSection>;
}
