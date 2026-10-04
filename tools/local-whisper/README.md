# 本地 Whisper 识别（macOS Apple Silicon）

此独立服务把 whisper.cpp Metal 的 large-v3-turbo Q5_0 接到 Mimi 现有的
「自定义语音识别 / DashScope」渠道。模型只做语音转文字；翻译使用该配置
单独选择的文字翻译服务。没有新渠道、麦克风权限、音频捕获或默认录制。

## 安装与运行

需要 macOS Apple Silicon、Xcode Command Line Tools、`cmake`、`uv`。
在仓库根目录执行 `sh tools/local-whisper/install.sh`。下载约 547 MiB 模型，
校验固定 SHA-256，构建 Metal worker，保留构建/下载缓存，不自动加载模型。
安装目录为 `~/.local/share/mimi-local-models/whisper`。

```sh
~/.local/share/mimi-local-models/whisper/control.sh start
~/.local/share/mimi-local-models/whisper/control.sh status
~/.local/share/mimi-local-models/whisper/control.sh stop
```

仅手工 bootstrap launchd，未放入 `LaunchAgents`，不登录自启。标准输出与
错误输出均为 `/dev/null`。启动先加载模型，再监听 `127.0.0.1:18082`；状态
同时核对 launchd 配置、PID、进程参数和精确监听地址，不以“端口被占用”
充当服务正常。stop 仅停止这个 job，不联动 Index 或其他模型服务。

## Mimi 配置

添加「自定义语音识别」，选择 DashScope 协议：

| 字段 | 值 |
| --- | --- |
| Endpoint | `ws://127.0.0.1:18082/asr` |
| Model | `whisper-large-v3-turbo-q5_0` |
| API Key | 安装目录 `bridge-token` 文件的随机本地令牌 |
| 识别语言 | 本轮优先 English；支持 Mimi 已有的显式语言和自动识别 |

令牌仅存于权限 0600 的私有文件，不在启动参数、环境或日志中。可自行用
`pbcopy < ~/.local/share/mimi-local-models/whisper/bridge-token` 复制到 Mimi
的密钥输入框，再清理剪贴板。Mimi 会保存到独立凭据文件。无需云端识别密钥。

若用 Index 翻译，需独立启动 Index 的 `127.0.0.1:18080` 服务，并在同一配置
的文字翻译部分选 OpenAI Compatible、Endpoint `http://127.0.0.1:18080/v1`、
Model `index-translate-2b`，按该服务要求填写或留空文字翻译 Key。

## 边界与验证

- 单模型、最多两路独立会话，公平串行推理；每路有独立 PCM、句子 ID 和结果。
- 20 ms 能量门控、300 ms 前置音频、600 ms 静音收尾、最长 8 秒分段。
  这不是训练过的 VAD；音乐、低音量和无停顿语音仍需真实样本验证。
- 每 2 秒重新识别当前分段得到可替换预览；待完成分段最多两条。超过上限
  明确失败，不静默丢最终结果。Whisper 不是原生增量流式模型。
- 已断开会话的结果不再发送；已进入推理的请求最多 15 秒，期间不打断其他
  会话。服务异常会退出，显式 stop/start 后重试。EOF/finish 会处理尾部。
- 服务不写 PCM、识别正文或令牌日志。试验脚本只有在明确运行并指定本地
  结果路径时，才保存合成测试样本的结果。

`make_samples.py OUTPUT` 生成 24 句原创公开文本的系统合成语音、reference、
哈希清单及带 1 秒间隔的组合 WAV。文本按 CC0 提供；生成音频保留本机。
这组样本覆盖否定、数字、专名和游戏句子，不能代表真人、口音、背景音乐、
其他语言或总体准确率。原生 Mimi 捕获及浮窗验收与直接桥接测试分开报告。

## 固定上游

- [whisper.cpp v1.9.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4)，
  commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`，MIT。
- [large-v3-turbo Q5_0](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1)，
  574,041,195 bytes，SHA-256
  `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`。
- [OpenAI Whisper](https://github.com/openai/whisper)：模型和代码 MIT；turbo
  是 809M 多语言识别模型，未为语音翻译训练，不使用其输出直接代替中文翻译。
