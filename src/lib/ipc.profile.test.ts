import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { profileUpdate } from "./ipc";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));
beforeEach(() => vi.mocked(invoke).mockClear());
it("omits language patches on unrelated profile updates", async () => {
  await profileUpdate("p", "Name", { textTranslationName: { route: "chatMock", name: "Local" } });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("profile_update", { profileId: "p", name: "Name", textTranslationName: { route: "chatMock", name: "Local" } });
});
it.each([null, [], ["en", "fr"]] as const)("preserves the explicit language patch %j", async languages => {
  await profileUpdate("p", undefined, { customSpeechSourceLanguages: languages === null ? null : [...languages] });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("profile_update", { profileId: "p", name: undefined, customSpeechLanguagesPatch: { languages } });
});

it("keeps recognition names and language declarations as independent IPC patches", async () => {
  await profileUpdate("p", undefined, { speechRecognitionName: "Recognizer" });
  expect(invoke).toHaveBeenLastCalledWith("profile_update", { profileId: "p", name: undefined, speechRecognitionName: "Recognizer" });
  await profileUpdate("p", undefined, { speechRecognitionName: "Renamed", customSpeechSourceLanguages: ["en"] });
  expect(invoke).toHaveBeenLastCalledWith("profile_update", { profileId: "p", name: undefined, speechRecognitionName: "Renamed", customSpeechLanguagesPatch: { languages: ["en"] } });
});
