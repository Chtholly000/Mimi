import { I18N } from "./i18n";
import type { SubtitleColor } from "./types";

// Same RGB values and display order as the Android subtitle settings.
export const SUBTITLE_COLORS: Record<SubtitleColor, string> = {
  white: "#FFFFFF",
  teal: "#4FD1C5",
  yellow: "#FFD54F",
  green: "#9AE66E",
  pink: "#F49AB5",
};

export const SUBTITLE_COLOR_OPTIONS: readonly { value: SubtitleColor; label: string }[] = [
  { value: "white", get label() { return I18N.settings.colorWhite; } },
  { value: "teal", get label() { return I18N.settings.colorTeal; } },
  { value: "yellow", get label() { return I18N.settings.colorYellow; } },
  { value: "green", get label() { return I18N.settings.colorGreen; } },
  { value: "pink", get label() { return I18N.settings.colorPink; } },
];
