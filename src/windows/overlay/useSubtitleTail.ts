import { useMemo } from "react";
import type { SessionStateEvent, SettingsSnapshot, SubtitleSnapshot } from "../../lib/types";
import { subtitleStreamKey, useStableText } from "./animation";
import { visibleLiveSubtitles, type LiveTail } from "./overlayModel";

type TranslationSignals = Pick<SessionStateEvent, "detectedLanguage" | "isTranslationPending" | "isTranslationTimedOut">;

/** Every input has its own stabilization state; another input cannot replace it. */
export function useSubtitleTail(subtitles: SubtitleSnapshot, settings: SettingsSnapshot,
  signals: TranslationSignals, running: boolean, atomicProvider: boolean, sourceIdentity: string): LiveTail {
  const previews = useMemo(() => visibleLiveSubtitles(subtitles, settings, signals.detectedLanguage,
    signals.isTranslationPending, signals.isTranslationTimedOut,
    atomicProvider && subtitles.previewPair !== undefined),
  [subtitles, settings, signals.detectedLanguage, signals.isTranslationPending, signals.isTranslationTimedOut, atomicProvider]);
  const source = previews.find(preview => preview.kind === "source");
  const translation = previews.find(preview => preview.kind === "translation");
  const latestCommittedAt = subtitles.history.at(-1)?.createdAt ?? null;
  const sourceText = useStableText(source?.text ?? "", source === undefined || source.isFinal || source.isStable ? 0 : 180, 750,
    `${sourceIdentity}:${subtitleStreamKey(settings.subtitleDisplayMode, "source", source?.utteranceId, latestCommittedAt)}`);
  const translationText = useStableText(translation?.text ?? "", translation === undefined || translation.isFinal || translation.isStable ? 0 : 400, 1_500,
    `${sourceIdentity}:${subtitleStreamKey(settings.subtitleDisplayMode, "translation", translation?.utteranceId, latestCommittedAt)}`);
  const isStreaming = running && ((source !== undefined && !source.isFinal && !source.isStable) ||
    (translation !== undefined && !translation.isFinal && !translation.isStable));
  return useMemo(() => ({ source: sourceText || null, translation: translationText || null,
    utteranceId: source?.utteranceId ?? translation?.utteranceId, isStreaming }),
  [sourceText, translationText, source?.utteranceId, translation?.utteranceId, isStreaming]);
}
