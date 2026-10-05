import { useEffect, useRef, useState, type ComponentProps } from "react";
import { LanguageSelect } from "../../components/LanguageSelect";
import { I18N } from "../../lib/i18n";
import { languageActionErrorMessage } from "../../lib/connectionDiagnostics";
import { activeServiceProfile, sourceLanguagesForSettings } from "../../lib/providerCapabilities";
import { useStore } from "../../lib/store";
import { prepareAppleSpeechLanguage } from "../../lib/ipc";
import { SOURCE_LANGUAGE_DISPLAY_NAMES, type AppleSpeechSupport, type SettingsSnapshot, type SourceLanguage } from "../../lib/types";
import { AlibabaCredentialEditor } from "./AlibabaCredentialEditor";
import { InlineFeedback, SettingsRow } from "./SettingsPrimitives";
import { SettingsHelp } from "./SettingsHelp";
import { useSettingsToast } from "./useSettingsToast";

type Props = ComponentProps<typeof AlibabaCredentialEditor> & {
  support: AppleSpeechSupport | null;
  settings: SettingsSnapshot;
  requiresStop?: boolean;
  loading: boolean;
  failed: boolean;
  sourceLanguage: SourceLanguage;
  onRetry: () => Promise<void>;
  onPrepared: (support: AppleSpeechSupport) => void;
  onBusyChange: (busy: boolean) => void;
};

