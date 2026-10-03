import { audioInputLabel } from "../lib/audioInput";
import type { AudioInput } from "../lib/types";
import { Icon } from "./Icon";

/** Selected sources, not a claim that either source is currently receiving sound. */
export function AudioInputIndicator({ input = "system" }: { input?: AudioInput }) {
  const label = audioInputLabel(input);
  return <span className="audio-input-indicator" role="img" aria-label={label} title={label}
    style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, fontSize: 14,
      color: "var(--control-text, rgba(255,255,255,0.82))" }}>
    {input !== "microphone" && <Icon name="speaker" />}
    {input !== "system" && <Icon name="microphone" />}
  </span>;
}
