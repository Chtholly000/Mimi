import { useEffect, useRef, useState } from "react";
import { Check, X, AlertCircle } from "lucide-react";
import { TransientToast } from "../../lib/transientToast";
import { invoke } from "@tauri-apps/api/core";
import { effectiveUiLanguage } from "../../lib/i18n";
import { isTauri } from "../../lib/ipc";
import { writeDiagnosticClipboard } from "../../lib/diagnosticClipboard";

const copy = {
  en: {
    close: "Dismiss notification", title: "Need help?", copy: "Copy diagnostics", issue: "Give feedback on GitHub",
    copied: "Copied successfully", failed: "Could not copy. Try again or copy the report below manually.",
    prepareFailed: "Could not prepare diagnostics. Try again.",
    opened: "GitHub opened. Review the report and describe the problem before submitting.",
    paste: "GitHub opened. Copy diagnostics, then paste them into the report before submitting.",
    openFailed: "Could not open GitHub. Copy diagnostics and visit the Mimi repository.", preview: "Diagnostic snapshot",
  },
  zh: {
    close: "关闭提示", title: "遇到问题？", copy: "复制诊断信息", issue: "去 GitHub 反馈",
    copied: "复制成功", failed: "复制失败，请重试或手动复制下方文字。",
    prepareFailed: "暂时无法准备诊断信息，请重试。",
    opened: "已打开 GitHub。请检查内容、描述问题后再提交。",
    paste: "已打开 GitHub。请先复制诊断信息，再粘贴到反馈正文后提交。",
    openFailed: "暂时无法打开 GitHub，请复制诊断信息并前往 Mimi 仓库。", preview: "诊断快照",
  },
  ja: {
    close: "通知を閉じる", title: "お困りですか？", copy: "診断情報をコピー", issue: "GitHub で報告",
    copied: "コピー成功", failed: "コピーできませんでした。再試行するか、下のテキストを手動でコピーしてください。",
    prepareFailed: "診断情報を準備できませんでした。再試行してください。",
    opened: "GitHub を開きました。内容を確認し、問題を説明してから送信してください。",
    paste: "GitHub を開きました。診断情報をコピーして本文に貼り付けてから送信してください。",
    openFailed: "GitHub を開けませんでした。診断情報をコピーし、Mimi リポジトリにアクセスしてください。", preview: "診断スナップショット",
  },
};
const isFailure = (value: Feedback) => value === "failed" || value === "prepareFailed" || value === "openFailed";
type Feedback = "copied" | "failed" | "prepareFailed" | "opened" | "paste" | "openFailed" | null;
interface SupportIssue { report: string; requiresPaste: boolean }

export function SupportDiagnostics() {
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const operation = useRef(false);
  const lifetime = useRef(0);
  const toast = useRef<TransientToast<Feedback> | null>(null);
  if (toast.current === null) { toast.current = new TransientToast<Feedback>(setFeedback); }
  useEffect(() => {
    const clear = () => { lifetime.current += 1; toast.current?.clear(); };
    const hidden = () => { if (document.hidden) clear(); };
    window.addEventListener("hashchange", clear);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      lifetime.current += 1;
      toast.current?.dispose();
      window.removeEventListener("hashchange", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const text = copy[effectiveUiLanguage()];
  if (!isTauri) return null;
  const prepare = async () => {
    const value = await invoke<string>("support_diagnostics");
    if (typeof value !== "string" || value.length > 4096) throw new Error("invalid_diagnostics");
    setReport(value);
    return value;
  };
  const perform = async (action: "copy" | "issue") => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setManualCopy(false);
    toast.current?.clear();
    const currentLifetime = lifetime.current;
    const notify = (value: Feedback) => {
      if (currentLifetime === lifetime.current) toast.current?.show(value, isFailure(value));
    };
    try {
      if (action === "issue") {
        // Backend builds the fixed public destination from typed whitelist facts.
        const issue = await invoke<SupportIssue>("app_open_support_issue");
        setReport(issue.report);
        notify(issue.requiresPaste ? "paste" : "opened");
      } else {
        // Preserve the click gesture for WebKit while preparing a fresh report.
        const value = prepare();
        try { await writeDiagnosticClipboard(value); notify("copied"); }
        catch {
          try {
            await value;
            if (currentLifetime === lifetime.current) setManualCopy(true);
            notify("failed");
          } catch { notify("prepareFailed"); }
        }
      }
    } catch { notify(action === "issue" ? "openFailed" : "prepareFailed"); }
    finally { operation.current = false; setBusy(false); }
  };
  const failed = isFailure(feedback);
  return <section className="settings-support-diagnostics" aria-label={text.title} aria-busy={busy}>
    <strong>{text.title}</strong>
    <div className="settings-support-diagnostics__actions">
      <button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={busy}
        onClick={() => void perform("copy")}>{text.copy}</button>
      <button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={busy}
        onClick={() => void perform("issue")}>{text.issue}</button>
    </div>
    {feedback && <div className="settings-diagnostic-toast" data-error={failed} role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} aria-atomic="true">
      {failed ? <AlertCircle size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
      <span>{text[feedback]}</span>
      <button type="button" aria-label={text.close} onClick={() => toast.current?.clear()}><X size={16} aria-hidden="true" /></button>
    </div>}
    {manualCopy && report && <textarea aria-label={text.preview} value={report} readOnly rows={7} wrap="off" spellCheck={false} />}
  </section>;
}
