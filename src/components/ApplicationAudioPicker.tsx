import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useApplicationAudioPicker } from "../lib/useApplicationAudioPicker";
import { Select } from "./Select";
import { Icon } from "./Icon";
import "./application-audio-picker.css";

function ApplicationIcon({ dataUrl }: { dataUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Native enumeration supplies local PNGs. Never fetch an app-provided URL.
  if (!dataUrl?.startsWith("data:image/png;base64,") || dataUrl === failedUrl) return <Icon name="app-window" />;
  return <img src={dataUrl} alt="" draggable={false} onError={() => setFailedUrl(dataUrl)} />;
}

/** The same application choice is available in Settings and the floating panel. */
export function ApplicationAudioPicker({ disabled = false, onBusyChange, onActionStart }: {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onActionStart?: () => (message: string) => void;
}) {
  const picker = useApplicationAudioPicker(disabled);
  useEffect(() => {
    onBusyChange?.(picker.pending);
    return () => onBusyChange?.(false);
  }, [onBusyChange, picker.pending]);
  const options = picker.options.map(option => ({
    ...option,
    icon: option.value === "" ? <Icon name="speaker" /> : <ApplicationIcon dataUrl={option.iconDataUrl} />,
  }));
  const failure = picker.error ?? (picker.missing ? picker.text.unavailable : null);
  return <span className="application-audio-picker" aria-busy={picker.pending || picker.loading}
    title={!picker.supported ? picker.text.unsupported : undefined}>
    <span className="application-audio-picker__controls">
      <Select label={picker.text.title} value={picker.selected} valueLabel={picker.valueLabel} valueIcon={<Icon name="app-window" />}
        searchLabel={picker.text.search} emptyMessage={picker.text.noMatch} options={options}
        disabled={picker.locked || (!picker.supported && picker.selected === "")}
        onOpen={() => { void picker.refresh(onActionStart?.()); }} onChange={id => { void picker.choose(id, onActionStart?.()); }} />
      <button type="button" className="application-audio-picker__refresh" aria-label={picker.text.refresh}
        title={picker.loading ? picker.text.loading : picker.empty ? picker.text.empty : picker.text.refresh} disabled={picker.locked || picker.loading || !picker.supported}
        aria-busy={picker.loading || undefined} onClick={() => { void picker.refresh(onActionStart?.()); }}>
        <RotateCw size={14} aria-hidden="true" />
      </button>
    </span>
    {failure && <span className="application-audio-picker__feedback" data-tone="error" role="alert">{failure}</span>}
  </span>;
}
