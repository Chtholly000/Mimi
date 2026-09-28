import { useId, useState } from "react";
import { I18N } from "../../lib/i18n";
import {
  normalizeSubtitleHex,
  SUBTITLE_COLORS,
  SUBTITLE_COLOR_OPTIONS,
  subtitleColorHex,
} from "../../lib/subtitleColor";
import type { SubtitleColor } from "../../lib/types";

type Props = { value: SubtitleColor; onChange: (color: SubtitleColor) => void };

export function SubtitleColorControl({ value, onChange }: Props) {
  const hex = subtitleColorHex(value);
  return (
    <div className="subtitle-color-control">
      <div className="subtitle-color-presets" role="group" aria-label={I18N.settings.subtitleColor}>
        {SUBTITLE_COLOR_OPTIONS.map((option) => {
          const selected = hex === SUBTITLE_COLORS[option.value];
          return (
            <button
              key={option.value}
              type="button"
              className={`subtitle-color-swatch${selected ? " is-selected" : ""}`}
              aria-label={option.label}
              aria-pressed={selected}
              title={option.label}
              onClick={() => onChange(option.value)}
            >
              <span style={{ backgroundColor: SUBTITLE_COLORS[option.value] }} />
            </button>
          );
        })}
      </div>
      <div className="subtitle-color-custom">
        <label className="subtitle-color-picker">
          <input
            type="color"
            value={hex}
            aria-label={I18N.settings.customSubtitleColor}
            onChange={(event) => {
              const color = normalizeSubtitleHex(event.currentTarget.value);
              if (color) onChange(color);
            }}
          />
          <span>{I18N.settings.customSubtitleColor}</span>
        </label>
        <HexColorInput key={value} value={hex} onChange={onChange} />
      </div>
    </div>
  );
}

// Remount on a persisted/optimistic color change, including save rollback or
// another window's update. Incomplete local text never changes subtitle color.
function HexColorInput({ value, onChange }: { value: string; onChange: Props["onChange"] }) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  function commit() {
    const color = normalizeSubtitleHex(draft);
    if (!color) {
      setInvalid(true);
      return;
    }
    setDraft(color);
    setInvalid(false);
    if (color !== value) onChange(color);
  }
  return (
    <div className="subtitle-color-hex">
      <input
        type="text"
        value={draft}
        aria-label={I18N.settings.subtitleColorHex}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="#FFFFFF"
        onChange={(event) => { setDraft(event.currentTarget.value); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(value);
            setInvalid(false);
          }
        }}
      />
      {invalid && <span id={errorId} className="subtitle-color-error" role="alert">{I18N.settings.subtitleColorInvalid}</span>}
    </div>
  );
}
