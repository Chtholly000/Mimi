# Apple 本地语音识别

## 范围

在符合条件的 Mac 上提供独立的 Apple Speech 识别渠道，复用 Mimi 的
系统声音／显式麦克风采集和独立文字翻译管线。语音识别在设备上运行，
翻译可选择已有的 Index 等 OpenAI 兼容服务；这不是 Apple 文字翻译集成。
本次通过 PR 交付供观察，不合并 main。使用稳定签名的 canonical dev 验证。

## 原生边界

- 使用 macOS 26 的 `SpeechAnalyzer` / `SpeechTranscriber`，仅 Apple
  silicon 构建链接 Swift 静态库。最低应用部署版本仍为 macOS 13；所有新
  API 入口经过系统版本和 `SpeechTranscriber.isAvailable` 检查。
- Apple silicon 的 macOS 构建需要 Xcode 26+；缺少 SDK 时明确失败。
  Intel、Windows、Linux 编译不可用实现，不链接 Swift 或显示添加入口。
  用户安装后的应用不需要 Python、Xcode、WebSocket 桥或识别 API Key。
- 每个声音来源拥有独立原生 session、有界 PCM 和结果队列。取消、清空、
  重连以代次隔离迟到结果；草稿替换同一句，确认结果保留稳定身份。
  继续使用既有共享字幕核心及最终翻译策略，不增加另一个字幕 reducer。
- C ABI 只跨越数据、生命周期和净化后的状态；文本不进入普通日志，
  Swift 不拥有系统捕获或麦克风权限。沿用已有的采集授权和保存开关。

## 服务与语言

- 新增 `appleSpeech` profile，识别无凭据。独立文字翻译仍使用自己的
  私有凭据槽；不创建空识别密钥、不访问 legacy OS 凭据。
- 设置页读取系统支持的 locales，与 Mimi 现有语言枚举求交集。没有自动
  识别选项。每种语言固定一个明确 locale，安装状态改变不自动切换地区。
  同一能力快照供设置、托盘和浮窗控件使用。
- 添加入口仅在系统实际可用时展示；创建、选择和启动在后端再次校验。
  已保存但本机不可用的配置保留可编辑，不自动切换到云识别。
- 用户选择识别语言，资源缺失时点击“准备语言”；只有这个明确动作可以
  请求下载资产。显示准备中、已就绪和可重试的失败，普通查询和开始识别
  不隐式下载。额外解释放在相邻帮助提示，状态和恢复动作常规字号可见。
- 使用 Apple 官方标志，与现有服务图标的尺寸、深浅主题及可访问标签一致。
  识别不显示地址、模型、Key 或网络代理；文字翻译保留独立设置与连接检查。

## 验证与交付

- 覆盖不可用平台、动态语言及地区选择、资源准备失败、无识别密钥、独立
  MT 槽、partial/final、清空／取消／收尾和队列上限；执行仓库完整检查。
- 复用公开合成英文样本，分别验证原生适配层和文字翻译，不把样本正确或
  请求耗时泛化为真人准确率和采音至显示的端到端延迟。
- 通过稳定签名的开发应用检验设置、系统音频捕获与浮窗。PR 逐项列出
  实际验证与剩余限制；不因独立桥接成功宣称完成原生应用验收。
- Apple 本地识别是 macOS 特有能力；Android 和其他桌面平台维持原有渠道。

参考：[SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)、
[SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)、
[AssetInventory](https://developer.apple.com/documentation/speech/assetinventory)。
