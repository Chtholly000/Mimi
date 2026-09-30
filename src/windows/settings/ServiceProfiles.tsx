import { testProfileConnection } from "../../lib/ipc";
import { diagnosticCopy, connectionDiagnosticMessage, profileErrorMessage } from "../../lib/connectionDiagnostics";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "../../components/Icon";
import { I18N, providerDisplayName } from "../../lib/i18n";
import { SERVICE_PROVIDERS, subtitlePreferencesChanged } from "../../lib/providerCapabilities";
import {
  buildProviderCredentials,
  credentialEditorStateAfterDeleteRequest,
  credentialFieldsForProvider,
  emptyCredentialDraft,
  type CredentialDraft,
  type CredentialFieldName,
} from "../../lib/providerCredentials";
import { useStore } from "../../lib/store";
import type {
  CredentialState,
  ProviderCredentialsInput,
  ServiceProfile,
  ServiceProvider,
  SettingsSnapshot,
} from "../../lib/types";
import { InlineFeedback, SettingsSection } from "./SettingsPrimitives";

import { saveAndSelectProfile } from "./saveAndSelectProfile";

type Feedback = { tone: "success" | "error" | "info"; message: string };
type PendingAction = "create" | "rename" | "select" | "delete" | "save-key" | "delete-key" | "test-connection" | null;
type PendingConfirmation =
  | { kind: "profile"; profileId: string; name: string }
  | { kind: "credential"; profileId: string }
  | null;

