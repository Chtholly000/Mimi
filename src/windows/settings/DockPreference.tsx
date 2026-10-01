import { useState } from "react";
import { Switch } from "../../components/Switch";
import { I18N } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { SettingsRow } from "./SettingsPrimitives";

/** The native command also rejects this preference on other platforms. */
export function DockPreference() {
  const show = useStore((state) => state.settings.showInDock);
  const save = useStore((state) => state.saveSettings);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (typeof navigator === "undefined" || !/Macintosh|MacIntel/i.test(navigator.userAgent + " " + navigator.platform)) {
    return null;
  }
  return (
    <>
      <SettingsRow label={I18N.settings.showInDock}>
        <Switch
          aria-label={I18N.settings.showInDock}
          aria-describedby={failed ? "dock-save-error" : undefined}
          checked={show}
          disabled={pending}
          onChange={(showInDock) => {
            setPending(true);
            setFailed(false);
            void save({ showInDock })
              .catch(() => setFailed(true))
              .finally(() => setPending(false));
          }}
        />
      </SettingsRow>
      {failed && <p id="dock-save-error" className="settings-feedback" data-tone="error" role="alert">{I18N.settings.dockSaveFailed}</p>}
      <div className="settings-divider" />
    </>
  );
}