export function AppleSpeechSettings({ support, settings, requiresStop = false, loading, failed, sourceLanguage, onRetry, onPrepared, onBusyChange, ...editor }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const currentSettings = useRef(settings);
  useEffect(() => { currentSettings.current = settings; }, [settings]);
  const saveSettings = useStore(state => state.saveSettings);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const { beginToast } = useSettingsToast();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const languages = support?.languages ?? [];
  const active = settings.activeProfileId === editor.profile.id && editor.profile.provider === "appleSpeech";
  const currentSource = active ? settings.sourceLanguage : sourceLanguage;
  const language = languages.find(item => item.sourceLanguage === (selected ?? currentSource)) ?? languages[0];
  const routeAllowsLanguage = active && !!language && sourceLanguagesForSettings(settings).includes(language.sourceLanguage);
  const languageInUse = routeAllowsLanguage && language?.sourceLanguage === currentSource;
  const canUseLanguage = support?.available && language?.installed && routeAllowsLanguage && !languageInUse;
  const busy = preparing || savingLanguage;
  const disabled = editor.disabled || editor.busy || busy || requiresStop;
  const prepare = async () => {
    if (!language || disabled || inFlight.current || language.installed) return;
    inFlight.current = true;
    setPreparing(true);
    setPrepareFailed(false);
    onBusyChange(true);
    const notify = beginToast();
    try {
      const result = await prepareAppleSpeechLanguage(language.sourceLanguage);
      if (!mounted.current) return;
      onPrepared(result);
      if (!result.languages.some(item => item.sourceLanguage === language.sourceLanguage && item.installed)) throw new Error("resources-not-installed");
      notify(I18N.settings.appleSpeechPrepared);
    } catch {
      if (mounted.current) {
        setPrepareFailed(true);
        notify(I18N.settings.appleSpeechPrepareFailed, true);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setPreparing(false); onBusyChange(false); }
    }
  };
  const applyLanguage = async () => {
    if (!language || !canUseLanguage || disabled || inFlight.current) return;
    inFlight.current = true;
    setSavingLanguage(true);
    onBusyChange(true);
    const notify = beginToast();
    try {
      // The resource editor can show an inactive profile. A settings draft
      // always belongs to the active one, including after another window switches it.
      const current = currentSettings.current;
      const profile = activeServiceProfile(current);
      if (profile?.id !== editor.profile.id || profile.provider !== "appleSpeech") throw new Error("source_switch_profile");
      if (!sourceLanguagesForSettings(current).includes(language.sourceLanguage)) throw new Error("source_switch_unsupported");
      await saveSettings({ sourceLanguage: language.sourceLanguage });
      if (mounted.current && currentSettings.current.activeProfileId === editor.profile.id) notify(I18N.settings.appleSpeechLanguageSelected);
    } catch (error) {
      if (mounted.current) notify(languageActionErrorMessage(error, I18N.settings.languageSaveFailed), true);
    } finally {
      inFlight.current = false;
      if (mounted.current) { setSavingLanguage(false); onBusyChange(false); }
    }
  };
  return <div className="credential-panel apple-speech-settings">
    <section id="apple-speech-resources" tabIndex={-1} className="service-stage" aria-labelledby={`${editor.inputId}-apple-title`} aria-busy={loading || busy}>
      <header className="service-stage__heading">
        <div className="service-stage__name-help"><h3 id={`${editor.inputId}-apple-title`}>{I18N.settings.speechRecognition}</h3><SettingsHelp text={I18N.settings.appleSpeechDescription} label={I18N.settings.helpLabel} /></div>
        <div className="service-stage__actions">{typeof editor.connectionCheck === "function" ? editor.connectionCheck() : editor.connectionCheck}</div>
      </header>
      <p className="settings-row__label">{I18N.settings.appleSpeechSetupSteps}</p>
      {requiresStop && <InlineFeedback tone="info">{I18N.settings.languageChangeRequiresStop}</InlineFeedback>}
      {loading ? <InlineFeedback tone="info">{I18N.settings.appleSpeechLoading}</InlineFeedback>
        : failed ? <InlineFeedback tone="error">{I18N.settings.appleSpeechLoadFailed} <button type="button" className="settings-link" disabled={disabled} onClick={() => void onRetry()}>{I18N.settings.retryLoadingSettings}</button></InlineFeedback>
        : !support?.available || !language ? <InlineFeedback tone="info">{I18N.settings.appleSpeechUnavailable}</InlineFeedback>
        : <>
          <SettingsRow label={I18N.settings.appleSpeechResources} description={I18N.settings.appleSpeechResourcesHelp}
            feedback={preparing ? <InlineFeedback tone="info">{I18N.settings.appleSpeechPreparing}</InlineFeedback> : prepareFailed ? <InlineFeedback tone="error">{I18N.settings.appleSpeechPrepareFailed}</InlineFeedback> : <InlineFeedback tone={language.installed ? "success" : "info"}>{language.locale} · {language.installed ? I18N.settings.appleSpeechInstalled : I18N.settings.appleSpeechNotInstalled}</InlineFeedback>}>
            <LanguageSelect label={I18N.settings.appleSpeechResources} value={language.sourceLanguage} disabled={disabled}
              options={languages.map(item => ({ value: item.sourceLanguage, label: SOURCE_LANGUAGE_DISPLAY_NAMES[item.sourceLanguage] }))}
              onChange={value => { setSelected(value); setPrepareFailed(false); }} />
          </SettingsRow>
          {!active ? <InlineFeedback tone="info">{I18N.settings.appleSpeechSelectProfileFirst}</InlineFeedback>
            : language.installed && !routeAllowsLanguage ? <InlineFeedback tone="info">{I18N.settings.appleSpeechLanguageRouteUnsupported}</InlineFeedback>
            : languageInUse && language.installed && !requiresStop ? <InlineFeedback tone="info">{I18N.settings.appleSpeechLanguageInUse}</InlineFeedback> : null}
          {!language.installed && <div className="credential-form__actions"><button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={disabled} onClick={() => void prepare()}>{preparing ? I18N.settings.appleSpeechPreparing : I18N.settings.appleSpeechPrepare}</button></div>}
          {canUseLanguage && <div className="credential-form__actions"><button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={disabled} onClick={() => void applyLanguage()}>{I18N.settings.appleSpeechUseLanguage}</button></div>}
        </>}
    </section>
    <AlibabaCredentialEditor {...editor} textOnly connectionCheck={undefined} disabled={disabled} />
  </div>;
}
