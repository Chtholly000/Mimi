import { memo, useEffect, useState } from "react";
import { OVERLAY_ACTIVITY_PHASES, overlayPhaseColor, type OverlayActivityPhaseKind } from "../../lib/types";
import "./PulseRing.css";

interface PulseRingProps {
  phase: OverlayActivityPhaseKind;
  compact?: boolean;
  /** Already resolved independently from the subtitle-motion preference. */
  motionEnabled: boolean;
}

/** Session decoration, not an audio meter. Layers retain their animation
 * identity across phases; only their visibility and shape crossfade. The
 * clock pauses after the outer motion has settled and resumes where it left
 * off. Reduced motion is immediate and never waits for that settling timer. */
export const PulseRing = memo(function PulseRing({ phase, compact = false, motionEnabled }: PulseRingProps) {
  const working = OVERLAY_ACTIVITY_PHASES[phase].animationSpeed > 0;
  const [clockPaused, setClockPaused] = useState(!motionEnabled || !working);
  useEffect(() => {
    if (!motionEnabled || working) {
      setClockPaused(!motionEnabled);
      return;
    }
    const settle = window.setTimeout(() => setClockPaused(true), 520);
    return () => window.clearTimeout(settle);
  }, [motionEnabled, working]);

  return (
    <div
      className={`phase-light${motionEnabled ? "" : " phase-light--still"}`}
      data-phase={phase}
      data-clock={clockPaused ? "paused" : "running"}
      aria-hidden="true"
      style={{ width: compact ? 18 : 40, height: compact ? 18 : 40, color: overlayPhaseColor(phase, 1) }}
    >
      <div className="phase-light__rest" />
      <div className="phase-light__halo"><div className="phase-light__halo-ring" /></div>
      <div className="phase-light__recognition">
        {[0, 1, 2].map(index => <div key={index} className="phase-light__ripple" style={{ animationDelay: `${-index * 0.9}s` }} />)}
      </div>
      <div className="phase-light__arcs"><div className="phase-light__arc phase-light__arc--outer" /><div className="phase-light__arc phase-light__arc--inner" /></div>
      <div className="phase-light__core"><div className="phase-light__dot" /></div>
      <div className="phase-light__pause"><i /><i /></div>
      <div className="phase-light__error" />
    </div>
  );
});
