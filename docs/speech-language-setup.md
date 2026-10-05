# Speech services and language setup

## English

A third-party service can use a language selected in Mimi **only if its endpoint, protocol and model accept the parameter Mimi sends**. Choosing a language does not add it to a model. Speech recognition and text translation are separate stages.

### Configure a custom recognition service

1. Open **Settings → Speech & Translation**, add **Custom Recognition (DashScope Compatible)** or **Custom Recognition (OpenAI Realtime Compatible)** according to the service's documented protocol.
2. Enter its **full WebSocket URL**, deployed **recognition model ID**, and API key. A website, HTTP file-transcription endpoint, or Chat Completions endpoint cannot be used as live recognition.
3. Save recognition settings and select the profile. Enable **Skip translation** to test recognition alone. The recognition language below belongs to this active profile.
4. Choose **Service default** to omit language parameters. Use a specific language only when the service documents that code and parameter. Save/check success confirms the connection contract, not recognition quality or support for every displayed language.
5. Use **Check recognition** beside recognition. Once recognition works, configure and check text translation separately, then disable Skip translation if needed.

Examples of configuration values (use your own service key; region/account availability still applies):

| Protocol | Full WebSocket address | Recognition model example | Specific English choice sends |
| --- | --- | --- | --- |
| DashScope | `wss://dashscope.aliyuncs.com/api-ws/v1/inference` | `qwen-audio-3.0-asr-flash-streaming` | `payload.parameters.language_hints: ["en"]` |
| OpenAI standalone transcription | `wss://api.openai.com/v1/realtime` | `gpt-4o-mini-transcribe` | `session.audio.input.transcription.language: "en"` |
| OpenAI live transcription family | Same standalone transcription URL, or a documented compatible endpoint | `gpt-live-transcribe` | `session.audio.input.transcription.languages: ["en"]` |

The model name selects the field shape; it does not establish compatibility of a custom host. Remote addresses require `wss://`; only loopback accepts `ws://`. No URL query parameters are accepted by the custom editor. Bearer authentication, PCM format, acknowledgements and result events must match the selected protocol. See [DashScope events](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-client-events) and [OpenAI transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).

The custom picker exposes 30 explicit codes that Mimi can encode in recognition-only mode: `zh en ja ko vi th id ms tl hi ar fr de es pt ru it nl sv da fi no el pl cs hu ro bg hr sk`. This is **not a model support list**. When a separate text translation service is enabled, its currently implemented explicit-source mapping narrows the picker to Chinese, English, Japanese and Korean plus Service default. If enabling translation changes the recognition language to Service default, a transient notice names the adjustment. Auto-detected languages outside that mapping remain automatic for DeepL/DeepLX rather than failing locally. Arbitrary custom translation models may have their own limits.

### Automatic detection, hints and explicit input

| Current route | Meaning of recognition choice | Output choices in this implementation |
| --- | --- | --- |
| Alibaba Audio3 | Auto omits `language_hints`; a specific choice sends one hint, not a strict language filter | Default Qwen-MT Lite route: 31 translations plus Original; recognition-only: 30 explicit sources plus Auto |
| OpenAI dedicated translation | Input detection remains automatic | 13: Chinese, English, Japanese, Korean, Russian, Spanish, French, Portuguese, German, Italian, Vietnamese, Indonesian, Hindi |
| Gemini dedicated translation | Input detection remains automatic | 30 represented targets; Simplified/Traditional Chinese map separately; Filipino uses `fil`. Portuguese needs a regional choice and is not exposed yet |
| xAI Grok Voice | Auto omits `language_hint`; a specific choice biases recognition | Input hints: Chinese, English, Japanese, Korean, Vietnamese, Indonesian, Hindi, French, German, Russian, Italian. Translation remains prompt-directed Chinese/English/Japanese |
| Tencent / Baidu / Volcano | Explicit input required; there is no general Auto choice in these integrations | Existing verified/implemented subsets; see audit below |
| Any custom endpoint | Service default omits the parameter; actual default behavior and support depend on its model | Unknown until checked against that service's documentation |

### Official API audit — 2026-10-05

This audit distinguishes current code coverage from official capability. It is not a live-account acceptance report.

