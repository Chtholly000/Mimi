import { credentialErrorMessage } from "../../lib/connectionDiagnostics";
/**
 * Pure derived state for the subtitle overlay. Keeping these transformations
 * outside React makes the phase and row logic deterministic and testable.
 */

import type {
  OverlayActivityPhaseKind,
  SessionStateEvent,
  SettingsSnapshot,
  SubtitleSnapshot,
} from "../../lib/types";
import { I18N } from "../../lib/i18n";
import {
  SOURCE_LANGUAGE_DISPLAY_NAMES,
  TARGET_LANGUAGE_DISPLAY_NAMES,
  sourceLanguageStatusDisplayName,
} from "../../lib/types";

export type SubtitleBlockPresentation = "history" | "latestCommitted" | "live";

/** One spoken utterance: the unit the timeline groups, spaces and fades. */
export interface SubtitleBlock {
  id: string;
  /** Epoch ms of the committed utterance; `null` while it is still live. */
  createdAt: number | null;
  /** Where this block sits in the live/history progression. */
  presentation: SubtitleBlockPresentation;
  /** Recognized original; `null` when the display mode omits this lane. */
  source: string | null;
  /** Translation; `null` while it has not arrived or the mode omits it. */
  translation: string | null;
  /** Set on the live block while its lane may still change. */
  streaming?: true;
}

/** The live tail the overlay should render below the committed blocks. */
export interface LiveTail {
  source: string | null;
  translation: string | null;
  /** True while a lane is still streaming and may change again. */
  isStreaming: boolean;
}

function isSameLanguageMode(
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage">,
  detectedLanguage: string | null,
): boolean {
  if (settings.targetLanguage === "original") return true;
  if (detectedLanguage !== null) {
    return detectedLanguage === settings.targetLanguage;
  }
  return (
    settings.sourceLanguage !== "auto" &&
    settings.sourceLanguage === settings.targetLanguage
  );
}

export function isWaitingForFinalTranslation(
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage">,
  detectedLanguage: string | null,
  isTranslationPending: boolean,
): boolean {
  if (isSameLanguageMode(settings, detectedLanguage)) return false;
  return isTranslationPending;
}

export function computeActivityPhase(
  session: SessionStateEvent,
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage">,
): OverlayActivityPhaseKind {
  const source = session.subtitles.source;
  return computeActivityPhaseFromSignals(
    {
      statusKind: session.status.kind,
      isPaused: session.isPaused,
      detectedLanguage: session.detectedLanguage,
      isTranslationPending: session.isTranslationPending,
      hasRecognizingSourceDraft: source.text !== "" && !source.isFinal,
    },
    settings,
  );
}

interface ActivityPhaseSignals {
  statusKind: SessionStateEvent["status"]["kind"];
  isPaused: boolean;
  detectedLanguage: string | null;
  isTranslationPending: boolean;
  hasRecognizingSourceDraft: boolean;
}

export function computeActivityPhaseFromSignals(
  signals: ActivityPhaseSignals,
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage">,
): OverlayActivityPhaseKind {
  if (signals.statusKind === "error") return "error";
  if (signals.statusKind === "idle") return "idle";
  if (signals.isPaused) return "paused";

  switch (signals.statusKind) {
    case "connecting":
    case "stopping":
      return "connecting";
    case "listening": {
      if (
        isWaitingForFinalTranslation(
          settings,
          signals.detectedLanguage,
          signals.isTranslationPending,
        )
      ) {
        return "translating";
      }
      if (signals.hasRecognizingSourceDraft) {
        return "recognizing";
      }
      return "listening";
    }
  }
}

export function emptyStateText(
  session: SessionStateEvent,
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage">,
): string {
  if (session.isPaused) return I18N.overlay.paused;

  switch (session.status.kind) {
    case "connecting":
      return I18N.overlay.connecting;
    case "listening":
      return isWaitingForFinalTranslation(
        settings,
        session.detectedLanguage,
        session.isTranslationPending,
      )
        ? I18N.overlay.translatingEmpty
        : I18N.overlay.listeningEmpty;
    case "stopping":
      return I18N.overlay.stopping;
    case "error":
      return credentialErrorMessage(session.status.message) ?? session.status.message;
    case "idle":
      return I18N.overlay.idle;
  }
}

export function emptyStateIsError(session: SessionStateEvent): boolean {
  return session.status.kind === "error";
}

type EmptyStateDensity = "minimal" | "compact" | "comfortable";

/**
 * Empty-state chrome adapts to the freely resized overlay height. At the
 * 100px native minimum only one status line fits below the control band, so
 * the decorative pulse yields to the text instead of being clipped.
 */
export function emptyStateDensity(overlayHeight: number): EmptyStateDensity {
  if (overlayHeight <= 112) return "minimal";
  if (overlayHeight < 176) return "compact";
  return "comfortable";
}

