import { capabilitiesForProfile, isCustomSpeechProvider, textTranslationForProfile } from "./providerCapabilities";
import {
  AUDIO3_RECOGNITION_LANGUAGE_CODES,
  QWEN_MT_LITE_TRANSLATION_LANGUAGE_CODES,
  type ServiceProfile, type SourceLanguage, type TargetLanguage,
} from "./types";

export { AUDIO3_RECOGNITION_LANGUAGE_CODES, QWEN_MT_LITE_TRANSLATION_LANGUAGE_CODES } from "./types";

export type AutomaticDetection = "supported" | "unsupported" | "unverified";
export type LanguageMetadataLimitation = "liteIntersection" | "resourceQueryRequired" | "customUnknown" | "unverified";

interface RecognitionAvailability {
  readonly model: string | null;
  /** Upstream model languages, not Mimi's manual selector options. Null means unverified. */
  readonly languageCodes: readonly string[] | null;
  readonly automaticDetection: AutomaticDetection;
}

interface TranslationAvailability {
  readonly model: string | null;
  /** Upstream text targets. Never includes Original, which makes no translation request. */
  readonly languageCodes: readonly string[] | null;
}

export interface ProfileLanguageMetadata {
  readonly appSelectable: {
    readonly sourceCodes: readonly SourceLanguage[];
    readonly targetCodes: readonly TargetLanguage[];
  };
  readonly providerAvailable: {
    readonly recognition: RecognitionAvailability;
    readonly translation: TranslationAvailability;
    /** Documented ASR/MT intersection; does not add options to the application. */
    readonly explicitPipelineSourceCodes: readonly string[] | null;
    readonly limitation: LanguageMetadataLimitation;
    readonly evidenceUrls: readonly string[];
  };
}

const AUDIO3_DOCUMENTATION = "https://help.aliyun.com/en/model-studio/qwen-audio-asr-streaming-python-sdk";
const QWEN_MT_DOCUMENTATION = "https://help.aliyun.com/en/model-studio/machine-translation";
const DEEPL_DOCUMENTATION = "https://developers.deepl.com/docs/languages/using-the-languages-api";

const LITE_LANGUAGE_CODES = new Set<string>(QWEN_MT_LITE_TRANSLATION_LANGUAGE_CODES);
export const AUDIO3_LITE_PIPELINE_SOURCE_CODES = Object.freeze(
  AUDIO3_RECOGNITION_LANGUAGE_CODES.filter((code) => LITE_LANGUAGE_CODES.has(code)),
);

const AUDIO3_RECOGNITION: RecognitionAvailability = Object.freeze({
  model: "qwen-audio-3.0-asr-flash-streaming",
  languageCodes: AUDIO3_RECOGNITION_LANGUAGE_CODES,
  automaticDetection: "supported",
});
const UNKNOWN_TRANSLATION: TranslationAvailability = Object.freeze({ model: null, languageCodes: null });
const LITE_AVAILABILITY: ProfileLanguageMetadata["providerAvailable"] = Object.freeze({
  recognition: AUDIO3_RECOGNITION,
  translation: Object.freeze({ model: "qwen-mt-lite", languageCodes: QWEN_MT_LITE_TRANSLATION_LANGUAGE_CODES }),
  explicitPipelineSourceCodes: AUDIO3_LITE_PIPELINE_SOURCE_CODES,
  limitation: "liteIntersection",
  evidenceUrls: Object.freeze([AUDIO3_DOCUMENTATION, QWEN_MT_DOCUMENTATION]),
});

/** Display-only evidence. It must never be used to validate or expand wire selections.
 * Detection in the ASR model does not make every detected language translatable by Lite.
 * The Rust-default parity fixture makes a future model change update this static catalog. */
export function languageMetadataForProfile(profile: ServiceProfile, targetLanguage: TargetLanguage = "zh"): ProfileLanguageMetadata {
  const capabilities = capabilitiesForProfile(profile, targetLanguage);
  const appSelectable = { sourceCodes: capabilities.sourceLanguages, targetCodes: capabilities.targetLanguages };
  if (isCustomSpeechProvider(profile.provider)) return {
    appSelectable,
    providerAvailable: {
      recognition: { model: null, languageCodes: null, automaticDetection: "unverified" },
      translation: UNKNOWN_TRANSLATION, explicitPipelineSourceCodes: null,
      limitation: "customUnknown", evidenceUrls: [],
    },
  };
  if (profile.provider === "alibabaCloud" || profile.provider === "deepLX") {
    const route = textTranslationForProfile(profile);
    if (route === "followService") return { appSelectable, providerAvailable: LITE_AVAILABILITY };
    return {
      appSelectable,
      providerAvailable: {
        recognition: AUDIO3_RECOGNITION,
        translation: UNKNOWN_TRANSLATION,
        explicitPipelineSourceCodes: null,
        limitation: route === "deepL" ? "resourceQueryRequired" : "customUnknown",
        evidenceUrls: route === "deepL" ? [AUDIO3_DOCUMENTATION, DEEPL_DOCUMENTATION] : [AUDIO3_DOCUMENTATION],
      },
    };
  }
  // These existing protocol paths detect the source. Explicit-source paths must
  // not acquire an Automatic option simply because a different product has one.
  const automaticDetection: AutomaticDetection = ["openAIRealtime", "googleGeminiLive", "azureOpenAIRealtime", "xAIRealtime"].includes(profile.provider)
    ? "supported" : ["tencentCloud", "baiduTranslate"].includes(profile.provider) ? "unsupported" : "unverified";
  return {
    appSelectable,
    providerAvailable: {
      recognition: { model: null, languageCodes: null, automaticDetection },
      translation: UNKNOWN_TRANSLATION,
      explicitPipelineSourceCodes: null,
      limitation: "unverified",
      evidenceUrls: [],
    },
  };
}

/** Provider codes differ from BCP 47. Keep scripts and Tagalog distinct in names. */
export function providerLanguageDisplayCode(code: string, stage: "recognition" | "translation"): string {
  if (code === "zh_tw") return "zh-Hant";
  if (code === "zh" && stage === "translation") return "zh-Hans";
  if (code === "tl" && stage === "recognition") return "fil";
  return code;
}
