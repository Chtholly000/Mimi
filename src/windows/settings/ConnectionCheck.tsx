import { connectionDiagnosticMessage, diagnosticCopy, type DiagnosticPlatform } from "../../lib/connectionDiagnostics";
import type { ConnectionDiagnostic } from "../../lib/ipc";
import { Icon } from "../../components/Icon";
import { InlineFeedback } from "./SettingsPrimitives";
import { SettingsHelp } from "./SettingsHelp";
import { I18N } from "../../lib/i18n";

export function ConnectionCheck({ result, error, pending, disabled, onCheck, platform, label, requiresSave = false }: {
  result: ConnectionDiagnostic | null; error: string | null;
  pending: boolean; disabled: boolean; onCheck: () => void; platform?: DiagnosticPlatform;
  label?: string; requiresSave?: boolean;
}) {
  const labels = diagnosticCopy(platform);
  const tone = result?.service === "available" ? "success" : result && (result.service === "unavailable" || result.credential !== "present" || result.reason) ? "error" : "info";
  const elapsedMs = result?.service !== "notTested" && typeof result?.elapsedMs === "number" && Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0 ? Math.round(result.elapsedMs) : null;
  return <div className="connection-check">
    {result && !pending && <InlineFeedback tone={tone} icon={tone === "info" ? "help" : undefined}>{connectionDiagnosticMessage(result, platform)}{elapsedMs !== null && <span className="connection-check__elapsed">{labels.elapsed}: {elapsedMs} ms</span>}</InlineFeedback>}
    {error && <InlineFeedback tone="error">{error}</InlineFeedback>}
    {elapsedMs !== null && !pending && <SettingsHelp text={labels.elapsedHelp} label={I18N.settings.helpLabel} />}
    {requiresSave && <SettingsHelp text={I18N.settings.saveTranslationBeforeCheck} label={I18N.settings.helpLabel} />}
    <button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={disabled || pending} aria-busy={pending || undefined} onClick={onCheck}>{pending ? <span className="settings-spinner" aria-hidden="true" /> : <Icon name="checkmark-circle" />}{pending ? labels.testing : label ?? labels.test}</button>
  </div>;
}
