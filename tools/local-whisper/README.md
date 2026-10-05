# 本地 Whisper 识别（macOS Apple Silicon）

此独立服务把 whisper.cpp Metal 的 large-v3-turbo Q5_0 接到 Mimi 现有的
「自定义语音识别 / DashScope」渠道。模型只做语音转文字；翻译使用该配置
单独选择的文字翻译服务。没有新渠道、麦克风权限、音频捕获或默认录制。
这是英文实测的可选实验适配，其他语种、噪声环境及长时间双路尚未验收。

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
| 识别代理 | Direct（直连本机） |
| 识别语言 | 本轮选择 English；兼容现有选择器的中文/日文/韩文/自动，尚未实测这些语种 |

令牌仅存于权限 0600 的私有文件，不在启动参数、环境或日志中。可自行用
`pbcopy < ~/.local/share/mimi-local-models/whisper/bridge-token` 复制到 Mimi
的密钥输入框，再清理剪贴板。Mimi 会保存到独立凭据文件。无需云端识别密钥。

若用 Index 翻译，需独立启动 Index 的 `127.0.0.1:18080` 服务，并在同一配置
的文字翻译部分选 OpenAI Compatible、Endpoint `http://127.0.0.1:18080/v1`、
Model `index-translate-2b`，按该服务要求填写或留空文字翻译 Key。

## 边界与验证

- 单模型、最多两路独立会话，公平串行推理；每路有独立 PCM、句子 ID 和结果。
  同长 9.518 秒样本的同时 EOF 实测为 457/735 ms，低于 Mimi 当前 1 秒识别
  收尾期限；这不是任意负载的保证。已在推理中的预览不可立即取消，可能
  拖慢最终结果，长会话及与翻译模型争用资源仍需验证。
- 20 ms 能量门控、300 ms 前置音频、200 ms 静音收尾、最长 8 秒分段。
  这不是训练过的 VAD；音乐、低音量和无停顿语音仍需真实样本验证。
- 每 2 秒重新识别当前分段得到可替换预览；待完成分段最多两条。超过上限
  明确失败，不静默丢最终结果。Whisper 不是原生增量流式模型。
  encoder context 固定 1024（20.48 秒），覆盖每条最多 8 秒的音频；语言质量
  需按此具体配置评估。排队预览若已被最终分段取代，会在进入推理前跳过。
- 已断开会话的结果不再发送；取消单路不终止共享 worker，已进入推理的
  请求最多 15 秒。服务异常会退出，显式 stop/start 后重试。EOF 会处理尾部。
- 服务不写 PCM、识别正文或令牌日志。试验脚本只有在明确运行并指定本地
  结果路径时，才保存明确提供的公开测试样本结果。

`make_samples.py OUTPUT` 生成 24 句原创公开文本的系统合成语音、reference、
哈希清单及带 1 秒间隔的组合 WAV。文本按 CC0 提供；生成音频保留本机。
这组样本覆盖否定、数字、专名和游戏句子，不能代表真人、口音、背景音乐、
其他语言或总体准确率。原生 Mimi 捕获及浮窗验收与直接桥接测试分开报告。
`fetch_jfk.py OUTPUT` 下载固定版本的官方 JFK 真人录音及哈希、参考来源。

在仓库根目录执行以下命令可重放相同测试，输出仅写入指定的新文件：

```sh
whisper_root="$HOME/.local/share/mimi-local-models/whisper"
sample_root="$HOME/.local/share/mimi-local-models/samples"
python3 tools/local-whisper/make_samples.py "$sample_root/english-24-v1"
python3 tools/local-whisper/fetch_jfk.py "$sample_root/jfk-v1"
"$whisper_root/venv/bin/python3" tools/local-whisper/benchmark.py \
  --case "$sample_root/english-24-v1/english-24.wav" "$sample_root/english-24-v1/english-24.txt" \
  --case "$sample_root/jfk-v1/jfk.wav" "$sample_root/jfk-v1/jfk.txt" \
  --output "$whisper_root/benchmark-new.json"
```

请先停止该模型服务，再运行独立 benchmark，避免重复加载。生成器不会覆盖
已有 manifest；系统合成音色随 macOS 版本变化，比较时核对 WAV 哈希。
`--dual` 同时重放前两个输入；只提供一个 `--case` 时两路重放同一输入，可
用 `finish_sent_monotonic_s` 核对实际 EOF 间隔。混合时长的双路不能证明
同时 EOF 性能。测试结果及曾拒绝的参数见 [本机测量](measurements.md)。

## 固定上游

- [whisper.cpp v1.9.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4)，
  commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`，MIT。
- [large-v3-turbo Q5_0](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1)，
  574,041,195 bytes，SHA-256
  `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`。
- [OpenAI Whisper](https://github.com/openai/whisper)：模型和代码 MIT；turbo
  是 809M 多语言识别模型，未为语音翻译训练，不使用其输出直接代替中文翻译。
