## English

- Android 1.5.0: release APK with debugging disabled and a fixed release signing identity.
- Requires Android 10 or later and credentials for a supported translation service.
- Captures system playback only. Apps that prohibit playback capture and DRM-protected audio cannot be captured.
- Android is distributed separately from the desktop release. Desktop packages and the updater are unchanged.
- If a debug build is installed, uninstall it first. Android cannot update an app signed with a different certificate. Uninstalling removes the app's settings and saved credentials.
- Unit tests, Android lint, compiled manifest checks and signature verification are required before publication. Previous Android 15 emulator checks covered the interface and Alibaba Cloud playback translation; this release has not been accepted on physical Android hardware or verified live with every provider.

## 中文

- Android 1.5.0：关闭调试功能，使用固定发布签名的 release APK。
- 需要 Android 10 或更新版本，以及受支持翻译服务的凭证。
- 仅采集系统播放声音；无法采集禁止播放捕获的应用和受 DRM 保护的音频。
- Android 独立发布，桌面端安装包及更新通道保持不变。
- 如果已安装 debug 测试版，请先卸载。Android 不允许不同签名直接覆盖安装；卸载会删除应用设置和已保存的凭证。
- 发布前须通过单元测试、Android lint、编译后的清单检查和签名验证。此前的 Android 15 模拟器检查覆盖了界面及阿里云系统播放翻译；本次发行尚未完成 Android 实体设备验收，也未逐一验证所有服务的真实账户。
