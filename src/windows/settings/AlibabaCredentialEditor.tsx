import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../../components/Icon";
import { I18N } from "../../lib/i18n";
import { textTranslationForProfile } from "../../lib/providerCapabilities";
import { buildAlibabaTranslationCredentials, deepLXEndpointIsValid, emptyCredentialDraft } from "../../lib/providerCredentials";
import type { ProviderCredentialsInput, ServiceProfile, TextTranslation } from "../../lib/types";
import { DestructiveConfirmation } from "./DestructiveConfirmation";
import { InlineFeedback } from "./SettingsPrimitives";

/** Alibaba is the speech service; DeepLX is an optional text-only destination. */
export function AlibabaCredentialEditor({ profile, inputId, disabled, busy, feedback, onSave, onRequestDelete, onConfirmDelete, confirmingDelete, onCancelDelete }: {
  profile: ServiceProfile;
  inputId: string;
  disabled: boolean;
  busy: boolean;
  feedback: { tone: "success" | "error" | "info"; message: string } | null;
  onSave: (credentials: ProviderCredentialsInput) => Promise<unknown>;
  onRequestDelete: () => void;
  onConfirmDelete: () => Promise<unknown>;
  confirmingDelete: boolean;
  onCancelDelete: () => void;
}) {
  const savedTranslation = textTranslationForProfile(profile);
  const [translationDraft, setTranslationDraft] = useState<TextTranslation | null>(null);
  const translation = translationDraft ?? savedTranslation;
  const [draft, setDraft] = useState(emptyCredentialDraft);
  const [editingKey, setEditingKey] = useState(false);
  const [endpointInvalid, setEndpointInvalid] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const endpointRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const saved = profile.credentialState === "present";
  const credentials = buildAlibabaTranslationCredentials(profile, draft, translation);
  const dirty = !saved || editingKey || translation !== savedTranslation || !!draft.endpoint || !!draft.token;
  const endpointId = `${inputId}-endpoint`;
  const noteId = `${inputId}-storage-note`;

  useEffect(() => {
    if (endpointInvalid) {
      endpointRef.current?.focus({ preventScroll: true });
      endpointRef.current?.closest("label")?.scrollIntoView({ block: "center" });
    }
  }, [endpointInvalid]);
  useEffect(() => {
    if (feedback?.tone === "error") {
      feedbackRef.current?.scrollIntoView({ block: "center" });
      feedbackRef.current?.focus({ preventScroll: true });
    }
  }, [feedback]);

  const discard = () => {
    setDraft(emptyCredentialDraft());
    setTranslationDraft(null);
    setEditingKey(false);
    setEndpointInvalid(false);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!credentials) return;
    if (translation === "deepLX" && draft.endpoint && !deepLXEndpointIsValid(draft.endpoint)) {
      setAdvancedOpen(true);
      setEndpointInvalid(true);
      return;
    }
    setEndpointInvalid(false);
    if (!saved) setEditingKey(true);
    void onSave(credentials).then((result) => { if (result) discard(); });
  };

  return <div className="credential-panel" aria-busy={busy}>
    {savedTranslation === "deepLX" && <p className="settings-caption">{I18N.settings.deepLXChain}</p>}
    {profile.credentialState === "unavailable" && <p role="status" className="credential-unavailable">{I18N.settings.credentialUnavailableHelp}</p>}
    <form className="credential-form" onSubmit={submit}>
      {saved && !editingKey ? <span className="credential-panel__saved-actions">
        <button type="button" className="settings-button settings-button--quiet" disabled={disabled} onClick={() => setEditingKey(true)}>{I18N.settings.replaceCredentials}</button>
        <button type="button" className="settings-link settings-link--danger" disabled={disabled || confirmingDelete} onClick={onRequestDelete}>{I18N.settings.deleteCredentials}</button>
      </span> : <label className="settings-field" htmlFor={`${inputId}-apiKey`}>
        <span>{I18N.settings.apiKey}</span>
        <input id={`${inputId}-apiKey`} type="password" autoComplete="new-password" spellCheck={false} disabled={disabled} value={draft.apiKey} placeholder={I18N.settings.apiKeyPlaceholder} aria-describedby={noteId} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))} />
      </label>}
      <details className="settings-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
        <summary>{I18N.settings.advancedTranslation}</summary>
        <label className="settings-field" htmlFor={`${inputId}-text-translation`}>
          <span>{I18N.settings.textTranslationLabel}</span>
          <select id={`${inputId}-text-translation`} disabled={disabled} value={translation} onChange={(event) => { setTranslationDraft(event.target.value as TextTranslation); setEndpointInvalid(false); }}>
            <option value="followService">{I18N.settings.textTranslationFollow}</option>
            <option value="deepLX">DeepLX</option>
          </select>
        </label>
        {translation === "followService" ? <p className="settings-caption">{I18N.settings.textTranslationDefault}</p> : <>
          <p className="settings-caption">{I18N.settings.deepLXChain}</p>
          <p className="settings-caption">{I18N.settings.deepLXNote}</p>
          {saved && <p className="settings-caption">{I18N.settings.deepLXKeyReuse}</p>}
          {saved && savedTranslation === "deepLX" && <p className="settings-caption">{I18N.settings.deepLXSavedDestination}</p>}
          <div className="credential-form__fields">
            <label className="settings-field" htmlFor={endpointId}>
              <span>{I18N.settings.deepLXEndpoint}</span>
              <input ref={endpointRef} id={endpointId} type="text" autoComplete="off" spellCheck={false} disabled={disabled} value={draft.endpoint} placeholder="https://example.com/translate" aria-invalid={endpointInvalid || undefined} aria-describedby={endpointInvalid ? `${endpointId}-error ${noteId}` : noteId} onChange={(event) => { const value = event.target.value; setDraft((current) => ({ ...current, endpoint: value })); if (endpointInvalid) setEndpointInvalid(!deepLXEndpointIsValid(value)); }} />
              {endpointInvalid && <span id={`${endpointId}-error`} role="alert" className="credential-unavailable">{I18N.settings.deepLXEndpointInvalid}</span>}
            </label>
            <label className="settings-field" htmlFor={`${inputId}-token`}>
              <span>{I18N.settings.deepLXToken}</span>
              <input id={`${inputId}-token`} type="password" autoComplete="new-password" spellCheck={false} disabled={disabled} value={draft.token} placeholder="Bearer token" onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} />
            </label>
          </div>
        </>}
      </details>
      <p id={noteId} className="settings-caption"><Icon name="shield-check" /><span>{I18N.settings.credentialNote}</span></p>
      {feedback && <div ref={feedbackRef} tabIndex={-1}><InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback></div>}
      {dirty && <span className="credential-form__actions">
        {saved && <button type="button" className="settings-link" disabled={disabled} onClick={discard}>{I18N.settings.cancel}</button>}
        <button type="submit" className="settings-button settings-button--primary" disabled={disabled || !credentials || (editingKey && !draft.apiKey.trim())}>{saved ? I18N.settings.replaceCredentials : I18N.settings.saveAndUse}</button>
      </span>}
    </form>
    {confirmingDelete && <DestructiveConfirmation message={I18N.settings.deleteCredentialsConfirm} disabled={disabled} onCancel={onCancelDelete} onConfirm={() => { discard(); void onConfirmDelete(); }} />}
  </div>;
}
