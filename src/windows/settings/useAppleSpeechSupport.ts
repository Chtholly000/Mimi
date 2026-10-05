import { useCallback, useEffect, useRef, useState } from "react";
import { getAppleSpeechSupport } from "../../lib/ipc";
import { I18N } from "../../lib/i18n";
import type { AppleSpeechSupport } from "../../lib/types";
import { useSettingsToast } from "./useSettingsToast";

export function useAppleSpeechSupport(visible: boolean) {
  const [support, setSupport] = useState<AppleSpeechSupport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const { beginToast } = useSettingsToast();
  const load = useCallback(() => {
    const request = ++generation.current;
    const notify = beginToast();
    return getAppleSpeechSupport().then(result => {
      if (request === generation.current) { setSupport(result); setFailed(false); }
    }).catch(() => {
      if (request === generation.current) {
        setSupport(null);
        setFailed(true);
        notify(I18N.settings.appleSpeechLoadFailed, true);
      }
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
  }, [beginToast]);
  const refresh = useCallback(() => {
    setLoading(true);
    setFailed(false);
    return load();
  }, [load]);
  useEffect(() => {
    if (visible) void load();
    return () => { generation.current += 1; };
  }, [visible, load]);
  const update = useCallback((result: AppleSpeechSupport) => {
    generation.current += 1;
    setSupport(result);
    setLoading(false);
    setFailed(false);
  }, []);
  return { support, loading, failed, refresh, update };
}
