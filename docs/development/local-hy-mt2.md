# Experimental Hy-MT2 1.8B Q8_0 with Mimi

This optional local **text translator** is ready for controlled evaluation, but
our [same-text comparison](../research/2026-10-05-local-hy-mt2.md) does **not** support
replacing Index for better gaming accuracy. It does not recognize speech.

Official Tencent GGUF, under Apache 2.0. This is the standard Q8_0 artifact,
not the separate STQ/1.25-bit kernel variant.
[Model artifact](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/tree/a0c709d9fac510f2c807aa3af52872340dc37a4a) ·
[License](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/blob/a0c709d9fac510f2c807aa3af52872340dc37a4a/LICENSE.txt).
The manifest fixes the full revision, size and SHA256; no weights are bundled in Mimi.

## Setup and start

Read the [runner requirements and limits](../../scripts/local-mt/README.md).
Use Python 3.10+ (the macOS system Python 3.9 is too old for the pinned HTTP library).
Stop Index or any other large model before starting inference on a 16 GB Mac.

```sh
python3.12 scripts/local-mt/control.py setup --manifest scripts/local-mt/models/hy-mt2.json
python3.12 scripts/local-mt/control.py start --manifest scripts/local-mt/models/hy-mt2.json \
  --runtime "$HOME/.local/share/index-translate/runtime/llama-b11146/llama-server"
```

The runtime path above reuses an existing Index installation. Otherwise supply
an existing [llama.cpp b11146](https://github.com/ggml-org/llama.cpp/releases/tag/b11146)
`llama-server` path. Setup installs weights and a venv under
`~/.local/share/mimi-local-models/`; it does not change Mimi or start at login.

In an editable Mimi profile that supports independent text translation:

| Setting | Value |
| --- | --- |
| Text translation | OpenAI-compatible |
| Endpoint | `http://127.0.0.1:18083/v1` |
| Model | `mimi-hy-mt2-1.8b` |
| API key | Empty |
| Text proxy | Direct |
| Source | Explicit English for this tested route; no Auto |
| Target | Simplified Chinese |

Keep the recognizer separately configured. Alibaba ASR + this translator still
uses cloud speech recognition. Apple Speech or a separately verified local ASR
can form a local route only when the selected recognizer also runs locally.
The runner never changes the active profile or user credentials automatically.

```sh
python3.12 scripts/local-mt/control.py status --manifest scripts/local-mt/models/hy-mt2.json
python3.12 scripts/local-mt/control.py stop --manifest scripts/local-mt/models/hy-mt2.json
```

If a port is busy, start fails instead of attaching to an unrelated service.
`stop` works while loading and verifies its controller before sending a signal.
There is no remote/cloud fallback. One translation at a time, a 2 KiB input limit
and seven-second deadline deliberately bound this experiment; two simultaneous
source requests may receive a busy retry. The application keeps its existing
translation and finalization policy.

## Repeat the public text batch

```sh
~/.local/share/mimi-local-models/venv/bin/python scripts/local-mt/benchmark.py \
  --url http://127.0.0.1:18083/v1/chat/completions \
  --model mimi-hy-mt2-1.8b --manifest scripts/local-mt/models/hy-mt2.json \
  --mode gateway --output /tmp/hy-mt2-comparison.json
```

This explicitly saves only the checked-in synthetic text results. Normal runtime
has no transcript logs or saved translation history. Native app acceptance and
other languages remain separate from this service-level batch.
