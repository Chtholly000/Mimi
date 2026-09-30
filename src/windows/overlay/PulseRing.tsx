import { memo } from "react";
import {
  OVERLAY_ACTIVITY_PHASES,
  overlayPhaseColor,
  type OverlayActivityPhaseKind,
} from "../../lib/types";

interface PulseRingProps {
  phase: OverlayActivityPhaseKind;
  /** The status-bar variant: the same pulse scaled down. */
  compact?: boolean;
  /** Resolved motion setting: with it off, this renders a static stack. */
  motionEnabled: boolean;
}

/** Decorative session phase indicator, never an audio meter or progress value.
 * Listening rests in a small halo; recognition releases rings; connection and
 * translation use arcs. Transform/opacity motion remains compositor-friendly.
 */
export const PulseRing = memo(function PulseRing({
  phase,
  compact = false,
  motionEnabled,
}: PulseRingProps) {
  const animating =
    motionEnabled && OVERLAY_ACTIVITY_PHASES[phase].animationSpeed > 0;
  const base = compact ? 18 : 40;
  const color = overlayPhaseColor(phase, 1);
  const period = phase === "recognizing" ? 2.4 : phase === "translating" ? 4.8 : 6;

  return (
    <div
      className={`pulse pulse--${phase}${animating ? " pulse--active" : " pulse--still"}`}
      data-phase={phase}
      style={{
        width: base,
        height: base,
        ["--phase-period" as string]: `${period}s`,
      }}
      aria-hidden="true"
    >
      {/* Ripple rings; the rest state is a small stack around the dot. */}
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="pulse__ring"
          style={{
            border: `${compact ? 0.75 : 1}px solid ${color}`,
            ["--ring-index" as string]: index,
            animationDelay: `${(-index * period / 3).toFixed(3)}s`,
          }}
        />
      ))}
      {/* Center dot */}
      <div
        className="pulse__dot"
        style={{
          width: compact ? 5 : 10,
          height: compact ? 5 : 10,
          marginLeft: compact ? -2.5 : -5,
          marginTop: compact ? -2.5 : -5,
          background: color,
          boxShadow: `0 0 ${compact ? 3 : 6}px ${overlayPhaseColor(phase, 0.25)}`,
        }}
      />
    </div>
  );
});
