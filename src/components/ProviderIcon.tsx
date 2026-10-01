import type { ServiceProvider } from "../lib/types";
import alibabaCloud from "../assets/providers/alibaba-cloud.svg";
import openAI from "../assets/providers/openai-black.svg";
import openAIDark from "../assets/providers/openai-white.svg";
import gemini from "../assets/providers/gemini.svg";
import azure from "../assets/providers/azure.svg";
import volcanoEngine from "../assets/providers/volcano-engine.png";
import tencentCloud from "../assets/providers/tencent-cloud.svg";
import baiduTranslate from "../assets/providers/baidu-translate.png";
import xAI from "../assets/providers/xai.png";
import "./provider-icon.css";

const PROVIDER_ASSETS: Record<ServiceProvider, string> = {
  alibabaCloud,
  openAIRealtime: openAI,
  googleGeminiLive: gemini,
  azureOpenAIRealtime: azure,
  volcanoEngine,
  tencentCloud,
  baiduTranslate,
  xAIRealtime: xAI,
  // Legacy DeepLX profiles use Alibaba Cloud for speech recognition.
  deepLX: alibabaCloud,
};

interface ProviderIconProps {
  provider: ServiceProvider;
  size?: 32 | 36;
  className?: string;
}

/** Official local brand assets. The adjacent service name provides the label. */
export function ProviderIcon({ provider, size = 36, className }: ProviderIconProps) {
  return (
    <span
      className={["provider-icon", className].filter(Boolean).join(" ")}
      data-provider={provider}
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      <img
        className={provider === "openAIRealtime" ? "provider-icon__image provider-icon__image--light" : "provider-icon__image"}
        src={PROVIDER_ASSETS[provider]}
        width={32}
        height={32}
        alt=""
        draggable={false}
      />
      {provider === "openAIRealtime" && (
        <img className="provider-icon__image provider-icon__image--dark" src={openAIDark} width={32} height={32} alt="" draggable={false} />
      )}
    </span>
  );
}
