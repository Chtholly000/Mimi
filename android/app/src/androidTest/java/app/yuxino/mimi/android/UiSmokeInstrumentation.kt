package app.yuxino.mimi.android

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.RadioButton
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.yuxino.mimi.android.capture.MimiService
import com.google.android.material.textfield.TextInputEditText
import java.io.File

/** Emulator UI checks: no real key is saved, no capture starts, no provider is contacted. */
class UiSmokeInstrumentation : Instrumentation() {
    private var screenshots = 0
    private var theme = "light"

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        theme = arguments?.getString("theme") ?: "light"
        start()
    }

    override fun onStart() {
        super.onStart()
        try {
            check(!MimiService.isRunning) { "Stop the active session before running UI smoke tests." }
            for ((mode, label) in listOf(
                AppCompatDelegate.MODE_NIGHT_NO to "light",
                AppCompatDelegate.MODE_NIGHT_YES to "dark",
            ).filter { it.second == theme }) {
                runOnMainSync { AppCompatDelegate.setDefaultNightMode(mode) }
                val home = launchHome()
                capture("home-$label")
                val monitor = addMonitor(SettingsActivity::class.java.name, null, false)
                runOnMainSync { home.findViewById<View>(R.id.go_settings).performClick() }
                val settings = waitForMonitorWithTimeout(monitor, 3000) as? SettingsActivity
                    ?: error("Settings did not open")
                removeMonitor(monitor)
                waitForIdleSync()
                val key = settings.findViewById<TextInputEditText>(R.id.api_key)
                runOnMainSync {
                    settings.findViewById<RadioButton>(R.id.provider_dashscope).performClick()
                    key.setText("preview-aliyun")
                    settings.findViewById<RadioButton>(R.id.provider_openai).performClick()
                    key.setText("preview-openai")
                    settings.findViewById<RadioButton>(R.id.provider_dashscope).performClick()
                    check(key.text.toString() == "preview-aliyun") { "Provider draft was lost" }
                    settings.findViewById<View>(R.id.advanced_toggle).performClick()
                    check(settings.findViewById<View>(R.id.advanced_panel).visibility == View.VISIBLE)
                    settings.findViewById<View>(R.id.advanced_toggle).performClick()
                    key.setText("") // Screenshot contains no credential, real or synthetic.
                    key.clearFocus()
                }
                capture("settings-service-$label")
                runOnMainSync {
                    settings.findViewById<RadioButton>(R.id.tab_appearance).performClick()
                    check(settings.findViewById<View>(R.id.service_panel).visibility == View.GONE)
                    settings.findViewById<SeekBar>(R.id.font_size).progress = 20
                    check(settings.findViewById<TextView>(R.id.font_size_value).text.contains("20"))
                    settings.findViewById<SeekBar>(R.id.font_size).progress = 16
                    settings.findViewById<Spinner>(R.id.translation_color).setSelection(0)
                    settings.findViewById<SeekBar>(R.id.overlay_opacity).progress = 100
                    settings.findViewById<SeekBar>(R.id.overlay_bg_alpha).progress = 0
                }
                capture("settings-appearance-$label")
                runOnMainSync {
                    settings.findViewById<RadioButton>(R.id.tab_service).performClick()
                    check(key.text.toString().isEmpty()) { "Switching tabs changed the draft" }
                    settings.findViewById<RadioButton>(R.id.provider_openai).performClick()
                    check(key.text.toString() == "preview-openai") { "Second provider draft was lost" }
                    check(settings.findViewById<View>(R.id.glossary_panel).visibility == View.GONE)
                    key.setText("")
                    key.requestFocus()
                    val ime = settings.getSystemService(InputMethodManager::class.java)
                    ime.showSoftInput(key, InputMethodManager.SHOW_IMPLICIT)
                }
                waitForIdleSync()
                runOnMainSync {
                    WindowCompat.getInsetsController(settings.window, key)
                        .show(WindowInsetsCompat.Type.ime())
                }
                repeat(20) {
                    if (ViewCompat.getRootWindowInsets(key)?.isVisible(WindowInsetsCompat.Type.ime()) != true) {
                        Thread.sleep(100)
                    }
                }
                check(ViewCompat.getRootWindowInsets(key)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                    "Keyboard did not open"
                }
                capture("settings-keyboard-$label")
                runOnMainSync {
                    settings.getSystemService(InputMethodManager::class.java)
                        .hideSoftInputFromWindow(key.windowToken, 0)
                    settings.finish() // No Save: all test edits are discarded.
                    home.finish()
                }
                waitForIdleSync()
            }
            runOnMainSync { AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM) }
            launchHome()
            finish(Activity.RESULT_OK, Bundle().apply {
                putString("stream", "UI smoke passed: provider drafts, tabs, advanced fields, sliders, $theme theme; $screenshots screenshots. No settings saved or provider session started.\n")
            })
        } catch (error: Throwable) {
            finish(Activity.RESULT_CANCELED, Bundle().apply {
                putString("stream", "UI smoke failed: ${error.javaClass.simpleName}: ${error.message}\n")
            })
        }
    }

    private fun launchHome(): MainActivity {
        val activity = startActivitySync(Intent(targetContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        waitForIdleSync()
        return activity
    }

    private fun capture(name: String) {
        waitForIdleSync()
        Thread.sleep(350) // Allow the next rendered frame and keyboard animation to settle.
        val bitmap = checkNotNull(uiAutomation.takeScreenshot()) { "Screenshot unavailable" }
        val dir = checkNotNull(targetContext.getExternalFilesDir("ui-preview"))
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        screenshots++
        sendStatus(0, Bundle().apply { putString("stream", "Captured $name\n") })
    }
}
