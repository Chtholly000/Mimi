package app.yuxino.mimi.android

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.inspector.WindowInspector
import android.widget.RadioButton
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.yuxino.mimi.android.capture.MimiService
import app.yuxino.mimi.android.provider.SubtitleBus
import com.google.android.material.textfield.TextInputEditText
import java.io.File

/** Real emulator interactions. No credential is saved and no capture/provider session starts. */
class UiSmokeInstrumentation : Instrumentation() {
    private var theme = "light"
    private var demo = false
    private var screenshots = 0
    private var restoreTarget: String? = null
    private var restoreFont: Int? = null
    private var restoreColor: Int? = null

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        theme = arguments?.getString("theme") ?: "light"
        demo = arguments?.getString("demo") == "true"
        restoreTarget = arguments?.getString("restore_target")?.takeIf { it in listOf("zh", "en", "ja") }
        restoreFont = arguments?.getString("restore_font")?.toIntOrNull()?.takeIf { it in 12..24 }
        restoreColor = arguments?.getString("restore_color")?.toIntOrNull()?.takeIf { it in 0..4 }
        start()
    }

    override fun onStart() {
        super.onStart()
        val prefs = AppearanceSnapshot()
        var failure: Throwable? = null
        try {
            check(!MimiService.isRunning) { "Stop the active session before running UI checks." }
            onUi {
                AppCompatDelegate.setDefaultNightMode(if (theme == "dark")
                    AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO)
            }
            if (demo) demonstrate() else smoke()
        } catch (error: Throwable) {
            failure = error
        } finally {
            onUi {
                prefs.restore()
                AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
            }
        }
        finish(if (failure == null) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle().apply {
            putString("stream", if (failure == null)
                "UI ${if (demo) "demo" else "smoke"} passed ($theme): $screenshots screenshots; non-secret preferences restored; no credentials saved or provider session started.\n"
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
        check(settings.findViewById<View>(R.id.service_footer).visibility == View.GONE)
        check(SettingsStore.fontSize(targetContext) == initialFont)
        check(SettingsStore.translationColorIndex(targetContext) == initialColor)
        check(SettingsStore.historyLines(targetContext) == initialHistory)
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
        val key = reopened.findViewById<TextInputEditText>(R.id.api_key)
        onUi {
            reopened.findViewById<RadioButton>(R.id.provider_dashscope).performClick()
            key.setText("preview-aliyun")
            reopened.findViewById<RadioButton>(R.id.provider_openai).performClick()
            key.setText("preview-openai")
            reopened.findViewById<RadioButton>(R.id.provider_dashscope).performClick()
            check(key.text.toString() == "preview-aliyun") { "Provider draft was lost" }
            key.setText("")
            key.clearFocus()
        }
        click(reopened, R.id.advanced_toggle)
        check(reopened.findViewById<View>(R.id.glossary_panel).isShown)
        click(reopened, R.id.advanced_toggle)
        capture("settings-service-$theme")
        click(reopened, R.id.tab_appearance)
        click(reopened, R.id.tab_service)
        onUi {
            check(key.text.toString().isEmpty()) { "Tab switch changed service draft" }
            reopened.findViewById<RadioButton>(R.id.provider_openai).performClick()
            check(key.text.toString() == "preview-openai") { "Second provider draft was lost" }
            check(reopened.findViewById<View>(R.id.glossary_panel).visibility == View.GONE)
            key.setText("")
            key.requestFocus()
            WindowCompat.getInsetsController(reopened.window, key).show(WindowInsetsCompat.Type.ime())
        }
        repeat(30) {
            if (ViewCompat.getRootWindowInsets(key)?.isVisible(WindowInsetsCompat.Type.ime()) != true) Thread.sleep(100)
        }
        check(ViewCompat.getRootWindowInsets(key)?.isVisible(WindowInsetsCompat.Type.ime()) == true) { "Keyboard did not open" }
        capture("settings-keyboard-$theme")
        onUi { reopened.finish(); home.finish() }
        waitForIdleSync()
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
        onUi {
            listOf(R.id.api_key, R.id.base_url, R.id.model, R.id.hotwords).forEach {
                settings.findViewById<TextInputEditText>(it).setText("")
            }
        }
        pause("服务设置只保留关键项", 2500)
        click(settings, R.id.provider_openai)
        onUi {
            listOf(R.id.api_key, R.id.base_url, R.id.model, R.id.hotwords).forEach {
                settings.findViewById<TextInputEditText>(it).setText("")
            }
        }
        pause("两种服务可选，Key 仍需主动保存", 1800)
        click(settings, R.id.advanced_toggle)
        pause("自定义服务地址和模型按需展开", 2200)
        click(settings, R.id.advanced_toggle)
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
        private val source = SettingsStore.sourceLang(targetContext)
        private val target = restoreTarget ?: SettingsStore.targetLang(targetContext)
        private val font = restoreFont ?: SettingsStore.fontSize(targetContext)
        private val color = restoreColor ?: SettingsStore.translationColorIndex(targetContext)
        private val opacity = SettingsStore.overlayOpacity(targetContext)
        private val background = SettingsStore.overlayBgAlpha(targetContext)
        private val history = SettingsStore.historyLines(targetContext)
        fun restore() {
            SettingsStore.setSourceLang(targetContext, source)
            SettingsStore.setTargetLang(targetContext, target)
            SettingsStore.setFontSize(targetContext, font)
            SettingsStore.setTranslationColorIndex(targetContext, color)
            SettingsStore.setOverlayOpacity(targetContext, opacity)
            SettingsStore.setOverlayBgAlpha(targetContext, background)
            SettingsStore.setHistoryLines(targetContext, history)
            SubtitleBus.clear()
        }
    }
}
