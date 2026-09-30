import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { effectiveUiLanguage } from "../../lib/i18n";
import { isTauri } from "../../lib/ipc";

const copy = {
  en: {
    title: "Need help?", copy: "Copy diagnostics", issue: "Give feedback on GitHub", details: "View details",
    note: "No keys, audio or subtitles. GitHub feedback is public; review before submitting.",
    copied: "Copied successfully", failed: "Could not copy. Open details and copy the text manually.",
    loading: "Preparing…", prepareFailed: "Could not prepare diagnostics. Try again.",
    opened: "GitHub opened. Review the report and describe the problem before submitting.",
    paste: "GitHub opened. Copy diagnostics, then paste them into the report before submitting.",
    openFailed: "Could not open GitHub. Copy diagnostics and visit the Mimi repository.", preview: "Diagnostic snapshot",
  },
  zh: {
    title: "遇到问题？", copy: "复制诊断信息", issue: "去 GitHub 反馈", details: "查看详细信息",
    note: "不含密钥、音频或字幕。GitHub 反馈将公开，提交前请检查。",
    copied: "复制成功", failed: "复制失败，请展开详情并手动复制文字。",
    loading: "正在准备…", prepareFailed: "暂时无法准备诊断信息，请重试。",
    opened: "已打开 GitHub。请检查内容、描述问题后再提交。",
    paste: "已打开 GitHub。请先复制诊断信息，再粘贴到反馈正文后提交。",
    openFailed: "暂时无法打开 GitHub，请复制诊断信息并前往 Mimi 仓库。", preview: "诊断快照",
  },
  ja: {
    title: "お困りですか？", copy: "診断情報をコピー", issue: "GitHub で報告", details: "詳細を表示",
    note: "キー、音声、字幕は含みません。GitHub の報告は公開されます。送信前に確認してください。",
    copied: "コピー成功", failed: "コピーできませんでした。詳細を開き、テキストを手動でコピーしてください。",
    loading: "準備中…", prepareFailed: "診断情報を準備できませんでした。再試行してください。",
    opened: "GitHub を開きました。内容を確認し、問題を説明してから送信してください。",
    paste: "GitHub を開きました。診断情報をコピーして本文に貼り付けてから送信してください。",
    openFailed: "GitHub を開けませんでした。診断情報をコピーし、Mimi リポジトリにアクセスしてください。", preview: "診断スナップショット",
  },
};
type Feedback = "copied" | "failed" | "prepareFailed" | "opened" | "paste" | "openFailed" | null;
interface SupportIssue { report: string; requiresPaste: boolean }

export function SupportDiagnostics() {
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const operation = useRef(false);
  const text = copy[effectiveUiLanguage()];
  if (!isTauri) return null;
  const prepare = async () => {
    const value = await invoke<string>("support_diagnostics");
    if (typeof value !== "string" || value.length > 4096) throw new Error("invalid_diagnostics");
    setReport(value);
    return value;
  };
  const perform = async (action: "copy" | "issue" | "details") => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      if (action === "issue") {
        // Backend builds the fixed public destination from typed whitelist facts.
        const issue = await invoke<SupportIssue>("app_open_support_issue");
        setReport(issue.report);
        setFeedback(issue.requiresPaste ? "paste" : "opened");
      } else {
        // A visible preview is frozen; otherwise copy a fresh observation.
        const value = action === "copy" && detailsOpen && report ? report : await prepare();
        if (action === "copy") {
          try { await navigator.clipboard.writeText(value); setFeedback("copied"); }
          catch { setFeedback("failed"); }
        }
      }
    } catch { setFeedback(action === "issue" ? "openFailed" : "prepareFailed"); }
    finally { operation.current = false; setBusy(false); }
  };
  const failed = feedback === "failed" || feedback === "prepareFailed" || feedback === "openFailed";
  return <section className="settings-support-diagnostics" aria-label={text.title} aria-busy={busy}>
    <strong>{text.title}</strong>
    <div className="settings-support-diagnostics__actions">
      <button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={busy}
        onClick={() => void perform("copy")}>{text.copy}</button>
      <button type="button" className="settings-button settings-button--quiet settings-button--compact" disabled={busy}
        onClick={() => void perform("issue")}>{text.issue}</button>
    </div>
    <p className="settings-support-diagnostics__note">{text.note}</p>
    {(busy || feedback) && <p className="settings-support-diagnostics__feedback" data-error={failed} role={failed ? "alert" : "status"}>
      {feedback === "copied" && !busy ? "✓ " : ""}{busy ? text.loading : feedback ? text[feedback] : null}
    </p>}
    <details className="settings-session-help" onToggle={(event) => {
      setDetailsOpen(event.currentTarget.open);
      if (event.currentTarget.open && !operation.current) void perform("details");
    }}>
      <summary>{text.details}</summary>
      {report && <textarea aria-label={text.preview} value={report} readOnly rows={7} wrap="off" spellCheck={false} />}
    </details>
  </section>;
}