export function ServiceProfiles({
  settings,
  sessionIsActive,
}: {
  settings: SettingsSnapshot;
  sessionIsActive: boolean;
}) {
  const createProfile = useStore((state) => state.createProfile);
  const updateProfile = useStore((state) => state.updateProfile);
  const selectProfile = useStore((state) => state.selectProfile);
  const deleteProfile = useStore((state) => state.deleteProfile);
  const saveProfileCredentials = useStore((state) => state.saveProfileCredentials);
  const deleteProfileAPIKey = useStore((state) => state.deleteProfileAPIKey);

  const activeProfile =
    settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
    settings.profiles[0];
  const [selectedProfileId, setSelectedProfileId] = useState(
    activeProfile?.id ?? settings.activeProfileId,
  );
  const [showsEditor, setShowsEditor] = useState(false);
  const [showsProviderPicker, setShowsProviderPicker] = useState(false);
  const [nameDraft, setNameDraft] = useState(activeProfile?.name ?? "");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [renderedProfile, setRenderedProfile] = useState({
    id: activeProfile?.id,
    name: activeProfile?.name,
  });

  const selectedProfile = useMemo(
    () => settings.profiles.find((profile) => profile.id === selectedProfileId) ?? activeProfile,
    [activeProfile, selectedProfileId, settings.profiles],
  );

  if (
    selectedProfile &&
    (selectedProfile.id !== renderedProfile.id || selectedProfile.name !== renderedProfile.name)
  ) {
    setRenderedProfile({
      id: selectedProfile.id,
      name: selectedProfile.name,
    });
    setNameDraft(selectedProfile.name);
    setFeedback(null);
    setPendingConfirmation(null);
  }

  const mutationsDisabled = sessionIsActive || pendingAction !== null;
  const atProfileLimit = settings.profiles.length >= 20;

  const perform = async (
    action: Exclude<PendingAction, null>,
    operation: () => Promise<SettingsSnapshot>,
    successFeedback: string | ((snapshot: SettingsSnapshot) => Feedback),
  ): Promise<SettingsSnapshot | null> => {
    setPendingAction(action);
    setFeedback(null);
    try {
      const snapshot = await operation();
      setFeedback(
        typeof successFeedback === "string"
          ? { tone: "success", message: successFeedback }
          : successFeedback(snapshot),
      );
      return snapshot;
    } catch (error) {
      setFeedback({
        tone: "error",
        message: profileErrorMessage(error),
      });
      return null;
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreate = async (provider: ServiceProvider) => {
    const previousIds = new Set(settings.profiles.map((profile) => profile.id));
    const name = providerDisplayName(provider);
    const snapshot = await perform(
      "create",
      () => createProfile(provider, name),
      I18N.settings.profileCreated,
    );
    if (!snapshot) return;
    const created = snapshot.profiles.find((profile) => !previousIds.has(profile.id));
    if (created) {
      setSelectedProfileId(created.id);
      setShowsEditor(true);
    }
    setShowsProviderPicker(false);
  };

  const handleRename = async () => {
    if (!selectedProfile) return;
    const name = nameDraft.trim();
    if (!name || name === selectedProfile.name) return;
    await perform(
      "rename",
      () => updateProfile(selectedProfile.id, name),
      I18N.settings.profileNameSaved,
    );
  };

  const handleSelect = async (profileId: string) => {
    if (profileId === settings.activeProfileId) return;
    setPendingConfirmation(null);
    setSelectedProfileId(profileId);
    await perform(
      "select",
      () => selectProfile(profileId),
      (snapshot) =>
        subtitlePreferencesChanged(settings, snapshot)
          ? {
              tone: "info",
              message: I18N.settings.profileSelectedWithAdjustments,
            }
          : {
              tone: "success",
              message: I18N.settings.profileSelected,
            },
    );
  };

  const requestProfileDelete = () => {
    if (!selectedProfile || settings.profiles.length <= 1) return;
    setPendingConfirmation({
      kind: "profile",
      profileId: selectedProfile.id,
      name: selectedProfile.name,
    });
  };

  const confirmProfileDelete = async () => {
    if (
      !selectedProfile ||
      settings.profiles.length <= 1 ||
      pendingConfirmation?.kind !== "profile" ||
      pendingConfirmation.profileId !== selectedProfile.id
    )
      return;
    setPendingConfirmation(null);
    const snapshot = await perform(
      "delete",
      () => deleteProfile(selectedProfile.id),
      I18N.settings.profileDeleted,
    );
    if (snapshot) {
      setSelectedProfileId(snapshot.activeProfileId);
      setShowsEditor(false);
    }
  };

  const handleSaveCredential = async (profileId: string, credentials: ProviderCredentialsInput) => {
    setPendingConfirmation(null);
    return perform(
      "save-key",
      () => saveAndSelectProfile(profileId, credentials, saveProfileCredentials, selectProfile),
      (snapshot) => ({
        tone: subtitlePreferencesChanged(settings, snapshot) ? "info" : "success",
        message: subtitlePreferencesChanged(settings, snapshot)
          ? I18N.settings.profileSelectedWithAdjustments
          : I18N.settings.credentialsSaved,
      }),
    );
  };

  const requestCredentialDelete = (profileId: string) => {
    setPendingConfirmation({ kind: "credential", profileId });
  };

  const confirmCredentialDelete = async (profileId: string) => {
    if (pendingConfirmation?.kind !== "credential" || pendingConfirmation.profileId !== profileId)
      return;
    setPendingConfirmation(null);
    await perform(
      "delete-key",
      () => deleteProfileAPIKey(profileId),
      I18N.settings.credentialsDeleted,
    );
  };

  const openEditor = (profileId: string) => {
    setSelectedProfileId(profileId);
    setPendingConfirmation(null);
    setFeedback(null);
    setShowsEditor(true);
  };

  return (
    <SettingsSection id="service-profiles" title={I18N.settings.serviceProfilesTitle} hideHeading>
      {sessionIsActive && (
        <InlineFeedback tone="info" icon="lock">
          {I18N.settings.profileMutationsLocked}
        </InlineFeedback>
      )}
      {showsProviderPicker ? (
        <ProviderPicker
          disabled={mutationsDisabled}
          onChoose={(provider) => void handleCreate(provider)}
          onCancel={() => setShowsProviderPicker(false)}
        />
      ) : showsEditor && selectedProfile ? (
        <div className="service-detail">
          <button
            type="button"
            className="settings-link service-back"
            disabled={pendingAction !== null}
            onClick={() => {
              setShowsEditor(false);
              setPendingConfirmation(null);
              setFeedback(null);
            }}
          >
            <Icon name="chevron-left" />
            {I18N.settings.backToServices}
          </button>
          <div className="service-detail__identity">
            <ProviderMark provider={selectedProfile.provider} />
            <span>
              <h2>{selectedProfile.name}</h2>
              <small>{providerDescription(selectedProfile.provider)}</small>
            </span>
          </div>
          <div className="service-detail__status">
            <CredentialBadge state={selectedProfile.credentialState} />
            {selectedProfile.id === settings.activeProfileId && (
              <span className="profile-active-badge">
                <Icon name="checkmark" />
                {I18N.settings.activeProfile}
              </span>
            )}
          </div>
          <div className="credential-panel">
            <button
              type="button"
              className="settings-button settings-button--quiet"
              disabled={mutationsDisabled}
              onClick={() => {
                setPendingAction("test-connection");
                setFeedback(null);
                void testProfileConnection(selectedProfile.id)
                  .then((result) => {
                    setFeedback({ tone: "info", message: connectionDiagnosticMessage(result) });
                  })
                  .catch((error: unknown) => {
                    setFeedback({ tone: "error", message: profileErrorMessage(error) });
                  })
                  .finally(() => setPendingAction(null));
              }}
            >
              {pendingAction === "test-connection" ? diagnosticCopy().testing : diagnosticCopy().test}
            </button>
            <small>{diagnosticCopy().note}</small>
            <details>
              <summary>{diagnosticCopy().help}</summary>
              <p>{diagnosticCopy().details}</p>
            </details>
          </div>
          <CredentialEditor
            key={selectedProfile.id}
            profile={selectedProfile}
            inputId={`profile-api-key-${selectedProfile.id}`}
            disabled={mutationsDisabled}
            busy={pendingAction === "save-key" || pendingAction === "delete-key"}
            onSave={(replacement) => handleSaveCredential(selectedProfile.id, replacement)}
            onRequestDelete={() => requestCredentialDelete(selectedProfile.id)}
            onConfirmDelete={() => confirmCredentialDelete(selectedProfile.id)}
            confirmingDelete={
              pendingConfirmation?.kind === "credential" &&
              pendingConfirmation.profileId === selectedProfile.id
            }
            onCancelDelete={() => setPendingConfirmation(null)}
          />
          {selectedProfile.credentialState === "present" &&
            selectedProfile.id !== settings.activeProfileId && (
              <button
                type="button"
                className="settings-button settings-button--primary"
                disabled={mutationsDisabled}
                onClick={() => void handleSelect(selectedProfile.id)}
              >
                <Icon name="checkmark" />
                {I18N.settings.useProfile}
              </button>
            )}
          <details className="service-options">
            <summary>
              {I18N.settings.profileOptions}
              <Icon name="chevron-down" />
            </summary>
            <form
              className="profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRename();
              }}
            >
              <div className="settings-field">
                <label htmlFor="profile-name">{I18N.settings.profileName}</label>
                <span className="settings-field__inline">
                  <input
                    id="profile-name"
                    value={nameDraft}
                    maxLength={64}
                    disabled={mutationsDisabled}
                    placeholder={I18N.settings.profileNamePlaceholder}
                    onChange={(event) => {
                      setNameDraft(event.target.value);
                      setFeedback(null);
                    }}
                  />
                  <button
                    type="submit"
                    className="settings-button settings-button--quiet"
                    disabled={
                      mutationsDisabled ||
                      !nameDraft.trim() ||
                      nameDraft.trim() === selectedProfile.name
                    }
                  >
                    {I18N.settings.saveName}
                  </button>
                </span>
              </div>
            </form>
            <button
              type="button"
              className="settings-link settings-link--danger"
              disabled={mutationsDisabled || settings.profiles.length <= 1}
              onClick={requestProfileDelete}
            >
              <Icon name="trash" />
              {I18N.settings.deleteProfile}
            </button>
            {pendingConfirmation?.kind === "profile" &&
              pendingConfirmation.profileId === selectedProfile.id && (
                <DestructiveConfirmation
                  message={I18N.settings.deleteProfileConfirm(pendingConfirmation.name)}
                  disabled={mutationsDisabled}
                  onCancel={() => setPendingConfirmation(null)}
                  onConfirm={() => void confirmProfileDelete()}
                />
              )}
          </details>
        </div>
      ) : (
        <div className="services-home">
          <div className="services-toolbar">
            <span>{I18N.settings.profileCount(settings.profiles.length)}</span>
            <button
              type="button"
              className="settings-button settings-button--compact settings-button--quiet"
              disabled={mutationsDisabled || atProfileLimit}
              onClick={() => setShowsProviderPicker(true)}
            >
              <Icon name="plus" />
              {I18N.settings.addProfile}
            </button>
          </div>
          <div className="service-rows" aria-label={I18N.settings.serviceProfilesTitle}>
            {settings.profiles.map((profile) => (
              <div
                className="service-row"
                key={profile.id}
                data-active={profile.id === settings.activeProfileId}
              >
                <button
                  type="button"
                  className="service-row__main"
                  disabled={mutationsDisabled}
                  onClick={() => {
                    if (
                      profile.credentialState === "present" &&
                      profile.id !== settings.activeProfileId
                    )
                      void handleSelect(profile.id);
                    else openEditor(profile.id);
                  }}
                  aria-label={`${profile.name}: ${profile.credentialState === "present" && profile.id !== settings.activeProfileId ? I18N.settings.useProfile : I18N.settings.editProfile}`}
                >
                  <ProviderMark provider={profile.provider} />
                  <span className="service-row__copy">
                    <strong>{profile.name}</strong>
                    <small>{providerDisplayName(profile.provider)}</small>
                  </span>
                  <span className="service-row__state">
                    <CredentialBadge state={profile.credentialState} />
                    {profile.id === settings.activeProfileId && (
                      <span className="profile-active-badge">
                        <Icon name="checkmark" />
                        {I18N.settings.activeProfile}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  className="service-row__edit"
                  disabled={mutationsDisabled}
                  aria-label={`${I18N.settings.editProfile}: ${profile.name}`}
                  onClick={() => openEditor(profile.id)}
                >
                  <Icon name="chevron-right" />
                </button>
              </div>
            ))}
          </div>
          <p className="settings-caption services-hint">
            <Icon name="shield-check" />
            {I18N.settings.servicesHint}
          </p>
          {atProfileLimit && (
            <InlineFeedback tone="info">{I18N.settings.profileLimitReached}</InlineFeedback>
          )}
        </div>
      )}
      {feedback && <InlineFeedback tone={feedback.tone}>{feedback.message}</InlineFeedback>}
    </SettingsSection>
  );
}

function CredentialEditor({
  profile,
  inputId,
  disabled,
  busy,
  onSave,
  onRequestDelete,
  onConfirmDelete,
  confirmingDelete,
  onCancelDelete,
}: {
  profile: ServiceProfile;
  inputId: string;
  disabled: boolean;
  busy: boolean;
  onSave: (credentials: ProviderCredentialsInput) => Promise<unknown>;
  onRequestDelete: () => void;
  onConfirmDelete: () => Promise<unknown>;
  confirmingDelete: boolean;
  onCancelDelete: () => void;
}) {
  const [draft, setDraft] = useState<CredentialDraft>(emptyCredentialDraft);
  const [editingSavedCredential, setEditingSavedCredential] = useState(false);
  const noteId = `${inputId}-storage-note`;
  const credentials = buildProviderCredentials(profile.provider, draft);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentials) return;
    // Discard plaintext before secure storage I/O and never restore it after a
    // failure. The editor remains a write-only credential surface.
    setDraft(emptyCredentialDraft());
    void onSave(credentials).then((saved) => {
      if (saved) setEditingSavedCredential(false);
    });
  };

  const handleConfirmDelete = () => {
    const next = credentialEditorStateAfterDeleteRequest({ draft, editingSavedCredential }, true);
    // Clear plaintext before the async keychain deletion starts. A failure
    // must never restore a replacement secret to WebView state or the DOM.
    setDraft(next.draft);
    setEditingSavedCredential(next.editingSavedCredential);
    void onConfirmDelete();
  };

  if (profile.credentialState === "present" && !editingSavedCredential) {
    return (
      <div className="credential-panel credential-panel--saved">
        <span className="credential-panel__saved-actions">
          <button
            type="button"
            className="settings-button settings-button--quiet"
            disabled={disabled}
            onClick={() => setEditingSavedCredential(true)}
          >
            {I18N.settings.replaceCredentials}
          </button>
          <button
            type="button"
            className="settings-link settings-link--danger"
            disabled={disabled || confirmingDelete}
            onClick={onRequestDelete}
          >
            {I18N.settings.deleteCredentials}
          </button>
        </span>
        {confirmingDelete && (
          <DestructiveConfirmation
            message={I18N.settings.deleteCredentialsConfirm}
            disabled={disabled}
            onCancel={onCancelDelete}
            onConfirm={handleConfirmDelete}
          />
        )}
      </div>
    );
  }

  return (
    <div className="credential-panel" aria-busy={busy}>
      <div className="credential-panel__heading">
        <span>
          <span className="credential-panel__label">{I18N.settings.credentials}</span>
        </span>
        {profile.credentialState === "present" && (
          <button
            type="button"
            className="settings-link settings-link--danger"
            disabled={disabled || confirmingDelete}
            onClick={onRequestDelete}
          >
            {I18N.settings.deleteCredentials}
          </button>
        )}
      </div>

      {profile.credentialState === "unavailable" && (
        <p className="credential-unavailable" role="status">
          {diagnosticCopy().storage}
        </p>
      )}

      {confirmingDelete && (
        <DestructiveConfirmation
          message={I18N.settings.deleteCredentialsConfirm}
          disabled={disabled}
          onCancel={onCancelDelete}
          onConfirm={handleConfirmDelete}
        />
      )}

      {profile.provider === "deepLX" && <p className="settings-caption">{I18N.settings.deepLXNote}</p>}
      <form className="credential-form" onSubmit={handleSubmit}>
        <div className="credential-form__fields">
          {credentialFieldsForProvider(profile.provider).map((field) => {
            const copy = credentialFieldCopy(field, profile.provider);
            const fieldId = `${inputId}-${field}`;
            return (
              <label className="settings-field" htmlFor={fieldId} key={field}>
                <span>{copy.label}</span>
                <input
                  id={fieldId}
                  type={copy.secret ? "password" : "text"}
                  inputMode={field === "appId" ? "numeric" : undefined}
                  value={draft[field]}
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-describedby={noteId}
                  disabled={disabled}
                  placeholder={copy.placeholder}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              </label>
            );
          })}
        </div>
        <p id={noteId} className="settings-caption">
          <Icon name="shield-check" />
          <span>{I18N.settings.credentialNote}</span>
        </p>
        <span className="credential-form__actions">
          {profile.credentialState === "present" && (
            <button
              type="button"
              className="settings-link"
              disabled={disabled}
              onClick={() => {
                setDraft(emptyCredentialDraft());
                setEditingSavedCredential(false);
              }}
            >
              {I18N.settings.cancel}
            </button>
          )}
          <button
            type="submit"
            className="settings-button settings-button--primary"
            disabled={disabled || !credentials}
          >
            {profile.credentialState === "present"
              ? I18N.settings.replaceCredentials
              : I18N.settings.saveAndUse}
          </button>
        </span>
      </form>
    </div>
  );
}

