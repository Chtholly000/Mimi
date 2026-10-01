import { describe, expect, it } from "vitest";
import { isTauri } from "./ipc";
import {
  selectHasRecognizingSourceDraft,
  selectSessionErrorMessage,
  selectSessionStatusKind,
  useStore,
} from "./store";

describe("local preview store", () => {
  it("keeps the synthetic provider ready outside Tauri", () => {
    expect(isTauri).toBe(false);
    expect(
      useStore.getState().settings.profiles[0]?.credentialState,
    ).toBe("present");
  });

  it("keeps subtitle churn out of native-window session selectors", () => {
    const current = useStore.getState();
    const first = {
      ...current,
      session: {
        ...current.session,
        status: { kind: "listening" as const },
        subtitles: {
          ...current.session.subtitles,
          source: { text: "draft one", isFinal: false },
        },
      },
    };
    const replacement = {
      ...first,
      session: {
        ...first.session,
        subtitles: {
          ...first.session.subtitles,
          source: { text: "draft two", isFinal: false },
          translation: { text: "preview", isFinal: false },
        },
      },
    };

    expect(
      Object.is(
        selectSessionStatusKind(first),
        selectSessionStatusKind(replacement),
      ),
    ).toBe(true);
    expect(
      Object.is(
        selectSessionErrorMessage(first),
        selectSessionErrorMessage(replacement),
      ),
    ).toBe(true);
    expect(
      Object.is(
        selectHasRecognizingSourceDraft(first),
        selectHasRecognizingSourceDraft(replacement),
      ),
    ).toBe(true);
  });

  it("still exposes a changed session error message to the tray", () => {
    const current = useStore.getState();
    const first = {
      ...current,
      session: {
        ...current.session,
        status: { kind: "error" as const, message: "first failure" },
      },
    };
    const replacement = {
      ...first,
      session: {
        ...first.session,
        status: { kind: "error" as const, message: "second failure" },
      },
    };

    expect(selectSessionErrorMessage(first)).not.toBe(
      selectSessionErrorMessage(replacement),
    );
  });

  it("requires a new DeepL key in preview mode and never retains it in settings", async () => {
    const original = useStore.getState();
    const profile = { ...original.settings.profiles[0], provider: "alibabaCloud" as const, credentialState: "present" as const, textTranslation: "followService" as const };
    useStore.setState({
      settings: { ...original.settings, profiles: [profile], activeProfileId: profile.id },
      session: { ...original.session, isActive: false, status: { kind: "idle" } },
    });
    try {
      const credentials = { kind: "alibabaTranslation" as const, apiKey: "", textTranslation: "deepL" as const, endpoint: "", token: "" };
      await expect(useStore.getState().saveProfileCredentials(profile.id, credentials)).rejects.toThrow("credential-empty");
      const saved = await useStore.getState().saveProfileCredentials(profile.id, { ...credentials, token: "synthetic-deepl-key" });
      expect(saved.profiles[0].textTranslation).toBe("deepL");
      expect(JSON.stringify(saved)).not.toContain("synthetic-deepl-key");
      await expect(useStore.getState().saveProfileCredentials(profile.id, credentials)).resolves.toMatchObject({ profiles: [{ textTranslation: "deepL" }] });
    } finally {
      useStore.setState({ settings: original.settings, session: original.session });
    }
  });
});
