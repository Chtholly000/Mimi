import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import { I18N } from "../../lib/i18n";
import { sourceLanguagesForSettings, targetLanguagesForSettings } from "../../lib/providerCapabilities";
import { useStore } from "../../lib/store";
import { SOURCE_LANGUAGE_DISPLAY_NAMES, TARGET_LANGUAGE_DISPLAY_NAMES, type SettingsDraft, type SettingsSnapshot } from "../../lib/types";
import { InlineFeedback, SettingsRow } from "./SettingsPrimitives";
import { WindowsAudioSource } from "./WindowsAudioSource";

/** Explicit language preferences belong to the active service. Unlike the
 * overlay's source quick switch, choosing Chinese here preserves the target. */
export function ProfileLanguageSettings({ settings, disabled, requiresStop = false }: { settings: SettingsSnapshot; disabled: boolean; requiresStop?: boolean }) {
  const saveSettings = useStore(state => state.saveSettings);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"saved" | "failed" | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sources = sourceLanguagesForSettings(settings);
  const targets = targetLanguagesForSettings(settings);
  const save = async (draft: SettingsDraft) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await saveSettings(draft);
      if (mounted.current) setFeedback("saved");
    } catch {
      if (mounted.current) setFeedback("failed");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <section id="translation-languages" className="profile-language-settings" aria-labelledby="translation-languages-title" aria-busy={busy}>
    <h3 id="translation-languages-title">{I18N.settings.subtitleLanguages}</h3>
    <WindowsAudioSource />
    <SettingsRow label={I18N.settings.sourceLanguage} align="start">
      <LanguageChoices label={I18N.settings.sourceLanguage} value={settings.sourceLanguage} disabled={disabled || busy || sources.length === 1}
        options={sources.map(value => ({ value, label: SOURCE_LANGUAGE_DISPLAY_NAMES[value] }))}
        onChange={value => { const sourceLanguage = sources.find(language => language === value); if (sourceLanguage) void save({ sourceLanguage }); }} />
    </SettingsRow>
    <SettingsRow label={I18N.settings.translateTo} align="start">
      <LanguageChoices label={I18N.settings.translateTo} value={settings.targetLanguage} disabled={disabled || busy || targets.length === 1}
        options={targets.map(value => ({ value, label: TARGET_LANGUAGE_DISPLAY_NAMES[value] }))}
        onChange={value => { const targetLanguage = targets.find(language => language === value); if (targetLanguage) void save({ targetLanguage }); }} />
    </SettingsRow>
    {requiresStop && <p className="settings-caption">{I18N.settings.languageChangeRequiresStop}</p>}
    {feedback && <InlineFeedback tone={feedback === "saved" ? "success" : "error"}>{feedback === "saved" ? I18N.settings.languageSaved : I18N.settings.languageSaveFailed}</InlineFeedback>}
  </section>;
}

function LanguageChoices({ label, value, options, disabled, onChange }: {
  label: string; value: string; options: readonly { value: string; label: string }[]; disabled: boolean; onChange: (value: string) => void;
}) {
  if (options.length > 6) return <Select label={label} value={value} options={options} disabled={disabled} onChange={onChange}
    searchLabel={I18N.settings.searchLanguages} emptyMessage={I18N.settings.noMatchingLanguages} />;
  return <div className="profile-language-choices" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" className="profile-language-choice" aria-pressed={option.value === value}
      disabled={disabled} onClick={() => { if (option.value !== value) onChange(option.value); }}>
      <span>{option.label}</span>{option.value === value && <Icon name="checkmark" />}
    </button>)}
  </div>;
}