function credentialFieldCopy(field: CredentialFieldName, provider: ServiceProvider): {
  label: string;
  placeholder: string;
  secret: boolean;
} {
  switch (field) {
    case "asrApiKey":
      return { label: I18N.settings.asrApiKey, placeholder: I18N.settings.apiKeyPlaceholder, secret: true };
    case "token":
      return { label: I18N.settings.deepLXToken, placeholder: "Bearer token", secret: true };
    case "apiKey":
      return {
        label: I18N.settings.apiKey,
        placeholder: I18N.settings.apiKeyPlaceholder,
        secret: true,
      };
    case "endpoint":
      return {
        label: provider === "deepLX" ? I18N.settings.deepLXEndpoint : I18N.settings.azureEndpoint,
        placeholder: provider === "deepLX" ? "https://example.com/translate" : I18N.settings.azureEndpointPlaceholder,
        secret: false,
      };
    case "deployment":
      return {
        label: I18N.settings.deploymentName,
        placeholder: I18N.settings.deploymentNamePlaceholder,
        secret: false,
      };
    case "transcriptionDeployment":
      return {
        label: I18N.settings.transcriptionDeploymentName,
        placeholder: I18N.settings.transcriptionDeploymentNamePlaceholder,
        secret: false,
      };
    case "appId":
      return {
        label: I18N.settings.appId,
        placeholder: I18N.settings.appIdPlaceholder,
        secret: false,
      };
    case "secretId":
      return {
        label: I18N.settings.secretId,
        placeholder: I18N.settings.secretIdPlaceholder,
        secret: true,
      };
    case "secretKey":
      return {
        label: I18N.settings.secretKey,
        placeholder: I18N.settings.secretKeyPlaceholder,
        secret: true,
      };
    case "appKey":
      return {
        label: I18N.settings.appKey,
        placeholder: I18N.settings.appKeyPlaceholder,
        secret: true,
      };
  }
}