export function timelineClassName(blendsWithBackground: boolean): string {
  return [
    "min-h-0 flex-1 overflow-y-auto",
    blendsWithBackground ? "overlay-timeline--immersive" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Visual-line budget for the compact presentation (the live tail and the
 * newest committed block). It follows the display mode and lane role, never the
 * window height: resizing the overlay reveals more history blocks instead of
 * rewriting the sentence the user is currently reading.
 */
export function subtitleLaneBudget(
  displayMode: SettingsSnapshot["subtitleDisplayMode"],
  hasTranslation: boolean,
): { source: number; translation: number } {
  switch (displayMode) {
    case "translation":
      return { source: 0, translation: 2 };
    case "original":
      return { source: 2, translation: 0 };
    default:
      return hasTranslation
        ? { source: 1, translation: 2 }
        : { source: 2, translation: 0 };
  }
}

/**
 * Groups committed pairs and the live tail into the sentence blocks the
 * timeline renders. The block — not an individual text row — carries the
 * timestamp, the age fade and the spacing, so a long sentence that wraps over
 * several lines keeps one visual level instead of reading as older subtitles.
 *
 * Lane selection follows the display mode: translation-only keeps just the
 * translation, original-only just the recognition, and bilingual hides a
 * translation that only repeats its original (same-language sessions). The
 * newest committed block is marked `latestCommitted` until a live tail exists,
 * which is what lets the live presentation stay compact without a separate
 * lifecycle state.
 */
export function buildSubtitleBlocks(
  history: SubtitleSnapshot["history"],
  displayMode: SettingsSnapshot["subtitleDisplayMode"],
  liveTail: LiveTail | null = null,
): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = [];

  for (const pair of history) {
    const sameText = pair.source.trim() === pair.translation.trim();
    const source = displayMode === "translation" || pair.source.trim() === "" ? null : pair.source;
    const translation =
      displayMode === "original" || (source !== null && sameText) || pair.translation.trim() === ""
        ? null
        : pair.translation;
    if (source === null && translation === null) continue;
    blocks.push({
      id: `history-${pair.createdAt}`,
      createdAt: pair.createdAt,
      presentation: "history",
      source,
      translation,
    });
  }

  const isEmptyTail =
    liveTail === null || (liveTail.source === null && liveTail.translation === null);
  if (isEmptyTail) {
    const newest = blocks[blocks.length - 1];
    if (newest !== undefined) newest.presentation = "latestCommitted";
    return blocks;
  }

  blocks.push({
    id: "live",
    createdAt: null,
    presentation: "live",
    source: liveTail.source,
    translation: liveTail.translation,
    ...(liveTail.isStreaming ? { streaming: true as const } : {}),
  });
  return blocks;
}

/**
 * The live preview line: the current unconfirmed translation (or a just-final
 * line that has not yet entered history). The overlay renders it as the
 * timeline's last row — dimmed with a trailing ellipsis — so streaming
 * updates never look like a separate pile at the bottom. Returns `null` when
 * there is nothing to preview.
 */
function visibleDraft(
  translation: SubtitleSnapshot["translation"],
  history: SubtitleSnapshot["history"],
): { text: string; isFinal: boolean } | null {
  if (translation.text === "") return null;
  const currentIsAlreadyInHistory =
    translation.isFinal &&
    history[history.length - 1]?.translation === translation.text;
  if (currentIsAlreadyInHistory) return null;
  return { text: translation.text, isFinal: translation.isFinal };
}

interface LiveSubtitlePreview {
  text: string;
  isFinal: boolean;
  kind: "translation" | "source";
}

/**
 * Selects the active subtitle tail for the requested display language. A
 * delayed, empty, or timed-out translation must not flash the source in its
 * place. Recognition is display text only in Original or same-language mode.
 */
export function visibleLiveSubtitle(
  subtitles: SubtitleSnapshot,
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage"> &
    Partial<Pick<SettingsSnapshot, "subtitleDisplayMode">>,
  detectedLanguage: string | null,
  isTranslationPending: boolean,
  isTranslationTimedOut: boolean,
): LiveSubtitlePreview | null {
  const translation = visibleDraft(
    subtitles.translation,
    subtitles.history,
  );
  const showSource = settings.subtitleDisplayMode === "original" ||
    settings.subtitleDisplayMode === "bilingual";
  // Source/translation snapshots have no shared utterance identity. Only
  // committed history can form a bilingual pair; preview the recognition
  // independently until that pair arrives, never attach a stale translation.
  const bilingualWithoutSource = settings.subtitleDisplayMode === "bilingual" &&
    subtitles.source.text.trim() === "";
  if ((!showSource || bilingualWithoutSource) && translation !== null) {
    return { ...translation, kind: "translation" };
  }

  if (!showSource && !isSameLanguageMode(settings, detectedLanguage)) return null;

  const source = subtitles.source;
  if (source.text === "") return null;

  const latestPair = subtitles.history[subtitles.history.length - 1];
  const currentTranslationMatchesLatestPair =
    subtitles.translation.isFinal &&
    subtitles.translation.text !== "" &&
    latestPair?.translation === subtitles.translation.text;
  const sourceIsAlreadyCommitted =
    source.isFinal &&
    !isTranslationPending &&
    !isTranslationTimedOut &&
    latestPair?.source === source.text &&
    (showSource || currentTranslationMatchesLatestPair);
  if (sourceIsAlreadyCommitted) return null;

  return {
    text: source.text,
    isFinal: source.isFinal,
    kind: "source",
  };
}

/**
 * Every live preview row the overlay should render below the committed
 * history, in display order (original above translation).
 *
 * Bilingual mode used to show only the recognized original until a sentence
 * pair completed, so a service that confirms pairs slowly (or only at long
 * utterance boundaries) left the translation invisible while its draft
 * streamed. The translation preview is therefore shown as soon as it exists,
 * independently of the original; committed pairs still own the durable rows
 * above and never repeat as a preview.
 */
export function visibleLiveSubtitles(
  subtitles: SubtitleSnapshot,
  settings: Pick<SettingsSnapshot, "sourceLanguage" | "targetLanguage"> &
    Partial<Pick<SettingsSnapshot, "subtitleDisplayMode">>,
  detectedLanguage: string | null,
  isTranslationPending: boolean,
  isTranslationTimedOut: boolean,
): LiveSubtitlePreview[] {
  const preview = visibleLiveSubtitle(
    subtitles,
    settings,
    detectedLanguage,
    isTranslationPending,
    isTranslationTimedOut,
  );
  const previews = preview === null ? [] : [preview];
  if (settings.subtitleDisplayMode !== "bilingual") return previews;
  // An empty original already leaves the translation preview on its own.
  if (preview?.kind === "translation") return previews;
  // Same-language drafts can differ briefly while the two streams advance.
  // Showing both would duplicate one language in the bilingual display.
  if (preview?.kind === "source" && isSameLanguageMode(settings, detectedLanguage)) {
    return previews;
  }
  const translation = visibleDraft(subtitles.translation, subtitles.history);
  if (translation === null) return previews;
  // Never stack a second copy of the same text (same-language or
  // original-target sessions translate into the recognized language).
  if (subtitles.translation.text.trim() === subtitles.source.text.trim()) {
    return previews;
  }
  // Providers that identify their utterances stamp both lines with the source
  // id. Stack only when the stamps agree, or when neither line carries one:
  // a translation whose utterance is unknown (or a different one) still answers
  // the previous sentence, so the original stays alone until its own arrives.
  const sourceUtterance = subtitles.source.utteranceId ?? null;
  const translationUtterance = subtitles.translation.utteranceId ?? null;
  const bothUnstamped = sourceUtterance === null && translationUtterance === null;
  const sameUtterance =
    sourceUtterance !== null && sourceUtterance === translationUtterance;
  if (!bothUnstamped && !sameUtterance) {
    return previews;
  }
  return [...previews, { ...translation, kind: "translation" }];
}

export interface LanguageStatus {
  source: string;
  separator: string;
  target: string;
}

export function languageStatus(
  settings: SettingsSnapshot,
  detectedLanguage: string | null,
): LanguageStatus | null {
  const sourceName = sourceLanguageStatusDisplayName(
    settings.sourceLanguage,
    detectedLanguage,
    settings.targetLanguage,
  );

  if (settings.targetLanguage === "original") {
    return {
      source: sourceName,
      separator: I18N.overlay.dotSeparator,
      target: I18N.overlay.original,
    };
  }
  return {
    source: sourceName,
    separator: I18N.overlay.separator,
    target: TARGET_LANGUAGE_DISPLAY_NAMES[settings.targetLanguage],
  };
}

export function sourceLanguageButtonTitle(
  sourceLanguage: SettingsSnapshot["sourceLanguage"],
  chineseIsOriginalOnly = true,
): string {
  return sourceLanguage === "zh"
    ? chineseIsOriginalOnly
      ? I18N.overlay.chineseSource
      : SOURCE_LANGUAGE_DISPLAY_NAMES.zh
    : SOURCE_LANGUAGE_DISPLAY_NAMES[sourceLanguage];
}

export function hasSubtitleContent(subtitles: SubtitleSnapshot): boolean {
  return (
    subtitles.source.text !== "" ||
    subtitles.translation.text !== "" ||
    subtitles.history.length > 0
  );
}