| Service and primary source | Confirmed alignment or gap |
| --- | --- |
| [Audio3](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-client-events) / [Qwen-MT](https://help.aliyun.com/zh/model-studio/machine-translation#supported-languages) | Audio3's 30 hint codes and Auto omission match. The API accepts up to four hints; Mimi intentionally sends one. The default Lite translation table has 31 entries; do not substitute the Plus model's table. The effective desktop route is Audio3 plus text translation, not the legacy integrated live-translate encoder. |
| [OpenAI dedicated translation](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide) | Expanded output from three to all 13 documented codes; no unsupported input-language field was added. Ordinary transcription has a different contract. |
| [Gemini dedicated translation](https://ai.google.dev/gemini-api/docs/live-api/live-translate#supported-languages) | Expanded to the 30 unambiguous represented targets. `zh→zh-Hans`, `zh_tw→zh-Hant`, `tl→fil`; `pt-BR`/`pt-PT` still need distinct product choices. |
| [xAI Voice](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech#language-hint) | Added the missing optional input hint. Spanish/Portuguese regional variants, ambiguous Arabic region defaults and languages outside Mimi's source enum remain unexposed. A hint is not a forced-language guarantee. |
| [Azure dedicated translation](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets#translate-audio-in-real-time) | Retains three outputs in Mimi. Official dedicated examples include German; Azure's complete deployment-specific range was not established here. OpenAI's public catalog is not silently assigned to Azure aliases. |
| [Tencent](https://cloud.tencent.com/document/product/1093/127565) | Retains four sources and three targets. Official support is larger but uses a language-pair matrix; flat expansion would allow invalid pairs. `zh_en` is Chinese/English mixing, not universal Auto. |
| [Baidu](https://ai.baidu.com/ai-doc/MT/Sl9p2h5k9) | Retains four sources and three targets. Official documentation lists 45 languages; expanding the catalog requires provider-specific code mappings, not raw ISO codes. This remains a known gap. |
| [Volcano product overview](https://docs.volcengine.com/docs/DoubaoVoice/ProductOverview-3?lang=zh) / [API entry](https://docs.volcengine.com/docs/6561/1756902?lang=zh) | No range expansion. Existing Mimi code exposes Chinese/English/Japanese; the accessible current overview advertises Chinese/English. Japanese support still needs exact API/account verification and is not newly certified here. |
| [DeepL request](https://developers.deepl.com/api-reference/translate/request-translation) / [language API](https://developers.deepl.com/docs/languages/using-the-languages-api) | Preserves Auto by omitting `source_lang` when an ASR report cannot be mapped locally. Source/target catalogs differ; broader DeepL language selection is still not exposed. No account capability lookup was made. |
| [DeepLX/DLX upstream](https://github.com/OwO-Network/DLX) / [OpenAI-compatible chat](https://developers.openai.com/api/reference/resources/chat) | DeepLX is not official DeepL and depends on its deployment. Chat-compatible translation uses instructions, with no universal language-capability discovery. Neither protocol implies support for all languages. |

Custom recognition editors remain a desktop feature. Android shares the changed OpenAI/Gemini/xAI wire behavior and catalogs, but its Alibaba model/route differs; no desktop-only custom profile is implied. Apple, Whisper, Parakeet, FunASR and Qwen local experiments are not included or installed by this change.

## 中文

**三方服务可以配置语言，前提是该地址、协议和识别模型支持 Mimi 发出的参数。** 选语言不能给模型增加语种；识别语言与翻译目标是两回事。

### 怎么接入

1. 打开「设置 → 语音与翻译」，按服务文档选择「自定义识别（阿里云兼容）」或「自定义识别（OpenAI 实时兼容）」。
2. 填入完整 WebSocket 地址、实际部署的识别模型 ID 和密钥，点击「保存识别配置」。不能填网页地址、HTTP 文件转写接口或 Chat Completions 地址。上方表格给出了官方地址与模型示例；不要把翻译模型填进识别模型。
3. 使用这项服务配置，先开启「跳过翻译」，只测试语音转文字，再在下方选择「识别语言」。
4. 「服务默认」代表不发送语言参数，是否自动检测取决于对端。选择英语等具体语言会发送对应参数；请先确认该模型接受这个代码。连接检查成功不代表识别质量好，也不证明列表里每种语言都可用。
5. 点击识别旁的检查操作。识别正常后，再独立配置并检查文字翻译，按需关闭「跳过翻译」。

阿里兼容接入发送 `language_hints: ["en"]`；OpenAI 独立转写通常发送 `transcription.language: "en"`，`gpt-live-transcribe` 系列改用 `transcription.languages: ["en"]`。自动/服务默认时省略这些字段。模型名只用于选择字段形状，不能证明任意兼容地址支持该能力。区域地址与账户权限请以服务自己的文档为准；这里不会自动探测私有地址。

自定义识别的原文模式可选择 Mimi 能编码的 30 种语言代码（见上方完整代码表），**它们不是模型支持列表**。开启独立文字翻译后，当前文字接口显式源语种映射仍将选项限制为中、英、日、韩及服务默认。如果开启翻译使识别语言回到服务默认，界面会用短暂通知说明实际调整。选自动时，DeepL/DeepLX 对无法本地映射的检测结果保留服务自动检测，不再因法语、德语等报告在本地失败。

### 手动还是自动

- **阿里 Audio3 / xAI：** 不确定输入语言可选自动；已知单一语言可给提示。提示会偏向该语言，不保证严格排除其他语言。
- **OpenAI / Gemini 专用实时翻译：** 输入语言由服务检测，不需要手动填源语言。OpenAI 当前可选 13 种输出；Gemini 可选 Mimi 已表示且映射明确的 30 种输出。葡萄牙语地区变体不擅自代选。
- **腾讯 / 百度 / 火山当前接入：** 必须明确选输入语言。当前选项是 Mimi 已接入的子集，并非服务的完整官方范围。
- **自定义服务：** 支持范围未知，按自己的 endpoint 和 model 文档配置。若本地桥忽略语言提示，Mimi 的选择不会改变模型行为。

上方官方审计表逐项列出本次已补齐和仍未覆盖的范围：xAI hint、OpenAI/Gemini 输出已补；腾讯语言对矩阵、百度完整专有代码、Azure 更广输出、火山日语核验和更广独立文字翻译语言仍有明确边界。不能把这次修改称为“所有官方 API 全量对齐”。此文档和协议测试没有使用云端付费请求，也不代表账户、网络或音频质量的验收。
