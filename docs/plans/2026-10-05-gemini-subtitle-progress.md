# 实时字幕在上一条确认后继续显示

用户观察到 Gemini 后台当前识别与译文增长，但浮窗停留在旧句。
源码确认的最早失配在桌面展示选择：共享 reducer 接受 FinalPair 后保留
已确认 displayPair；后续 SourceDraft / TranslationDraft 更新原始行，
overlayModel 却无条件优先 displayPair，或因其已在 history 中提前返回空。
因此即使快照包含新草稿，也不会选择给浮窗。此结论来自读码，未复现用户会话。

Gemini 的 stable-block committer 不以相同标点数量推断双语对齐；它等待
已有 turn / quiet 边界再确认。保留该协议及共享提交规则，不靠伪 final、
强制分句或降低确认条件绕过显示问题。长轮次会放大被隐藏草稿的持续时间。

修复只放在桌面 overlayModel：非 atomic 的实时路由在当前可见语言有
非 final 草稿时，允许该草稿越过旧 displayPair。双语草稿只有一侧先到时，
剔除仍属于旧确认 pair 的另一侧 final 行，避免把旧译文挂到新原文下；
显式 utterance 身份不同的行保持独立。只按 final 标记区分确认，不把相同
文字视为重复草稿。纯译文模式在新译文到来前保留旧确认显示。

ASR + 独立 HTTP 翻译仍使用完整 preview pair；关闭中间字幕的过滤仍先于
上述选择；Original / 同语言显示保持原规则。共享 reducer、历史、存储、
协议与 Android 不变。浮窗、开发回放与开发展示追踪复用同一 selector。

新增用例仅含合成文字，覆盖有/无显示历史、双侧草稿、新原文先到、新译文
先到、显式身份、相同文字新草稿、中间字幕关闭和 atomic 旧行为。
按本轮用户要求只修改源码，不运行测试、构建、模型请求、原生 UI 或 CI；
这些回归用例尚未执行，真实 Gemini 长轮次与可见浮窗结果仍待验证。
