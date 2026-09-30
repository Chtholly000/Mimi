import { memo, useEffect, useState } from "react";
import { OVERLAY_ACTIVITY_PHASES, overlayPhaseColor, type OverlayActivityPhaseKind, type PulseStyle } from "../../lib/types";
import "./PulseRing.css";

interface PulseRingProps {
  phase: OverlayActivityPhaseKind;
  compact?: boolean;
  /** Already resolved independently from the subtitle-motion preference. */
  motionEnabled: boolean;
  /** Missing preferences preserve the existing indicator. */
  pulseStyle?: PulseStyle;
}

const syllables = [8, 12, 16, 20, 24, 28, 32];
const heights = [6, 12, 23, 29, 22, 13, 6];
// One repeat occupies 40 viewBox units: translating the persistent track
// by 40 units loops without replacing its animation instance.
const wave = "M-40 20 Q-35 20 -30 12 T-20 20 T-10 28 T0 20 T10 12 T20 20 T30 28 T40 20 T50 12 T60 20 T70 28 T80 20";

/** Decorative sound language from session phases, never measured audio.
 * Tracks stay mounted. Phase changes reshape their enclosing layers;
 * pause settles for 520ms, then freezes clocks; resume continues those clocks.
 */
export const PulseRing = memo(function PulseRing({ phase, compact = false, motionEnabled, pulseStyle = "classic" }: PulseRingProps) {
  const lightClass = pulseStyle === "classic" ? "phase-light" : "sound-light";
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
      className={`${lightClass}${motionEnabled ? "" : ` ${lightClass}--still`}`}
      data-phase={phase}
      data-clock={clockPaused ? "paused" : "running"}
      data-sound-style={pulseStyle}
      data-pulse-style={pulseStyle}
      aria-hidden="true"
      style={{ width: compact ? 18 : 40, height: compact ? 18 : 40, color: overlayPhaseColor(phase, 1) }}
    >
      {pulseStyle === "classic" ? <>
      <div className="phase-light__rest" />
      <div className="phase-light__halo"><div className="phase-light__halo-ring" /></div>
      <div className="phase-light__recognition">
        {[0, 1, 2].map(index => <div key={index} className="phase-light__ripple" style={{ animationDelay: `${-index * 0.9}s` }} />)}
      </div>
      <div className="phase-light__arcs"><div className="phase-light__arc phase-light__arc--outer" /><div className="phase-light__arc phase-light__arc--inner" /></div>
      <div className="phase-light__core"><div className="phase-light__dot" /></div>
      <div className="phase-light__pause"><i /><i /></div>
      <div className="phase-light__error" />
      </> : <svg className="sound-light__drawing" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round">
        <g className="sound-light__syllables">
          {syllables.map((x, index) => (
            <g className="sound-light__envelope" key={x}>
              <g className="sound-light__beat" style={{ animationDelay: `${-index * 0.19}s` }}>
                <path strokeWidth="2.25" d={`M${x} ${20 - heights[index] / 2}V${20 + heights[index] / 2}`} />
              </g>
            </g>
          ))}
        </g>
        <g className="sound-light__ribbons">
          <g className="sound-light__ribbon-envelope">
            <path className="sound-light__wave sound-light__wave--back" strokeWidth="1.25" d={wave} />
            <path className="sound-light__wave sound-light__wave--front" strokeWidth="1.7" d={wave} />
          </g>
        </g>
        <g className="sound-light__translation">
          <g className="sound-light__current-envelope">
            <path className="sound-light__current sound-light__current--back" strokeWidth="1.25" d={wave} />
            <path className="sound-light__current sound-light__current--front" strokeWidth="1.7" d={wave} />
          </g>
        </g>
        <path className="sound-light__flat" strokeWidth="1.7" d="M9 20H17M23 20H31" />
        <g className="sound-light__idle" fill="currentColor" stroke="none"><circle cx="16" cy="20" r="1" /><circle cx="20" cy="20" r="1" /><circle cx="24" cy="20" r="1" /></g>
        <path className="sound-light__error" strokeWidth="1.7" d="M16 16L24 24M24 16L16 24" />
      </svg>}
    </div>
  );
});
