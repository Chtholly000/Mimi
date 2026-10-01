import { I18N } from "../../lib/i18n";
import type { SessionStateEvent } from "../../lib/types";
import { formatLatency } from "./latencyFormat";
import "./OverlayLatency.css";

/** Latest observations, without a timer, polling, or inferred provider data. */
export function OverlayLatency({ session }: { session: SessionStateEvent }) {
  if (!session.isActive) return null;
  const current = session.status.kind === "listening" && !session.isPaused;
  const follow = session.translationLatencyKind === "follow";
  const api = formatLatency(current ? session.apiLatencyMs : null);
  const translation = formatLatency(current ? session.translationLatencyMs : null);
  const translationLabel = follow ? I18N.overlay.translationFollowLatency : I18N.overlay.translationLatency;
  const translationHelp = follow ? I18N.overlay.translationFollowLatencyHelp : I18N.overlay.translationLatencyHelp;
  const description = (help: string, value: string) => `${help} ${value === "—" ? I18N.overlay.latencyUnavailable : value}`;
  return (
    <div className="overlay-latency" data-testid="overlay-latency">
      <span title={description(I18N.overlay.apiLatencyHelp, api)} aria-label={`${I18N.overlay.apiLatency}: ${api}`}>
        <span>{I18N.overlay.apiLatencyShort}</span><strong>{api}</strong>
      </span>
      <span className="overlay-latency__separator" aria-hidden="true">·</span>
      <span title={description(translationHelp, translation)} aria-label={`${translationLabel}: ${translation}`}>
        <span>{translationLabel}</span><strong>{translation}</strong>
      </span>
    </div>
  );
}
