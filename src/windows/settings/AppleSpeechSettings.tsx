import { useEffect, useRef, useState, type ComponentProps } from "react";
import { LanguageSelect } from "../../components/LanguageSelect";
import { I18N } from "../../lib/i18n";
import { prepareAppleSpeechLanguage } from "../../lib/ipc";
import { SOURCE_LANGUAGE_DISPLAY_NAMES, type AppleSpeechSupport, type SourceLanguage } from "../../lib/types";
import { AlibabaCredentialEditor } from "./AlibabaCredentialEditor";
import { InlineFeedback, SettingsRow } from "./SettingsPrimitives";
import { SettingsHelp } from "./SettingsHelp";
import { useSettingsToast } from "./useSettingsToast";

type Props = ComponentProps<typeof AlibabaCredentialEditor> & {
  support: AppleSpeechSupport | null;
  loading: boolean;
  failed: boolean;
  sourceLanguage: SourceLanguage;
  onRetry: () => Promise<void>;
  onPrepared: (support: AppleSpeechSupport) => void;
  onBusyChange: (busy: boolean) => void;
};

export function AppleSpeechSettings({ support, loading, failed, sourceLanguage, onRetry, onPrepared, onBusyChange, ...editor }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const { beginToast } = useSettingsToast();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const languages = support?.languages ?? [];
  const language = languages.find(item => item.sourceLanguage === (selected ?? sourceLanguage)) ?? languages[0];
  const prepare = async () => {
    if (!language || editor.disabled || inFlight.current || language.installed) return;
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
  return <div className="credential-panel apple-speech-settings">
    <section className="service-stage" aria-labelledby={`${editor.inputId}-apple-title`} aria-busy={loading || preparing}>
      <header className="service-stage__heading">
        <div className="service-stage__name-help"><h3 id={`${editor.inputId}-apple-title`}>{I18N.settings.speechRecognition}</h3><SettingsHelp text={I18N.settings.appleSpeechDescription} label={I18N.settings.helpLabel} /></div>
        <div className="service-stage__actions">{typeof editor.connectionCheck === "function" ? editor.connectionCheck() : editor.connectionCheck}</div>
      </header>
      {loading ? <InlineFeedback tone="info">{I18N.settings.appleSpeechLoading}</InlineFeedback>
        : failed ? <InlineFeedback tone="error">{I18N.settings.appleSpeechLoadFailed} <button type="button" className="settings-link" disabled={editor.disabled} onClick={() => void onRetry()}>{I18N.settings.retryLoadingSettings}</button></InlineFeedback>
        : !support?.available || !language ? <InlineFeedback tone="info">{I18N.settings.appleSpeechUnavailable}</InlineFeedback>
        : <>
          <SettingsRow label={I18N.settings.appleSpeechResources} description={I18N.settings.appleSpeechResourcesHelp}
            feedback={preparing ? <InlineFeedback tone="info">{I18N.settings.appleSpeechPreparing}</InlineFeedback> : prepareFailed ? <InlineFeedback tone="error">{I18N.settings.appleSpeechPrepareFailed}</InlineFeedback> : <InlineFeedback tone={language.installed ? "success" : "info"}>{language.locale} · {language.installed ? I18N.settings.appleSpeechInstalled : I18N.settings.appleSpeechNotInstalled}</InlineFeedback>}>
            <LanguageSelect label={I18N.settings.appleSpeechResources} value={language.sourceLanguage} disabled={editor.disabled || preparing}
              options={languages.map(item => ({ value: item.sourceLanguage, label: SOURCE_LANGUAGE_DISPLAY_NAMES[item.sourceLanguage] }))}
              onChange={value => { setSelected(value); setPrepareFailed(false); }} />
          </SettingsRow>
          {!language.installed && <div className="credential-form__actions"><button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={editor.disabled || preparing} onClick={() => void prepare()}>{preparing ? I18N.settings.appleSpeechPreparing : I18N.settings.appleSpeechPrepare}</button></div>}
        </>}
    </section>
    <AlibabaCredentialEditor {...editor} textOnly connectionCheck={undefined} disabled={editor.disabled || preparing} />
  </div>;
}
