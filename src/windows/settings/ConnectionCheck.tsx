import { connectionDiagnosticMessage, diagnosticCopy, type DiagnosticPlatform } from "../../lib/connectionDiagnostics";
import type { ConnectionDiagnostic } from "../../lib/ipc";
import { InlineFeedback } from "./SettingsPrimitives";

export function ConnectionCheck({ result, error, pending, disabled, onCheck, platform }: {
  result: ConnectionDiagnostic | null; error: string | null;
  pending: boolean; disabled: boolean; onCheck: () => void; platform?: DiagnosticPlatform;
}) {
  const labels = diagnosticCopy(platform);
  const failed = result && (result.credential !== "present" || ["timeout", "unreachable"].includes(result.network));
  return <div className="connection-check">
    <button type="button" className="settings-button settings-button--quiet" disabled={disabled} onClick={onCheck}>{pending ? labels.testing : labels.test}</button>
    {result && <InlineFeedback tone={failed ? "error" : "info"}>{connectionDiagnosticMessage(result)}</InlineFeedback>}
    {error && <InlineFeedback tone="error">{error}</InlineFeedback>}
    {(result || error) && <details><summary>{labels.help}</summary><p>{labels.details}</p></details>}
  </div>;
}
