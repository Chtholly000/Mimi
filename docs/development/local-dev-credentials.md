# Local development credentials

## 日常使用

只需配置一次：把自己的测试 Key 写入
`~/Library/Application Support/app.yuxino.mimi.dev/.env` 的
`ALIBABA_API_KEY=` 后面，不加引号，并将文件权限设为 `0600`。下面的
Setup 提供空模板的创建步骤；已有文件不需要重新填写。

之后每次运行 `./scripts/dev-app.sh`，或从 Finder / Dock 重新打开
`/Applications/mimi-dev.app`，应用都会自动读取该文件。设置中选择阿里云和
默认文字翻译服务即可，无需再保存 Key。修改 Key 后，正常退出并重新打开应用。

把 `.env` 移走或删除，再重新打开，就切回系统钥匙串。文件存在但格式或权限错误时，
应用明确报错，不会偷偷改用钥匙串。正式版和 `--ui-only` 模式都不会读取这个文件。
不要把真实 Key 放进仓库、截图或日志，也不要在 shell 中 `source` 这个文件。

The normal application stores provider credentials in the OS credential store.
For local macOS development, `./scripts/dev-app.sh` enables a separate, read-only
file mode so repeated self-signed rebuilds do not require API-key Keychain access.
This does not change the signing-private-key or system-audio permission prompts.

## Setup

1. Create the private file using the empty template. This preserves an existing
   file rather than overwriting its key:

   ```bash
   mimi_dev_config="$HOME/Library/Application Support/app.yuxino.mimi.dev"
   mkdir -p "$mimi_dev_config"
   chmod 700 "$mimi_dev_config"
   if [ ! -e "$mimi_dev_config/.env" ]; then
     (umask 077; cp docs/development/.env.example "$mimi_dev_config/.env")
   fi
   chmod 600 "$mimi_dev_config/.env"
   ```

2. Edit that private file in a local editor. Keep one assignment, with an
   unquoted Alibaba test key after `ALIBABA_API_KEY=`. Do not put the real key
   in shell commands, Git, screenshots, diagnostics, or the tracked template.
   Do not `source` this file. Comments and blank lines are allowed; shell
   substitutions, quoted values, duplicate assignments, and other variables
   are rejected. It is not a general dotenv parser.

3. Run `./scripts/dev-app.sh` and select an Alibaba Cloud profile with its
   default text-translation service. The key is also available to the native
   Original mode. Other providers and independent DeepL/custom MT credentials
   are not supplied by this file and never fall back to Keychain while it exists.

The file must be a regular, non-symlink file owned by the current user, with
exactly `0600` permissions and at most 16 KiB. A key is capped at 4096 bytes.
An empty template selects file mode with a missing key.

## Editing and returning to Keychain

Keys are read once at app startup. After changing the file, quit Mimi normally
and reopen `/Applications/mimi-dev.app`; reopening from Finder or the Dock also
reads it, because the path comes from the app config directory rather than the
launching shell. No polling or automatic Keychain retry occurs.

File mode is read-only. Settings cannot update, remove, or reveal the file key.
Preferences and profile names remain editable; deleting a profile removes its
metadata without changing the shared file. To remove or replace the key, edit
the private file and reopen the app. To return to OS credential storage, move
the file outside that fixed path or delete it, then reopen the app. Previously
stored Keychain entries are preserved and become available again.

If the file exists but cannot be read or fails validation, Mimi reports a local
development file error. It does **not** silently use Keychain. Check its format,
ownership and permissions, then reopen the app. A genuinely absent file keeps
normal OS credential storage.

## Scope and verification

This feature is disabled by default in Cargo. It additionally requires macOS
and the exact `app.yuxino.mimi.dev` bundle identifier before any secret-file
access. Release identifiers ignore it even if accidentally compiled with the
feature. UI-only mode never inspects the file, Keychain, provider networks, or
system audio. The file is not copied into `.app`, preferences, profile JSON, or
frontend state, and process environment variables are not credential inputs.

Run focused synthetic tests without using your key:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib local_dev_credentials
cargo test --manifest-path src-tauri/Cargo.toml --features local-dev-credentials --lib local_dev_credentials
```

Never commit a `.env` file. Only the empty `.env.example` template is tracked.
This is a local development exception, not a production credential-storage option.
