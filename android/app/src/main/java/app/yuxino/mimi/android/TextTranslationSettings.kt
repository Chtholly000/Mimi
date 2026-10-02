package app.yuxino.mimi.android

import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.doOnLayout
import app.yuxino.mimi.android.provider.*
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

/** A draft only. ServiceSettingsActivity commits this alongside the speech configuration. */
internal class TextTranslationSettings(private val activity: AppCompatActivity, private val onModeChange: (Boolean) -> Unit = {}) {
    private val saved = SettingsStore.translationConfiguration(activity)
    private val root = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val fields = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private val mode = Spinner(activity).apply { tag = "translation-mode"; background = null }
    private val inputLayouts = mutableMapOf<TextInputEditText, TextInputLayout>()
    private val endpoint = field(R.string.translation_endpoint, "translation-endpoint")
    private val model = field(R.string.translation_model, "translation-model")
    private val key = field(R.string.translation_key, "translation-key", true)
    private val localHttp = CheckBox(activity).apply {
        tag = "translation-local-http"; text = activity.getString(R.string.translation_local_http); textSize = 16f
    }
    private val result = ServiceSettingsUi.label(activity, "", 16f).apply {
        tag = "translation-status"; visibility = View.GONE
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private val check = MaterialButton(activity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
        tag = "translation-check"; setText(R.string.translation_check); setIconResource(R.drawable.ic_check)
        textSize = 16f; isAllCaps = false; cornerRadius = dp(12)
    }
    private var forgetKey = false
    private var request: TranslationCall? = null
    private var generation = 0
    val enabled: Boolean get() = mode.selectedItemPosition == 1
    val view: View get() = root

    init {
        val header = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(ServiceSettingsUi.label(activity, activity.getString(R.string.translation_title), 18f), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(helpButton(activity, R.string.translation_help_title, R.string.translation_help, "translation-help"), LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(header)
        mode.adapter = ArrayAdapter(activity, R.layout.mimi_spinner_item,
            listOf(activity.getString(R.string.translation_builtin), activity.getString(R.string.translation_chatmock))).apply {
            setDropDownViewResource(R.layout.mimi_spinner_dropdown)
        }
        mode.contentDescription = activity.getString(R.string.translation_title)
        mode.setSelection(if (SettingsStore.useChatMockTranslation(activity)) 1 else 0)
        root.addView(mode, LinearLayout.LayoutParams(-1, dp(56)).apply { bottomMargin = dp(16) })
        endpoint.setText(saved.endpoint); inputLayouts.getValue(endpoint).placeholderText = "https://example.com/v1"
        model.setText(saved.model)
        updateKeyLabel()
        localHttp.isChecked = saved.allowLocalHttp
        fields.addView(localHttp, LinearLayout.LayoutParams(-1, -2))
        val actions = LinearLayout(activity).apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL }
        if (saved.apiKey.isNotEmpty()) {
            actions.addView(MaterialButton(activity, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
                tag = "translation-remove-key"; setText(R.string.translation_remove_key); textSize = 16f; isAllCaps = false
                setOnClickListener { forgetKey = true; key.setText(""); updateKeyLabel(); visibility = View.GONE; invalidateCheck() }
            })
        }
        actions.addView(check)
        fields.addView(actions, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        fields.addView(result, LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.END; topMargin = dp(8); bottomMargin = dp(12) })
        fields.visibility = if (enabled) View.VISIBLE else View.GONE
        root.addView(fields)
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                invalidateCheck()
                updateKeyLabel()
            }
            override fun afterTextChanged(s: Editable?) = Unit
        }
        listOf(endpoint, model, key).forEach { it.addTextChangedListener(watcher) }
        localHttp.setOnCheckedChangeListener { _, _ -> invalidateCheck() }
        mode.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                fields.visibility = if (enabled) View.VISIBLE else View.GONE
                invalidateCheck(); onModeChange(enabled)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        check.setOnClickListener { checkConnection() }
    }