function DestructiveConfirmation({
  message,
  disabled,
  onCancel,
  onConfirm,
}: {
  message: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const confirmation = confirmationRef.current;
    if (!confirmation) return;
    confirmation.focus({ preventScroll: true });
    confirmation.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div ref={confirmationRef} className="destructive-confirmation" role="alert" tabIndex={-1}>
      <small>{message}</small>
      <span className="destructive-confirmation__actions">
        <button type="button" className="settings-link" disabled={disabled} onClick={onCancel}>
          {I18N.settings.cancel}
        </button>
        <button
          type="button"
          className="settings-button settings-button--danger settings-button--compact"
          disabled={disabled}
          onClick={onConfirm}
        >
          <Icon name="trash" />
          {I18N.settings.confirmDelete}
        </button>
      </span>
    </div>
  );
}

function ProviderPicker({
  disabled,
  onChoose,
  onCancel,
}: {
  disabled: boolean;
  onChoose: (provider: ServiceProvider) => void;
  onCancel: () => void;
}) {
  return (
    <div className="provider-picker settings-panel">
      <div className="provider-picker__heading">
        <span>
          <strong>{I18N.settings.chooseProvider}</strong>
          <small>{I18N.settings.chooseProviderDescription}</small>
        </span>
        <button type="button" className="settings-link" disabled={disabled} onClick={onCancel}>
          {I18N.settings.cancel}
        </button>
      </div>
      <div className="provider-picker__options">
        {SERVICE_PROVIDERS.map((provider) => (
          <button
            key={provider}
            type="button"
            className="provider-option"
            disabled={disabled}
            onClick={() => onChoose(provider)}
          >
            <ProviderMark provider={provider} />
            <span>
              <strong>{providerDisplayName(provider)}</strong>
              <small>{providerDescription(provider)}</small>
            </span>
            <Icon name="chevron-right" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ProviderMark({
  provider,
  compact = false,
}: {
  provider: ServiceProvider;
  compact?: boolean;
}) {
  return (
    <span
      className="provider-mark"
      data-provider={provider}
      data-compact={compact}
      aria-hidden="true"
    >
      <Icon
        name={
          provider === "alibabaCloud" || provider === "azureOpenAIRealtime"
            ? "cloud"
            : provider === "xAIRealtime"
              ? "waves"
              : "languages"
        }
      />
    </span>
  );
}

function CredentialBadge({ state }: { state: CredentialState }) {
  return (
    <span className="credential-badge" data-state={state}>
      <span className="credential-dot" data-state={state} />
      {credentialStateText(state)}
    </span>
  );
}

function providerDescription(provider: ServiceProvider): string {
  switch (provider) {
    case "alibabaCloud":
      return I18N.settings.providerAlibabaDescription;
    case "openAIRealtime":
      return I18N.settings.providerOpenAIDescription;
    case "googleGeminiLive":
      return I18N.settings.providerGoogleGeminiDescription;
    case "azureOpenAIRealtime":
      return I18N.settings.providerAzureOpenAIDescription;
    case "volcanoEngine":
      return I18N.settings.providerVolcanoEngineDescription;
    case "tencentCloud":
      return I18N.settings.providerTencentCloudDescription;
    case "baiduTranslate":
      return I18N.settings.providerBaiduTranslateDescription;
    case "deepLX":
      return I18N.settings.providerDeepLXDescription;
    case "xAIRealtime":
      return I18N.settings.providerXAIDescription;
  }
}

function credentialStateText(state: CredentialState): string {
  switch (state) {
    case "present":
      return I18N.settings.credentialPresent;
    case "missing":
      return I18N.settings.credentialMissing;
    case "unavailable":
      return I18N.settings.credentialUnavailable;
  }
}
