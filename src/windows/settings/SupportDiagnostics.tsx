import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { effectiveUiLanguage } from "../../lib/i18n";
import { isTauri } from "../../lib/ipc";

const copy = {
  en: {
    view: "View diagnostics", copy: "Copy diagnostics", copied: "Copied",
    note: "Review this snapshot before copying. It excludes keys, audio, subtitles, device names and private addresses. Nothing is sent automatically. Reopen to refresh.",
    loading: "Preparing diagnostics…", failed: "Diagnostics could not be prepared. Reopen to try again.",
    copyFailed: "Copy was unavailable. Select the text below and copy it.",
    preview: "Diagnostic snapshot",
  },
  zh: {
    view: "查看诊断信息", copy: "复制诊断信息", copied: "已复制",
    note: "复制前可查看这份快照。不含密钥、音频、字幕、设备名和私有地址，不会自动发送。重新展开可刷新。",
    loading: "正在准备诊断信息…", failed: "暂时无法准备诊断信息，请重新展开重试。",
    copyFailed: "暂时无法自动复制，请选中下面的文字后复制。",
    preview: "诊断快照",
  },
  ja: {
    view: "診断情報を表示", copy: "診断情報をコピー", copied: "コピーしました",
    note: "コピー前に内容を確認できます。キー、音声、字幕、デバイス名、非公開アドレスは含まれません。自動送信はしません。開き直すと更新されます。",
    loading: "診断情報を準備しています…", failed: "診断情報を準備できませんでした。開き直して再試行してください。",
    copyFailed: "自動コピーを利用できません。下のテキストを選択してコピーしてください。",
    preview: "診断スナップショット",
  },
};

export function SupportDiagnostics() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const previewRevision = useRef(0);
  const text = copy[effectiveUiLanguage()];
  useEffect(() => {
    if (!open || !isTauri) return;
    let disposed = false;
    void invoke<string>("support_diagnostics").then((value) => {
      if (disposed) return;
      if (typeof value !== "string" || value.length > 4096) { setFailed(true); return; }
      setReport(value);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [open]);
  if (!isTauri) return null;
  const copyReport = async () => {
    if (!report) return;
    const revision = previewRevision.current;
    try {
      // Copy exactly the visible frozen preview, never a fresh hidden report.
      await navigator.clipboard.writeText(report);
      if (previewRevision.current === revision) {
        setCopied(true);
        setCopyFailed(false);
      }
    } catch { if (previewRevision.current === revision) setCopyFailed(true); }
  };
  return (
    <details className="settings-session-help settings-support-diagnostics"
      onToggle={(event) => {
        previewRevision.current += 1;
        setReport(null);
        setFailed(false);
        setCopied(false);
        setCopyFailed(false);
        setOpen(event.currentTarget.open);
      }}>
      <summary>{text.view}</summary>
      <p>{text.note}</p>
      {failed ? <p role="alert">{text.failed}</p> : report ? <>
        <textarea aria-label={text.preview} value={report} readOnly rows={12} spellCheck={false} />
        <button type="button" className="settings-button settings-button--quiet settings-button--compact"
          onClick={() => void copyReport()}>{copied ? text.copied : text.copy}</button>
        {copyFailed && <p role="alert">{text.copyFailed}</p>}
      </> : <p role="status">{text.loading}</p>}
    </details>
  );
}
