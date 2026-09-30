import type {
  ProviderCredentialsInput,
  ServiceProvider,
} from "./types";

export type CredentialFieldName =
  | "asrApiKey"
  | "token"
  | "apiKey"
  | "endpoint"
  | "deployment"
  | "transcriptionDeployment"
  | "appId"
  | "secretId"
  | "secretKey"
  | "appKey";

export type CredentialDraft = Record<CredentialFieldName, string>;

interface CredentialEditorLocalState {
  draft: CredentialDraft;
  editingSavedCredential: boolean;
}

export function emptyCredentialDraft(): CredentialDraft {
  return {
    asrApiKey: "",
    token: "",
    apiKey: "",
    endpoint: "",
    deployment: "",
    transcriptionDeployment: "",
    appId: "",
    secretId: "",
    secretKey: "",
    appKey: "",
  };
}

/** Clears write-only fields before a confirmed credential deletion starts. */
export function credentialEditorStateAfterDeleteRequest(
  current: CredentialEditorLocalState,
  confirmingDelete: boolean,
): CredentialEditorLocalState {
  if (!confirmingDelete) return current;
  return {
    draft: emptyCredentialDraft(),
    editingSavedCredential: false,
  };
}

export function credentialFieldsForProvider(
  provider: ServiceProvider,
): readonly CredentialFieldName[] {
  switch (provider) {
    case "deepLX":
      return ["asrApiKey", "endpoint", "token"];
    case "azureOpenAIRealtime":
      return [
        "endpoint",
        "deployment",
        "transcriptionDeployment",
        "apiKey",
      ];
    case "tencentCloud":
      return ["appId", "secretId", "secretKey"];
    case "baiduTranslate":
      return ["appId", "appKey"];
    default:
      return ["apiKey"];
  }
}

export function buildProviderCredentials(
  provider: ServiceProvider,
  draft: CredentialDraft,
): ProviderCredentialsInput | null {
  const values = Object.fromEntries(
    Object.entries(draft).map(([key, value]) => [key, value.trim()]),
  ) as CredentialDraft;
  if (
    credentialFieldsForProvider(provider).some((field) => field !== "token" && !values[field])
  ) {
    return null;
  }

  switch (provider) {
    case "deepLX":
      return { kind: "deepLX", asrApiKey: values.asrApiKey, endpoint: values.endpoint, token: values.token };
    case "azureOpenAIRealtime":
      return {
        kind: "azureOpenAI",
        endpoint: values.endpoint,
        deployment: values.deployment,
        transcriptionDeployment: values.transcriptionDeployment,
        apiKey: values.apiKey,
      };
    case "tencentCloud":
      return {
        kind: "tencentCloud",
        appId: values.appId,
        secretId: values.secretId,
        secretKey: values.secretKey,
      };
    case "baiduTranslate":
      return {
        kind: "baiduTranslate",
        appId: values.appId,
        appKey: values.appKey,
      };
    default:
      return { kind: "apiKey", apiKey: values.apiKey };
  }
}

/** Mirrors native DeepLX endpoint safety checks before any credential I/O. */
export function deepLXEndpointIsValid(value: string): boolean {
  if (new TextEncoder().encode(value).length > 2048 || Array.from(value).some((char) => { const code = char.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159); })) return false;
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || (url.protocol === "http:" && local)) &&
      !!url.hostname && !url.username && !url.password && !value.includes("?") && !value.includes("#");
  } catch {
    return false;
  }
}
