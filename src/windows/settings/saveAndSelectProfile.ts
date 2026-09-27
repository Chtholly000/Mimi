import type { ProviderCredentialsInput, SettingsSnapshot } from "../../lib/types";

/** Save first: a failed activation must never make a stored key look unsaved. */
export async function saveAndSelectProfile(
  profileId: string,
  credentials: ProviderCredentialsInput,
  save: (id: string, credentials: ProviderCredentialsInput) => Promise<SettingsSnapshot>,
  select: (id: string) => Promise<SettingsSnapshot>,
): Promise<SettingsSnapshot> {
  const saved = await save(profileId, credentials);
  return saved.activeProfileId === profileId ? saved : select(profileId);
}
