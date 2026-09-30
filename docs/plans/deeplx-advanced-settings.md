# DeepLX as an advanced text translation choice

Related: #70, #73; integration acceptance: draft #88. Baseline: `42f758378e0d2b47bc65922ac105f0907f5a62f1`.

## Confirmed experience

普通配置仍是选服务、填 Key、保存并使用。默认「文字翻译：跟随当前服务」，无需增加配置步骤。DeepLX 从新增语音服务列表移除，放入阿里配置的「高级设置」。选择后明确显示「阿里负责识别，DeepLX 负责翻译」。仅支持已有的 Audio 3.0 ASR + DeepLX 链路；其他服务不提供 DeepLX 选择，也不暗示可任意拆换。

已有 Key 在原生端复用，不回填到页面，也不要求用户再输入。新地址、token 始终是只写字段；留空可保留当前 DeepLX 目的地，填新地址时空 token 表示无认证。未保存的错误输入保留，端点验证仍在安全存储 I/O 前就近显示、聚焦并自动滚动。

## Storage and runtime boundary

- Keep every historical profile ID, provider enum and credential account. `textTranslation` is optional non-secret profile metadata. Absent means follow the service for ordinary profiles, and DeepLX for historical `deepLX` profiles. Loading/renaming does not rewrite or migrate credentials.
- Ordinary Alibaba credentials remain raw keys in their original account. When DeepLX is configured, only its endpoint/token are written to an additional profile/provider-scoped OS secure-store item. No second ASR key is stored. The old `deepLX` structured secret remains readable in its original account.
- Switching to follow the service retains the secure DeepLX destination for later use. The runtime resolves the effective existing adapter from the profile choice; following Alibaba uses Alibaba's normal recognition/translation behavior, choosing DeepLX uses the existing Audio 3.0 + DeepLX bounded pipeline. Original-subtitle and mode/language capabilities are normalized on save/selection.
- The write-only credential command gains an `alibabaTranslation` request. Blank key means reuse this profile's saved key natively; an unavailable store or missing key fails closed. Its endpoint/token never enter snapshot/catalog/preferences/diagnostic payloads. Public snapshots carry only the text translator selection.
- Save failure restores prior secure items in place and does not commit the metadata. Credential/profile deletion removes the destination and key, with rollback on failure. No ACL widening, real provider calls, capture, or paid traffic is required.
- Older binaries can still read unchanged ordinary Alibaba key items and legacy DeepLX records. They ignore the new optional selection, so advanced selection behavior requires this build; no secret JSON is placed in a historical raw-key account.

## Verification and handoff

Frontend regressions cover one-key normal setup, advanced selection without a second key, retained/focused invalid URL errors, saved-but-not-activated draft retention, historical DeepLX selection, mutation locks and deletion draft clearing. Pure native tests use only an in-memory synthetic secret store: legacy/raw round trips, supported combinations, key/destination isolation, route switching, restart, metadata/secure-store failures and deletion rollback.

No native build or GUI runs locally while the integration owner holds the serial build/window boundary. The integration owner must run canonical native checks and exact-head remote CI, then capture matching before/after on the integrated app. Existing #73 invalid-endpoint screenshots establish the earlier correction only; they do not prove acceptance of this new advanced layout. New screenshots must be embedded directly in #88, with platform/build hash/steps, before acceptance. Real private-host authentication and translation remain untested. No merge, release, or automatic issue closure is authorized.
