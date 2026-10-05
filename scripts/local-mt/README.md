# Experimental local text translation runner

This opt-in operator tool connects a dedicated local translation model to Mimi's
existing independent **OpenAI-compatible** text translator. It does not add an
application provider, change shared desktop/Android contracts, recognize audio,
edit profiles, obtain credentials, or start capture. A cloud recognizer followed
by this tool is still a cloud-ASR/local-MT pipeline. Both components must be local
before describing the complete route as local.

Use a candidate's guide for its pinned artifact, license, settings and measured
limitations. No weights, Python environment or credentials belong in this tree.
All runtime state defaults to `~/.local/share/mimi-local-models/`.

## Requirements and commands

- Python 3.10 or newer, `curl`, `lsof`, a POSIX host, and an existing
  `llama-server` runtime. macOS arm64 with llama.cpp **b11146 / 7fe450e19** was
  tested. Linux fake-service tests are separate from real-model acceptance;
  Windows lifecycle support is not implemented.
- Obtain llama.cpp from its [official release](https://github.com/ggml-org/llama.cpp/releases/tag/b11146).
  Keep the runtime's accompanying libraries together. If Index is already
  installed, reuse its runtime rather than download/build another copy.
- `setup` downloads a revision-pinned GGUF into a resumable `.part`, validates
  size and SHA256 before atomic activation, and installs pinned HTTP dependencies
  into a private venv. Interrupted downloads remain resumable. A checksum failure
  never activates the file; remove only that candidate's invalid `.part` before
  retrying. Setup does not load a model.
- `start --runtime /absolute/path/to/llama-server` validates the model again,
  launches one owned backend, verifies its listener PID and model alias, and then
  opens the adapter. `status`, `stop`, and `preset` need no runtime argument.
  `stop` also works during model loading. There is no login autostart.

Example (replace `MODEL.json` with the candidate's manifest):

```sh
python3.12 scripts/local-mt/control.py setup --manifest scripts/local-mt/models/MODEL.json
python3.12 scripts/local-mt/control.py start --manifest scripts/local-mt/models/MODEL.json \
  --runtime /absolute/path/to/llama-server
python3.12 scripts/local-mt/control.py preset --manifest scripts/local-mt/models/MODEL.json
python3.12 scripts/local-mt/control.py status --manifest scripts/local-mt/models/MODEL.json
python3.12 scripts/local-mt/control.py stop --manifest scripts/local-mt/models/MODEL.json
```

Stop other large local models first on a 16 GB machine. A file lock prevents two
models controlled by this runner from loading together; it cannot reserve memory
against Index, a different application, or unrelated build jobs. A failed start
leaves a content-free `lifecycle.log` under the candidate's private state directory.
Moving/removing the checkout while it runs is unsupported: stop it first.

## Request and lifecycle boundaries

The public endpoint binds only to **127.0.0.1**. Use that literal address in Mimi;
`localhost` is deliberately not accepted as a Host alias. Native HTTP clients
need no external API key. Browser Origin headers and unexpected Host values are
rejected; the tool is intended for trusted applications on the same machine.
Its private backend also binds to loopback and requires a random owner-only token.
No tokens are passed through command-line values, environment variables or logs.

Only `/health` and `/v1/chat/completions` exist. Health does not run inference.
The adapter accepts the exact existing Mimi system+user translation request and
maps the selected languages to the candidate's fixed template. Unknown languages,
automatic source language, a changed system instruction, an incorrect model,
streaming and empty/oversized text fail closed. It never guesses a language from
the source text or forwards a user-supplied template. The candidate manifest lists
accepted source codes; targets are Simplified Chinese, English and Japanese.

One request runs at a time; a second request returns HTTP 429 instead of entering
an unbounded queue. This can matter with both audio sources enabled. Request JSON
is capped at 16 KiB, source text at 2 KiB UTF-8, output at 256 tokens and the
upstream response at 64 KiB. Context is 2,048 tokens. The adapter's entire request
deadline is seven seconds, inside Mimi's existing eight-second HTTP deadline.
Truncated, empty, refused and tool-call replies are rejected. Client disconnect
and timeout cancel the upstream HTTP request. The server emits no transcript or
translation logs, keeps no history, and has no cloud fallback.

Stop validates the controller's UID, birth time, exact script arguments and
process-group identity before signalling it; it never kills a stale PID by name.
The controller reaps only its own subprocess, with a three-second termination
deadline. Starting on occupied ports fails. There is no HTTP stop endpoint and
no control secret is sent to a service that merely claims to be healthy.

## Repeatable checks

```sh
~/.local/share/mimi-local-models/venv/bin/python -m pip install -r scripts/local-mt/requirements-test.txt
~/.local/share/mimi-local-models/venv/bin/python -m unittest discover \
  -s scripts/local-mt -p 'test_*.py' -v
```

Tests use fake HTTP/model processes and no weights. They cover exact languages,
immutable sampling bounds, headers, body/response limits, busy rejection,
disconnect and timeout cancellation, invalid model files, private tokens,
occupied ports, repeated starts, loading cancellation and child reaping.
The dedicated CI workflow runs these tests without downloading a model.

`benchmark.py` is an explicit public-synthetic-text harness, not application
logging. It caps each run at 32 cases, runs serially, disables environment proxies,
and writes the requested JSON evidence file. The checked-in 28 cases are original
synthetic sentences; their first four match the earlier Apple Speech probe. The
meaning notes were fixed before candidate inference. Normal service operation
does not save this evidence. Never substitute private transcripts and commit them.
