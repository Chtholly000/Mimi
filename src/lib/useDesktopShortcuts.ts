import { useEffect, useState } from "react";
import { appDesktopShortcutCommands, isTauri, type DesktopShortcutCommands } from "./ipc";

/** Undefined while unknown: never advertise an unverified X11 binding on Wayland. */
export function useDesktopShortcuts() {
  const [commands, setCommands] = useState<DesktopShortcutCommands | null | undefined>(
    isTauri ? undefined : null,
  );
  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    void appDesktopShortcutCommands().then((value) => {
      if (active) setCommands(value);
    }).catch(() => {
      // Keep ordinary buttons available without claiming native shortcut support.
    });
    return () => { active = false; };
  }, []);
  return { commands, nativeShortcuts: commands === null };
}
