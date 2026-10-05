# Experimental TranslateGemma 4B Q4_K_M with Mimi

This optional local **text translator** is ready for controlled evaluation, but
our [same-text comparison](../research/2026-10-05-local-translategemma.md) does **not** support
replacing Index for better gaming accuracy. It does not recognize speech.

Google translation model under Gemma Terms of Use; this GGUF is a **community
conversion by bullerwins**, not an official Google GGUF. Downloading a conversion
does not change the upstream model terms. Review the terms before use. Only text
translation is exposed; no image/mmproj model is downloaded.
[Model artifact](https://huggingface.co/bullerwins/translategemma-4b-it-GGUF/tree/7c938465a870d8624bcfa98a8e4a3510053c19a8) ·
[License](https://ai.google.dev/gemma/terms).
The manifest fixes the full revision, size and SHA256; no weights are bundled in Mimi.

## Setup and start

Read the [runner requirements and limits](../../scripts/local-mt/README.md).
Use Python 3.10+ (the macOS system Python 3.9 is too old for the pinned HTTP library).
Stop Index or any other large model before starting inference on a 16 GB Mac.

```sh
python3.12 scripts/local-mt/control.py setup --manifest scripts/local-mt/models/translategemma.json
python3.12 scripts/local-mt/control.py start --manifest scripts/local-mt/models/translategemma.json \
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
| Endpoint | `http://127.0.0.1:18085/v1` |
| Model | `mimi-translategemma-4b` |
| API key | Empty |
| Text proxy | Direct |
| Source | Explicit English for this tested route; no Auto |
| Target | Simplified Chinese |

Keep the recognizer separately configured. Alibaba ASR + this translator still
uses cloud speech recognition. Apple Speech or a separately verified local ASR
can form a local route only when the selected recognizer also runs locally.
The runner never changes the active profile or user credentials automatically.

```sh
python3.12 scripts/local-mt/control.py status --manifest scripts/local-mt/models/translategemma.json
python3.12 scripts/local-mt/control.py stop --manifest scripts/local-mt/models/translategemma.json
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
  --url http://127.0.0.1:18085/v1/chat/completions \
  --model mimi-translategemma-4b --manifest scripts/local-mt/models/translategemma.json \
  --mode gateway --output /tmp/translategemma-comparison.json
```

This explicitly saves only the checked-in synthetic text results. Normal runtime
has no transcript logs or saved translation history. Native app acceptance and
other languages remain separate from this service-level batch.
