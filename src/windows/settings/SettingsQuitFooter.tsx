import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { I18N } from "../../lib/i18n";

/** Normal app exit stays reachable outside the sidebar's scroll area. */
export function SettingsQuitFooter({ onQuit }: { onQuit: () => Promise<void> }) {
  const pending = useRef(false);
  const [isQuitting, setIsQuitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const quit = () => {
    if (pending.current) return;
    pending.current = true;
    setIsQuitting(true);
    setFailed(false);
    void onQuit()
      .catch(() => setFailed(true))
      .finally(() => {
        pending.current = false;
        setIsQuitting(false);
      });
  };

  return (
    <footer className="settings-sidebar-footer">
      <button
        type="button"
        className="settings-sidebar-action settings-quit-button"
        disabled={isQuitting}
        aria-busy={isQuitting}
        onClick={quit}
      >
        <LogOut size={14} aria-hidden="true" />
        <span>{isQuitting ? I18N.tray.quitting : I18N.tray.quit}</span>
      </button>
      {failed && <p className="settings-quit-error" role="alert">{I18N.tray.quitFailed}</p>}
    </footer>
  );
}