    fun draft(): TranslationConfiguration? {
        if (!enabled) return saved
        val config = TranslationConfiguration(endpoint.text.toString().trim(), model.text.toString().trim(),
            key.text.toString().trim().ifBlank { if (!forgetKey && sameDestination()) saved.apiKey else "" }, localHttp.isChecked)
        if (config.endpoint.isBlank() || config.model.isBlank()) {
            showError(R.string.translation_required); return null
        }
        try { validateTranslationConfiguration(config) }
        catch (_: IllegalArgumentException) { showError(R.string.translation_invalid); return null }
        return config
    }

    private fun updateKeyLabel() {
        val hasSavedKey = !forgetKey && saved.apiKey.isNotBlank() && sameDestination()
        inputLayouts.getValue(key).hint = activity.getString(if (hasSavedKey) R.string.translation_key_saved else R.string.translation_key)
        inputLayouts.getValue(key).placeholderText = activity.getString(if (hasSavedKey) R.string.service_secret_saved else R.string.translation_key_optional)
    }

    private fun sameDestination(): Boolean = endpoint.text.toString().trim() == saved.endpoint.trim()

    private fun checkConnection() {
        val config = draft() ?: return
        val epoch = ++generation
        request?.cancel()
        check.isEnabled = false; check.setText(R.string.translation_checking)
        result.visibility = View.GONE
        request = OpenAITranslationClient(config).check { outcome -> activity.runOnUiThread {
            if (epoch != generation || activity.isDestroyed || activity.isFinishing) return@runOnUiThread
            request = null; check.isEnabled = true; check.setText(R.string.translation_check)
            result.visibility = View.VISIBLE
            result.text = when (outcome) {
                is TranslationResult.Success -> activity.getString(R.string.translation_check_success, outcome.elapsedMs)
                is TranslationResult.Failure -> activity.getString(when (outcome.code) {
                    "translation_http_401", "translation_http_403" -> R.string.translation_check_auth
                    "translation_http_404" -> R.string.translation_check_not_found
                    "translation_http_429" -> R.string.translation_check_busy
                    "translation_timeout" -> R.string.translation_check_timeout
                    "translation_response", "translation_empty_response", "translation_incomplete", "translation_too_large" -> R.string.translation_check_response
                    else -> R.string.translation_check_failure
                }, outcome.elapsedMs)
            }
            revealResult()
        } }
    }

    private fun showError(message: Int) {
        result.setText(message); result.visibility = View.VISIBLE; revealResult()
    }
    private fun revealResult() {
        result.doOnLayout {
            result.requestRectangleOnScreen(android.graphics.Rect(0, 0, result.width, result.height), false)
        }
    }
    private fun invalidateCheck() {
        ++generation; request?.cancel(); request = null
        check.isEnabled = true; check.setText(R.string.translation_check); result.visibility = View.GONE
    }
    fun dispose() { invalidateCheck() }
    private fun dp(value: Int) = ServiceSettingsUi.dp(activity, value)
    private fun field(title: Int, tag: String, secret: Boolean = false): TextInputEditText {
        val box = TextInputLayout(activity).apply {
            hint = activity.getString(title); isSaveEnabled = false
            if (secret) endIconMode = TextInputLayout.END_ICON_PASSWORD_TOGGLE
        }
        val edit = TextInputEditText(box.context).apply {
            this.tag = tag; textSize = 16f; isSingleLine = true; isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            typeface = android.graphics.Typeface.DEFAULT
        }
        inputLayouts[edit] = box
        box.addView(edit, LinearLayout.LayoutParams(-1, -2))
        fields.addView(box, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
        return edit
    }
}

internal fun helpButton(activity: AppCompatActivity, title: Int, body: Int, tag: String): ImageButton = ImageButton(activity).apply {
    this.tag = tag; setImageResource(R.drawable.ic_help)
    setBackgroundColor(android.graphics.Color.TRANSPARENT)
    imageTintList = ContextCompat.getColorStateList(activity, R.color.mimi_muted)
    contentDescription = activity.getString(title); tooltipText = activity.getString(title)
    setOnClickListener {
        MaterialAlertDialogBuilder(activity).setTitle(title).setMessage(body)
            .setPositiveButton(android.R.string.ok, null).show()
    }
}
