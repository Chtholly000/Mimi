import { describe, expect, it } from "vitest";
import type { SettingsSnapshot } from "../../lib/types";
import { overlayControlPanelModel } from "./overlayControlModel";

const BASE_SETTINGS: SettingsSnapshot = {
  profiles: [
    {
      id: "ali",
      name: "Alibaba Cloud",
      provider: "alibabaCloud",
      credentialState: "present",
    },
    {
      id: "openai",
      name: "OpenAI Realtime",
      provider: "openAIRealtime",
      credentialState: "present",
    },
  ],
  activeProfileId: "ali",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  translationMode: "highQuality",
  fontSize: 18,
  subtitleColor: "white",
  subtitleAlignment: "center",
  subtitleDisplayMode: "translation",
  pulseAnimation: null,
  pulseStyle: "ribbon",
  subtitleAnimation: null,
  subtitleBlendsWithBackground: false,
  isOverlayLocked: false,
  uiLanguage: null,
  retainSessionHistory: false,
  recordSessionAudio: false,
  windowsAudioSource: "",
  showInDock: false,
};

describe("overlay control panel model", () => {
  it("shows Alibaba recognition choices without a redundant mode picker", () => {
    const model = overlayControlPanelModel(BASE_SETTINGS);
    expect(model.sourceOptions).toHaveLength(5);
    expect(model.translationModeOptions).toEqual([]);
    expect(model.effectiveTranslationMode).toBe("turbo");
  });

  it("keeps Turbo for a manually selected source without a mode picker", () => {
    const model = overlayControlPanelModel({
      ...BASE_SETTINGS,
      sourceLanguage: "ja",
    });
    expect(model.translationModeOptions).toEqual([]);
  });

  it("omits translation modes when only original subtitles are requested", () => {
    const model = overlayControlPanelModel({
      ...BASE_SETTINGS,
      targetLanguage: "original",
    });
    expect(model.translationModeOptions).toEqual([]);
  });

  it("omits single-option OpenAI groups", () => {
    const model = overlayControlPanelModel({
      ...BASE_SETTINGS,
      activeProfileId: "openai",
    });
    expect(model.sourceOptions).toEqual([]);
    expect(model.translationModeOptions).toEqual([]);
    expect(model.effectiveTranslationMode).toBe("turbo");
  });

  it("derives immersive and position-lock switch state", () => {
    expect(overlayControlPanelModel(BASE_SETTINGS).immersiveModeEnabled).toBe(
      false,
    );
    expect(overlayControlPanelModel(BASE_SETTINGS).overlayLocked).toBe(false);

    const enabled = overlayControlPanelModel({
      ...BASE_SETTINGS,
      subtitleBlendsWithBackground: true,
      isOverlayLocked: true,
    });
    expect(enabled.immersiveModeEnabled).toBe(true);
    expect(enabled.overlayLocked).toBe(true);
  });
});
