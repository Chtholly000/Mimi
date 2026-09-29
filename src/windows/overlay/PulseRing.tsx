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

// Three rings spread across the pulse cycle (0°, 120°, 240°), so the wave
// always has a ring mid-expansion. All active phases share one cadence; the
// phase only changes the color, keeping every state's motion identical.
const RING_COUNT = 3;
const PULSE_PERIOD_S = 2.2;
const RING_STAGGER_S = PULSE_PERIOD_S / RING_COUNT;

/**
 * The recognition activity indicator: a glowing center dot that breathes while
 * rings ripple outward and fade. The loop is pure CSS on `transform` and
 * `opacity`, staggered with negative delays, so it runs on the compositor
 * thread and keeps breathing while the overlay's main thread is busy rendering
 * streaming text. Compact is the identical animation scaled down.
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

  return (
    <div
      className={animating ? "pulse pulse--active" : "pulse"}
      style={{ width: base, height: base }}
      aria-hidden="true"
    >
      {/* Ripple rings; the rest state is a small stack around the dot. */}
      {Array.from({ length: RING_COUNT }, (_, index) => (
        <div
          key={index}
          className="pulse__ring"
          style={{
            border: `${compact ? 1 : 1.5}px solid ${color}`,
            ["--ring-index" as string]: index,
            animationDelay: `${(-index * RING_STAGGER_S).toFixed(3)}s`,
          }}
        />
      ))}
      {/* Center dot */}
      <div
        className="pulse__dot"
        style={{
          width: compact ? 7 : 14,
          height: compact ? 7 : 14,
          marginLeft: compact ? -3.5 : -7,
          marginTop: compact ? -3.5 : -7,
          background: color,
          boxShadow: `0 0 ${compact ? 6 : 12}px ${overlayPhaseColor(phase, 0.6)}`,
        }}
      />
    </div>
  );
});
