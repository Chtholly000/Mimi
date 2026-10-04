import { useCallback, useRef, useState } from "react";

/** A click acknowledges immediately; repeated clicks share the same operation. */
export function useSessionAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const clearFailure = useCallback(() => setFailed(false), []);
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      await operation();
    } catch {
      // Native state carries the provider's sanitized error. This fallback
      // also covers a rejected IPC operation without leaking its raw value.
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);
  return { pending, failed, run, clearFailure };
}
