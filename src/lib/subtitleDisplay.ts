import { I18N } from "./i18n";
import type { SubtitleDisplayMode } from "./types";

export const SUBTITLE_DISPLAY_OPTIONS: readonly { value: SubtitleDisplayMode; label: string }[] = [
  { value: "translation", label: I18N.settings.displayTranslation },
  { value: "bilingual", label: I18N.settings.displayBilingual },
  { value: "original", label: I18N.settings.displayOriginal },
];

export function subtitleDisplayShortcut(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧B" : "Ctrl+Shift+B";
}
