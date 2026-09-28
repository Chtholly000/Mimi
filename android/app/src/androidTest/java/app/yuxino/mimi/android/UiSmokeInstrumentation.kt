package app.yuxino.mimi.android

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.MotionEvent
import android.view.View
import android.view.inspector.WindowInspector
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.yuxino.mimi.android.capture.MimiService
import app.yuxino.mimi.android.provider.ServiceProvider
import app.yuxino.mimi.android.provider.SubtitleBus
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.materialswitch.MaterialSwitch
import java.io.File

/** Real emulator interactions. No credential is saved and no capture/provider session starts. */
class UiSmokeInstrumentation : Instrumentation() {
    private var theme = "light"
    private var demo = false
    private var overlayPreview = false
    private var screenshots = 0
    private var restoreTarget: String? = null
    private var restoreFont: Int? = null
    private var restoreColor: Int? = null
    private var restoreSource: String? = null
    private var restoreBackground: Int? = null

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        theme = arguments?.getString("theme") ?: "light"
        demo = arguments?.getString("demo") == "true"
        overlayPreview = arguments?.getString("overlay_preview") == "true"
        restoreTarget = arguments?.getString("restore_target")?.takeIf { it in listOf("zh", "en", "ja") }
        restoreFont = arguments?.getString("restore_font")?.toIntOrNull()?.takeIf { it in 12..24 }
        restoreColor = arguments?.getString("restore_color")?.toIntOrNull()?.takeIf { it in 0..4 }
        restoreSource = arguments?.getString("restore_source")?.takeIf { it in listOf("auto", "zh", "en", "ja", "ko") }
        restoreBackground = arguments?.getString("restore_background")?.toIntOrNull()?.takeIf { it in 0..90 }
        start()
    }

    override fun onStart() {
        super.onStart()
        val prefs = AppearanceSnapshot()
        pause("Initial preferences: source=${SettingsStore.sourceLang(targetContext)}, target=${SettingsStore.targetLang(targetContext)}, font=${SettingsStore.fontSize(targetContext)}, color=${SettingsStore.translationColorIndex(targetContext)}, background=${SettingsStore.overlayBgAlpha(targetContext)}", 0)
        var failure: Throwable? = null
        try {
            check(!MimiService.isRunning) { "Stop the active session before running UI checks." }
            onUi {
                AppCompatDelegate.setDefaultNightMode(if (theme == "dark")
                    AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO)
            }
            when {
                overlayPreview -> previewOverlay()
                demo -> demonstrate()
                else -> smoke()
            }
        } catch (error: Throwable) {
            failure = error
        } finally {
            onUi {
                prefs.restore()
                AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
            }
            check(SettingsStore.flushPendingWritesForTests(targetContext)) { "Preference restore did not reach disk" }
        }
        finish(if (failure == null) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply {
            putString("stream", if (failure == null)
                "UI ${if (overlayPreview) "overlay preview" else if (demo) "demo" else "smoke"} passed ($theme): $screenshots screenshots; non-secret preferences restored; no credentials saved or provider session started.\n"
            else "UI check failed: ${failure.javaClass.simpleName}: ${failure.message}\n")
        })
    }

    private fun smoke() {
        val home = launchHome()
        val originalTarget = SettingsStore.targetLang(targetContext)
        val testTarget = if (originalTarget == "ja") "en" else "ja"
        click(home, R.id.target_language_action)
        selectLanguage(testTarget)
        check(SettingsStore.targetLang(targetContext) == testTarget)
        check(home.findViewById<TextView>(R.id.target_summary).text.isNotEmpty())
        onUi {
            val undo = home.findViewById<View>(com.google.android.material.R.id.snackbar_action)
            check(undo != null && undo.performClick()) { "Language Undo unavailable" }
        }
        check(SettingsStore.targetLang(targetContext) == originalTarget) { "Undo did not restore language" }
        capture("home-$theme")

        val initialFont = SettingsStore.fontSize(targetContext)
        val initialColor = SettingsStore.translationColorIndex(targetContext)
        val initialHistory = SettingsStore.historyLines(targetContext)
        val settings = openSettings(home, appearance = true)
        check(settings.findViewById<View>(R.id.appearance_panel).isShown)
        check(settings.findViewById<View>(R.id.service_panel).visibility == View.GONE)
        check(SettingsStore.fontSize(targetContext) == initialFont)
        check(SettingsStore.translationColorIndex(targetContext) == initialColor)
        check(SettingsStore.historyLines(targetContext) == initialHistory)
        val initialImmersive = SettingsStore.immersiveSubtitles(targetContext)
        val immersive = settings.findViewById<MaterialSwitch>(R.id.immersive_subtitles)
        check(immersive.isChecked == initialImmersive)
        click(settings, R.id.immersive_subtitles)
        check(SettingsStore.immersiveSubtitles(targetContext) != initialImmersive)
        check(settings.findViewById<SeekBar>(R.id.overlay_bg_alpha).isEnabled == initialImmersive)
        capture("settings-immersive-$theme")
        click(settings, R.id.immersive_subtitles)
        check(SettingsStore.immersiveSubtitles(targetContext) == initialImmersive)
        val seek = settings.findViewById<SeekBar>(R.id.font_size)
        drag(seek, if (initialFont < 20) 20 else 16)
        check(SettingsStore.fontSize(targetContext) == seek.progress) { "Font was not automatically saved" }
        val changedFont = seek.progress
        onUi { settings.findViewById<Spinner>(R.id.translation_color).setSelection(0) }
        waitForIdleSync()
        check(SettingsStore.translationColorIndex(targetContext) == 1) { "Color was not automatically saved" }
        check(SettingsStore.historyLines(targetContext) == initialHistory) { "Appearance enabled history" }
        capture("settings-appearance-$theme")
        click(settings, R.id.back)
        val reopened = openSettings(home, appearance = true)
        check(reopened.findViewById<SeekBar>(R.id.font_size).progress == changedFont) { "Back discarded appearance" }
        click(reopened, R.id.appearance_more_toggle)
        check(reopened.findViewById<View>(R.id.appearance_more_panel).visibility == View.VISIBLE)
        onUi { reopened.findViewById<ScrollView>(R.id.settings_scroll).scrollTo(0, 10000) }
        waitForIdleSync()
        val history = reopened.findViewById<SeekBar>(R.id.history_lines)
        drag(history, 2)
        check(SettingsStore.historyLines(targetContext) == 2)
        onUi {
            SubtitleBus.onSourceFinal("Sample source")
            SubtitleBus.onTranslationFinal("Sample translation")
        }
        check(SubtitleBus.historySnapshot().isNotEmpty())
        drag(history, 0)
        check(SubtitleBus.historySnapshot().isEmpty()) { "Disabling history did not clear it immediately" }
        click(reopened, R.id.tab_service)
        capture("settings-services-$theme")
        val activeProvider = SettingsStore.provider(targetContext)
        for (provider in ServiceProvider.entries) {
            val configuredBefore = SettingsStore.isConfigured(targetContext, provider)
            val editor = openService(reopened, provider.id)
            val root = editor.findViewById<View>(android.R.id.content)
            for (field in provider.fields) {
                val input = root.findViewWithTag<TextInputEditText>("credential-${field.id}")
                check(input != null) { "Provider field missing: ${provider.id}/${field.id}" }
                if (field.secret) check(input.text.toString().isEmpty()) { "Stored credential was exposed in UI" }
            }
            if (provider.id in listOf("azure", "tencent", "dashscope")) capture("service-${provider.id}-$theme")
            if (!configuredBefore) {
                click(editor, R.id.save)
                check(SettingsStore.provider(targetContext) == activeProvider) { "Invalid form changed active provider" }
            }
            val secret = provider.fields.first { it.secret }
            onUi { root.findViewWithTag<TextInputEditText>("credential-${secret.id}").setText("unsaved-test-value") }
            click(editor, R.id.back)
            check(SettingsStore.isConfigured(targetContext, provider) == configuredBefore) { "Unsaved form changed configuration" }
        }
        val editor = openService(reopened, "openai")
        val key = editor.findViewById<View>(android.R.id.content).findViewWithTag<TextInputEditText>("credential-apiKey")
        onUi {
            check(key.text.toString().isEmpty()) { "Unsaved credential survived reopening" }
            key.requestFocus()
            WindowCompat.getInsetsController(editor.window, key).show(WindowInsetsCompat.Type.ime())
        }
        repeat(30) {
            if (ViewCompat.getRootWindowInsets(key)?.isVisible(WindowInsetsCompat.Type.ime()) != true) Thread.sleep(100)
        }
        check(ViewCompat.getRootWindowInsets(key)?.isVisible(WindowInsetsCompat.Type.ime()) == true) { "Keyboard did not open" }
        capture("settings-keyboard-$theme")
        onUi { editor.finish(); reopened.finish(); home.finish() }
        waitForIdleSync()
    }

    private fun previewOverlay() {
        check(Settings.canDrawOverlays(targetContext)) { "Grant the debug app overlay permission before preview." }
        check(!MimiService.isRunning) { "Stop the active session before preview." }
        // Use the new neutral defaults for both screenshots; AppearanceSnapshot
        // restores the emulator's existing preferences when this check finishes.
        SettingsStore.setTranslationColorIndex(targetContext, 1)
        SettingsStore.setOverlayBgAlpha(targetContext, 65)
        SettingsStore.setOverlayOpacity(targetContext, 100)
        SettingsStore.setImmersiveSubtitles(targetContext, false)
        launchHome()
        try {
            check(targetContext.startService(Intent(targetContext, MimiService::class.java)
                .setAction(MimiService.ACTION_UI_PREVIEW)) != null)
            var root: View? = null
            for (attempt in 0 until 30) {
                waitForIdleSync()
                root = WindowInspector.getGlobalWindowViews().firstOrNull { it.tag == "mimi-overlay" }
                if (root != null) break
                SystemClock.sleep(100)
            }
            val overlay = root ?: error("Actual floating overlay did not appear; windows=" +
                WindowInspector.getGlobalWindowViews().map { it.tag })
            val compact = overlay.findViewWithTag<View>("compact-subtitle")
            val expanded = overlay.findViewWithTag<View>("expanded-subtitles")
            check(compact != null && expanded != null)
            targetContext.startActivity(Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            waitForIdleSync()
            check(compact.isShown && !expanded.isShown)
            capture("overlay-before-compact-$theme")
            onUi { check(compact.performClick()) }
            check(expanded.isShown && !compact.isShown) { "Expanded floating overlay did not open" }
            capture("overlay-after-expanded-default-$theme")
            val savedHistory = SettingsStore.historyLines(targetContext)
            targetContext.startService(Intent(targetContext, MimiService::class.java)
                .setAction(MimiService.ACTION_UI_PREVIEW_HISTORY))
            waitForIdleSync()
            check(SettingsStore.historyLines(targetContext) == savedHistory)
            capture("overlay-after-expanded-history-$theme")
            onUi { check(expanded.findViewWithTag<View>("collapse-overlay").performClick()) }
            check(compact.isShown && !expanded.isShown) { "Floating overlay did not collapse" }
            onUi { check(compact.performClick()) }
            onUi { check(expanded.findViewWithTag<View>("enter-immersive").performClick()) }
            check(SettingsStore.immersiveSubtitles(targetContext))
            val exit = WindowInspector.getGlobalWindowViews()
                .firstOrNull { it.tag == "exit-immersive" }
            check(exit?.isShown == true) { "Immersive mode has no in-overlay exit" }
            capture("overlay-after-immersive-$theme")
            onUi { check(exit.performClick()) { "Exit control click failed" } }
            waitForIdleSync()
            check(!SettingsStore.immersiveSubtitles(targetContext)) { "Exit did not clear immersive preference" }
            val restored = WindowInspector.getGlobalWindowViews()
                .firstOrNull { it.tag == "mimi-overlay" }
            check(restored?.findViewWithTag<View>("compact-subtitle")?.isShown == true) {
                "Exit did not restore the compact overlay"
            }
            check(WindowInspector.getGlobalWindowViews().none { it.tag == "exit-immersive" }) {
                "Exit control remained after leaving immersive mode"
            }
            SettingsStore.setImmersiveSubtitles(targetContext, true)
            targetContext.startService(Intent(targetContext, MimiService::class.java)
                .setAction(MimiService.ACTION_APPLY_APPEARANCE))
            val settingsExit = waitForOverlayTag("exit-immersive")
            check(settingsExit?.isShown == true) { "Settings change did not apply to the active overlay" }
            onUi { SubtitleBus.hideLive() }
            check(settingsExit.isShown) { "Immersive exit disappeared when speech paused" }
            SettingsStore.setImmersiveSubtitles(targetContext, false)
            targetContext.startService(Intent(targetContext, MimiService::class.java)
                .setAction(MimiService.ACTION_APPLY_APPEARANCE))
            for (attempt in 0 until 30) {
                waitForIdleSync()
                if (WindowInspector.getGlobalWindowViews().none { it.tag == "exit-immersive" }) break
                SystemClock.sleep(100)
            }
            check(WindowInspector.getGlobalWindowViews().none { it.tag == "exit-immersive" })
        } finally {
            targetContext.startService(MimiService.stopIntent(targetContext))
            waitForIdleSync()
        }
    }

    private fun waitForOverlayTag(tag: String): View? {
        repeat(30) {
            waitForIdleSync()
            WindowInspector.getGlobalWindowViews().firstOrNull { it.tag == tag }?.let { return it }
            SystemClock.sleep(100)
        }
        return null
    }

    private fun demonstrate() {
        val home = launchHome()
        pause("READY_FOR_RECORDING", 12000)
        pause("首页：语言直接切换，预览直达外观", 3000)
        click(home, R.id.target_language_action)
        pause("选择字幕语言", 1800)
        selectLanguage("ja")
        pause("选完即保存，首页示例同步变化", 3000)
        click(home, R.id.source_language_action)
        pause("原声语言也在首页", 1600)
        selectLanguage("en")
        pause("无需进入设置或点保存", 2600)
        val settings = openSettings(home, appearance = true)
        pause("点字幕预览，直达外观", 2500)
        drag(settings.findViewById(R.id.font_size), 21)
        pause("调整字号，自动保存", 2200)
        drag(settings.findViewById(R.id.overlay_bg_alpha), 65)
        pause("背景与字幕实时预览", 2200)
        onUi { settings.findViewById<Spinner>(R.id.translation_color).setSelection(0) }
        pause("白色字幕", 1600)
        click(settings, R.id.appearance_more_toggle)
        onUi { settings.findViewById<ScrollView>(R.id.settings_scroll).smoothScrollTo(0, 650) }
        pause("低频选项收起，历史仍默认关闭", 2500)
        click(settings, R.id.tab_service)
        pause("八家服务，已配置的可直接切换", 2800)
        val azure = openService(settings, "azure")
        pause("Azure：只显示资源地址、部署名和 Key", 3000)
        click(azure, R.id.back)
        val tencent = openService(settings, "tencent")
        pause("腾讯云：独立的 AppID 与密钥表单", 2800)
        click(tencent, R.id.back)
        val aliyun = openService(settings, "dashscope")
        pause("已保存的密钥不会回填到输入框", 2600)
        click(aliyun, R.id.advanced_toggle)
        pause("连接地址、模型和术语按需展开", 3000)
        click(aliyun, R.id.back)
        click(settings, R.id.back)
        pause("返回首页，外观已经记住", 3000)
        capture("demo-home-$theme")
        pause("演示结束：未启动音频捕获或真实翻译", 15000)
    }

    private fun launchHome(): MainActivity {
        val activity = startActivitySync(Intent(targetContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        waitForIdleSync()
        return activity
    }

    private fun openSettings(home: MainActivity, appearance: Boolean): SettingsActivity {
        val monitor = addMonitor(SettingsActivity::class.java.name, null, false)
        click(home, if (appearance) R.id.subtitle_preview else R.id.go_settings)
        val settings = waitForMonitorWithTimeout(monitor, 5000) as? SettingsActivity ?: error("Settings did not open")
        removeMonitor(monitor)
        waitForIdleSync()
        return settings
    }

    private fun openService(settings: SettingsActivity, provider: String): ServiceSettingsActivity {
        val monitor = addMonitor(ServiceSettingsActivity::class.java.name, null, false)
        onUi {
            val row = settings.findViewById<View>(R.id.service_panel).findViewWithTag<View>("configure-$provider")
            check(row != null && row.performClick()) { "Provider editor did not open" }
        }
        val editor = waitForMonitorWithTimeout(monitor, 5000) as? ServiceSettingsActivity ?: error("Service editor missing")
        removeMonitor(monitor); waitForIdleSync(); return editor
    }

    private fun click(activity: Activity, id: Int) {
        onUi {
            val view = activity.findViewById<View>(id)
            check(view.isEnabled && view.isClickable) { "Control not clickable: ${activity.resources.getResourceEntryName(id)}" }
            view.performClick()
        }
        waitForIdleSync()
        Thread.sleep(220)
    }

    private fun selectLanguage(code: String) {
        onUi {
            val row = WindowInspector.getGlobalWindowViews().firstNotNullOfOrNull {
                it.findViewWithTag<View>("language-$code")
            } ?: error("Language sheet unavailable")
            check(row.performClick())
        }
        waitForIdleSync()
        Thread.sleep(350)
    }

    /** Actual touch events exercise fromUser persistence, including dragging inside a scroll view. */
    private fun drag(seek: SeekBar, value: Int) {
        val location = IntArray(2)
        var start = 0f
        var end = 0f
        var y = 0f
        onUi {
            seek.getLocationOnScreen(location)
            val left = location[0] + seek.paddingLeft
            val width = seek.width - seek.paddingLeft - seek.paddingRight
            start = left + width * (seek.progress - seek.min).toFloat() / (seek.max - seek.min)
            end = left + width * (value - seek.min).toFloat() / (seek.max - seek.min)
            y = location[1] + seek.height / 2f
        }
        val down = SystemClock.uptimeMillis()
        fun event(action: Int, x: Float) {
            val e = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
            sendPointerSync(e)
            e.recycle()
        }
        event(MotionEvent.ACTION_DOWN, start)
        for (step in 1..12) { Thread.sleep(45); event(MotionEvent.ACTION_MOVE, start + (end - start) * step / 12) }
        event(MotionEvent.ACTION_UP, end)
        waitForIdleSync()
    }

    private fun capture(name: String) {
        waitForIdleSync()
        Thread.sleep(400)
        val bitmap = checkNotNull(uiAutomation.takeScreenshot()) { "Screenshot unavailable" }
        val dir = checkNotNull(targetContext.getExternalFilesDir("ui-preview"))
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        screenshots++
        pause("Captured $name", 0)
    }

    private fun onUi(action: () -> Unit) {
        var failure: Throwable? = null
        runOnMainSync {
            try { action() } catch (error: Throwable) { failure = error }
        }
        failure?.let { throw it }
    }

    private fun pause(message: String, ms: Long) {
        sendStatus(0, Bundle().apply { putString("stream", "$message\n") })
        Thread.sleep(ms)
    }

    private inner class AppearanceSnapshot {
        private val source = restoreSource ?: SettingsStore.sourceLang(targetContext)
        private val target = restoreTarget ?: SettingsStore.targetLang(targetContext)
        private val font = restoreFont ?: SettingsStore.fontSize(targetContext)
        private val color = restoreColor ?: SettingsStore.translationColorIndex(targetContext)
        private val opacity = SettingsStore.overlayOpacity(targetContext)
        private val background = restoreBackground ?: SettingsStore.overlayBgAlpha(targetContext)
        private val history = SettingsStore.historyLines(targetContext)
        private val immersive = SettingsStore.immersiveSubtitles(targetContext)
        fun restore() {
            SettingsStore.setSourceLang(targetContext, source)
            SettingsStore.setTargetLang(targetContext, target)
            SettingsStore.setFontSize(targetContext, font)
            SettingsStore.setTranslationColorIndex(targetContext, color)
            SettingsStore.setOverlayOpacity(targetContext, opacity)
            SettingsStore.setOverlayBgAlpha(targetContext, background)
            SettingsStore.setHistoryLines(targetContext, history)
            SettingsStore.setImmersiveSubtitles(targetContext, immersive)
            SubtitleBus.clear()
        }
    }
}
