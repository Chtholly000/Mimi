import { afterEach, expect, it } from "vitest";
import { setStoredUiLanguage } from "./i18n";
import { audio3ErrorMessage } from "./audio3Errors";

afterEach(() => setStoredUiLanguage("en"));

it("separates service timeout, authentication, unknown failure and task phase", () => {
  setStoredUiLanguage("zh");
  expect(audio3ErrorMessage("audio3_error.recognition.timeout.CLIENT_ERROR")).toContain("服务超时");
  expect(audio3ErrorMessage("audio3_error.recognition.timeout.CLIENT_ERROR")).not.toContain("设备选错");
  expect(audio3ErrorMessage("audio3_error.setup.authentication.INVALID_API_KEY")).toContain("API 密钥");
  expect(audio3ErrorMessage("audio3_error.setup.task_failed.OTHER")).toContain("原因尚不明确");
  expect(audio3ErrorMessage("audio3_error.setup.request.CLIENT_ERROR")).toContain("启动语音识别时");
});

it("keeps recovery actions in English, Chinese and Japanese without exposing arbitrary codes", () => {
  for (const language of ["en", "zh", "ja"] as const) {
    setStoredUiLanguage(language);
    expect(audio3ErrorMessage("audio3_error.recognition.service.SERVER_ERROR")).toContain({ en: "Try again", zh: "重试", ja: "再試行" }[language]);
  }
  expect(audio3ErrorMessage("audio3_error.recognition.timeout.synthetic-private-code")).toBeNull();
  expect(audio3ErrorMessage("audio3_error.recognition.timeout.CLIENT_ERROR private text")).toBeNull();
});
