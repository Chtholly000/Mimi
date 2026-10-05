# 独立本地 ASR 对照

这里准备公开真人英语样本，并对保存在本机的 ASR 结果统一评分。它不启动 Mimi、不采集音频，也不请求翻译服务。模型推理需要另行串行运行，避免在 16 GB 机器上同时加载多个模型。

## 固定真人样本

数据来自 [OpenSLR LibriSpeech（SLR12）](https://www.openslr.org/12)，许可为 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。LibriSpeech 是从 LibriVox 有声书整理的英语朗读音频，原始采样率为 16 kHz；它不是游戏对话或自然会话测试。本文使用 [OpenSLR 在 Hugging Face 发布的 Parquet 镜像](https://huggingface.co/datasets/openslr/librispeech_asr/tree/71cacbfb7e2354c4226d01e70d77d5fca3d04ba1)，固定修订为 `71cacbfb7e2354c4226d01e70d77d5fca3d04ba1`。

| 来源文件 | 字节数 | SHA256 |
| --- | ---: | --- |
| `all/test.clean/0000.parquet` | 350452636 | `7113aa4c3cf963fb54697145719a7725f984c8836d1c494a554cbb9f1a017df0` |
| `all/test.other/0000.parquet` | 332873172 | `38e0c86a8104585c577badd707ca4331e20fa2c645f46180af0b7bcdecff9249` |

脚本最多并发下载两个完整分片，共 683325808 字节。下载可续传，大小及完整 SHA256 校验通过后才启用。分片留作可复用缓存；已有文件校验失败会报错，不会悄悄替换。音频从 FLAC 无损转为 16 kHz、单声道、PCM16 WAV，逐样本验证解码值一致，不重采样、不裁剪、不加静音、不做 VAD。

选择规则固定，不参考识别结果：

1. 种子为 `mimi-librispeech-asr-v1`，依次处理 `test-clean`、`test-other`。
2. 每个 split 的不同 speaker ID 转为字符串，按 `SHA256(seed|split|speaker|id)` 十六进制值升序，取前 20 位。
3. 每位 speaker 的 utterance 按 `SHA256(seed|split|utterance|id)` 升序，取第一条。
4. 输出顺序为 split 顺序、speaker 排名顺序。不按文本、时长、人口特征或主观质量筛选。

“说话人均衡”仅表示每个 split 的 20 条来自 20 位不同说话人，不代表性别、口音或音素均衡。`test-other` 是较难的朗读语音子集，不应称为人为添加噪声的音频。

本轮固定选择为 clean 20 条 / 148.425 秒，other 20 条 / 142.365 秒，共 40 条 / 290.79 秒；单条最长 27.525 秒。40 条的规模只能支持这组样本的对照，不能称为完整 LibriSpeech 官方测试结果。这个公开基准被广泛使用，模型训练集重叠情况未知。

## 准备与复现

需要 Python 3.12、`curl`，以及隔离环境中的以下固定数据处理依赖；不会安装或加载 ASR 模型。

```bash
ASR_PREP_ENV="$HOME/.local/share/mimi-local-models/benchmark-assets/preparation-venv"
ASR_SAMPLE_ROOT="$HOME/.local/share/mimi-local-models/samples/librispeech-balanced-v1"
python3.12 -m venv "$ASR_PREP_ENV"
"$ASR_PREP_ENV/bin/python" -m pip install \
  pyarrow==22.0.0 soundfile==0.13.1 numpy==2.3.3 cffi==2.1.1 pycparser==3.0
"$ASR_PREP_ENV/bin/python" tools/local-asr-benchmark/prepare_samples.py \
  --root "$ASR_SAMPLE_ROOT"
```

目录使用 0700、新文件使用 0600。`manifest.jsonl` 每行固定七个字段：

```text
id, audio_path, reference, split, speaker_id, sha256, duration_s
```

`audio_path` 是 WAV 的绝对路径；`sha256` 是 WAV 文件摘要；`duration_s` 来自实际帧数。`selection.json` 记录源行号与选择过程，`provenance.json` 记录来源、版本、摘要及转换方式。转录、音频和推理结果只保存在本机，不提交 Git。真人 manifest 不混入已有 TTS、JFK 或静音样本。

相同路径再次运行会复用校验过的下载与相同内容。若想在另一个目录独立验证，复用源分片即可，无需重复下载：

```bash
"$ASR_PREP_ENV/bin/python" tools/local-asr-benchmark/prepare_samples.py \
  --root /tmp/mimi-librispeech-reproduction \
  --source-root "$ASR_SAMPLE_ROOT" --offline
```

manifest 包含绝对路径，因此不同机器/目录的 manifest 总摘要不同；对照时比较有序 ID、reference、split、speaker、音频摘要和时长，而不是要求绝对路径相同。重新生成 WAV 时应保留相同 SoundFile/libsndfile 版本；版本信息写入 provenance。

## 统一评分约定

[score_asr.py](score_asr.py) 对同一批原始 `hypothesis` 报告两列、分别微平均（总编辑距离 / 总参考词数），不按单句 WER 做算术平均：

| 列 | 两端相同的处理 |
| --- | --- |
| Literal WER | `re.findall(r"[a-z0-9]+", text.casefold())` |
| Whisper-normalized WER | `EnglishTextNormalizer()(text).split()` |

归一化器使用 [openai/whisper 固定源码](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227/whisper/normalizers)，commit 为 `86098128c0b4f24f0e2aa2994de830614b474227`，沿用 [MIT LICENSE](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/LICENSE)。本轮私有资产目录保存 `__init__.py`、`basic.py`、`english.py`、`english.json` 的 SHA256 manifest 与 LICENSE；评分前逐项验证。额外 Python 依赖为 `regex==2026.9.29`、`more-itertools==11.1.0`。该目录不是安装完整 Whisper 模型。

官方 EnglishTextNormalizer 包含大小写、符号、部分填充词、缩写、数字写法及英美拼写等规则，不能称为“只修正数字”。归一化 WER 也不是语义准确率。应保留原始本机文本，人工核对真正的漏词、错词、否定、重复与专名错误；只有数值、单位和上下文不变时才可另标为数字格式差异。不得先按模型修复专名、补否定、改数字或去重再计分。

报告同时列出参考词数、编辑数、样本覆盖及失败数，clean/other 分开，真人/TTS 分开。完成推理却返回空文本按全删除计分；推理异常或漏结果另记失败，覆盖不完整时不据此排名。WER 可以超过 100%，不把 `1 - WER` 称为准确率。编辑对齐的 S/D/I 分类如需另报，须固定同一最小编辑距离的平局规则。

```bash
ASR_NORMALIZER_DIR="$HOME/.local/share/mimi-local-models/benchmark-assets/whisper-normalizer/86098128c0b4f24f0e2aa2994de830614b474227"
# 该目录需预先准备固定源码、manifest.json 和 LICENSE；不是模型权重目录。
"$ASR_PREP_ENV/bin/python" -m pip install regex==2026.9.29 more-itertools==11.1.0
"$ASR_PREP_ENV/bin/python" tools/local-asr-benchmark/score_asr.py \
  --normalizer-dir "$ASR_NORMALIZER_DIR" \
  --human-manifest "$ASR_SAMPLE_ROOT/manifest.jsonl" \
  --input "model-label=$HOME/.local/share/mimi-local-models/evidence/asr-run.jsonl"
```

`--human-manifest` 要求每个模型覆盖全部 40 条，核对原文与输入音频摘要，并拒绝缺失、失败或重复样本；主对照必须带此参数。`python3 -m unittest discover -s tools/local-asr-benchmark -p 'test_*.py'` 检查这几条边界，不需要模型或网络。

离线文件推理的耗时和 RTF 不等于流式首 draft、首 final、EOF 收尾时间或产品字幕延迟。RSS 应说明是主进程、进程树还是系统峰值；Metal/MLX 内存统计与 RSS 也不能直接视为相同口径。

## 独立 Parakeet 文件对照

复用 PR #156 已验证的 Parakeet 虚拟环境及带摘要清单的模型目录，显式指定路径。以下命令在模型推理窗口中运行；不要与其他模型并行。

```bash
"$PARAKEET_PYTHON" tools/local-asr-benchmark/parakeet_standalone.py \
  --model "$PARAKEET_MODEL" \
  --human-manifest "$ASR_SAMPLE_ROOT/manifest.jsonl" \
  --tts-directory "$HOME/.local/share/mimi-local-models/samples/english-24-v1" \
  --combined "$HOME/.local/share/mimi-local-models/samples/english-24-v1/english-24.wav" \
  --output "$HOME/.local/share/mimi-local-models/evidence/parakeet-standalone.jsonl"
```

`PARAKEET_PYTHON` 和 `PARAKEET_MODEL` 分别指向已有环境的 Python 与已校验模型；输出必须是尚不存在的本机文件。runner 直接调用本地模型，不走 WebSocket、Mimi、系统音频捕获或 MT。超过 30 秒的文件按连续不重叠片段处理；本轮 40 条真人样本均短于此界限。相关模型报告需要单独注明解码参数、首条预热差异与实测环境，不从单个样本推导产品实时可用性。
