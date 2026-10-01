import { connectionDiagnosticMessage, diagnosticCopy } from "../../lib/connectionDiagnostics";
import type { ConnectionDiagnostic } from "../../lib/ipc";
import { InlineFeedback } from "./SettingsPrimitives";

export function ConnectionCheck({ result, error, pending, disabled, onCheck }: {
  result: ConnectionDiagnostic | null; error: string | null;
  pending: boolean; disabled: boolean; onCheck: () => void;
}) {
  const labels = diagnosticCopy();
  const tone = result?.service === "available" ? "success" : result?.service === "unavailable" ? "error" : "info";
  return <div className="connection-check">
    <button type="button" className="settings-button settings-button--quiet" disabled={disabled || pending} onClick={onCheck}>{pending ? labels.testing : labels.test}</button>
    {result && <InlineFeedback tone={tone}>{connectionDiagnosticMessage(result)}</InlineFeedback>}
    {error && <InlineFeedback tone="error">{error}</InlineFeedback>}
  </div>;
}
