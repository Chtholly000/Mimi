import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "./i18n";
import { audioSourceCopy, audioSourceErrorMessage, FOLLOW_SYSTEM, ROLE_COMMUNICATIONS, ROLE_MULTIMEDIA, isDeviceSource, isRoleSource } from "./windowsAudioSource";

afterEach(() => setStoredUiLanguage("en"));

it("localizes unavailable selections with a recovery action in every supported language", () => {
  for (const language of ["en", "zh", "ja"] as const) {
    setStoredUiLanguage(language);
    const message = audioSourceErrorMessage("The selected sound output is unavailable. Stop subtitles and choose another sound source in Settings.");
    expect(message).toBe(audioSourceCopy().missing);
    expect(message).toContain({ en: "Choose another", zh: "请选择其他", ja: "別の取得元を選んで" }[language]);
    expect(audioSourceCopy().silent).toContain({ en: "Play something", zh: "请播放声音", ja: "音声を再生" }[language]);
  }
});

it("does not classify arbitrary provider failures as sound-source failures", () => {
  expect(audioSourceErrorMessage("task-failed")).toBeNull();
  expect(audioSourceErrorMessage("synthetic-private-value")).toBeNull();
});

it("keeps the role wire values stable for the Rust side", () => {
  expect(FOLLOW_SYSTEM).toBe("");
  expect(ROLE_COMMUNICATIONS).toBe("role:communications");
  expect(ROLE_MULTIMEDIA).toBe("role:multimedia");
});

it("distinguishes role sources from device ids", () => {
  expect(isRoleSource(FOLLOW_SYSTEM)).toBe(true);
  expect(isRoleSource(ROLE_COMMUNICATIONS)).toBe(true);
  expect(isDeviceSource(ROLE_COMMUNICATIONS)).toBe(false);
  expect(isDeviceSource("")).toBe(false);
  expect(isDeviceSource("{0.0.0.00000000}.{823cf568-6294-403d-b7bf-c6db30f9ec3a}")).toBe(true);
});
