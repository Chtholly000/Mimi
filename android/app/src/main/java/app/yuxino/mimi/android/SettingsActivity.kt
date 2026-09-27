package app.yuxino.mimi.android

import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.TextView
import android.widget.ArrayAdapter
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText

class SettingsActivity : AppCompatActivity() {

    private lateinit var providerGroup: RadioGroup
    private lateinit var providerDashscope: RadioButton
    private lateinit var providerOpenai: RadioButton
    private lateinit var apiKeyInput: TextInputEditText
    private lateinit var baseUrlInput: TextInputEditText
    private lateinit var modelInput: TextInputEditText
    private lateinit var sourceSpinner: Spinner
    private lateinit var targetSpinner: Spinner
    private lateinit var fontSeek: SeekBar
    private lateinit var opacitySeek: SeekBar
    private lateinit var bgAlphaSeek: SeekBar
    private lateinit var historySeek: SeekBar
    private lateinit var hotwordsInput: TextInputEditText
    private lateinit var colorSpinner: Spinner

    private val sourceCodes = listOf("auto", "zh", "en", "ja", "ko")
    private val targetCodes = listOf("zh", "en", "ja")

    // Display the neutral default first without changing persisted preset indices.
    private val colorIndices = listOf(1, 0, 2, 3, 4)
    private val colorNameIds = listOf(
        R.string.settings_color_white, R.string.settings_color_teal,
        R.string.settings_color_yellow, R.string.settings_color_green,
        R.string.settings_color_pink,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        applySystemBarInsets()
        findViewById<View>(R.id.back).setOnClickListener { finish() }
        val tabs = findViewById<RadioGroup>(R.id.settings_tabs)
        fun showTab() {
            val appearance = tabs.checkedRadioButtonId == R.id.tab_appearance
            findViewById<View>(R.id.service_panel).visibility = if (appearance) View.GONE else View.VISIBLE
            findViewById<View>(R.id.appearance_panel).visibility = if (appearance) View.VISIBLE else View.GONE
        }
        tabs.setOnCheckedChangeListener { _, _ -> showTab() }
        tabs.check(savedInstanceState?.getInt("settings_tab", R.id.tab_service) ?: R.id.tab_service)
        showTab()
        val advancedPanel = findViewById<View>(R.id.advanced_panel)
        val advancedToggle = findViewById<MaterialButton>(R.id.advanced_toggle)
        fun showAdvanced(expanded: Boolean) {
            advancedPanel.visibility = if (expanded) View.VISIBLE else View.GONE
            advancedToggle.setText(if (expanded) R.string.settings_advanced_collapse else R.string.settings_advanced)
        }
        showAdvanced(savedInstanceState?.getBoolean("settings_advanced") ?: false)
        advancedToggle.setOnClickListener { showAdvanced(advancedPanel.visibility != View.VISIBLE) }

        providerGroup = findViewById(R.id.provider_group)
        providerDashscope = findViewById(R.id.provider_dashscope)
        providerOpenai = findViewById(R.id.provider_openai)
        apiKeyInput = findViewById(R.id.api_key)
        baseUrlInput = findViewById(R.id.base_url)
        modelInput = findViewById(R.id.model)
        sourceSpinner = findViewById(R.id.source_lang)
        targetSpinner = findViewById(R.id.target_lang)
        fontSeek = findViewById(R.id.font_size)
        opacitySeek = findViewById(R.id.overlay_opacity)
        bgAlphaSeek = findViewById(R.id.overlay_bg_alpha)
        historySeek = findViewById(R.id.history_lines)
        hotwordsInput = findViewById(R.id.hotwords)
        colorSpinner = findViewById(R.id.translation_color)

        sourceSpinner.adapter = arrayAdapter(
            listOf(getString(R.string.lang_auto), getString(R.string.lang_zh),
                getString(R.string.lang_en), getString(R.string.lang_ja),
                getString(R.string.lang_ko)),
        )
        targetSpinner.adapter = arrayAdapter(
            listOf(getString(R.string.lang_zh), getString(R.string.lang_en),
                getString(R.string.lang_ja)),
        )

        when (SettingsStore.provider(this)) {
            SettingsStore.PROVIDER_OPENAI -> providerOpenai.isChecked = true
            else -> providerDashscope.isChecked = true
        }
        apiKeyInput.setText(SettingsStore.apiKey(this))
        baseUrlInput.setText(SettingsStore.baseUrl(this, currentProvider()))
        modelInput.setText(SettingsStore.model(this, currentProvider()))

        // Keep unsaved edits separate while switching providers; Save persists them.
        data class ProviderDraft(val key: String, val endpoint: String, val model: String)
        val drafts = mutableMapOf<String, ProviderDraft>()
        var displayedProvider = currentProvider()
        fun rememberDraft() {
            drafts[displayedProvider] = ProviderDraft(
                apiKeyInput.text?.toString().orEmpty(),
                baseUrlInput.text?.toString().orEmpty(),
                modelInput.text?.toString().orEmpty(),
            )
        }
        providerGroup.setOnCheckedChangeListener { _, _ ->
            rememberDraft()
            displayedProvider = currentProvider()
            val draft = drafts[displayedProvider] ?: ProviderDraft(
                SettingsStore.apiKey(this, displayedProvider),
                SettingsStore.baseUrl(this, displayedProvider),
                SettingsStore.model(this, displayedProvider),
            )
            apiKeyInput.setText(draft.key)
            baseUrlInput.setText(draft.endpoint)
            modelInput.setText(draft.model)
            updateProviderFields()
        }
        updateProviderFields()
        sourceSpinner.setSelection(sourceCodes.indexOf(SettingsStore.sourceLang(this)).coerceAtLeast(0))
        targetSpinner.setSelection(targetCodes.indexOf(SettingsStore.targetLang(this)).coerceAtLeast(0))
        fontSeek.progress = SettingsStore.fontSize(this)
        opacitySeek.progress = SettingsStore.overlayOpacity(this)
        bgAlphaSeek.progress = SettingsStore.overlayBgAlpha(this)
        historySeek.progress = SettingsStore.historyLines(this)
        hotwordsInput.setText(SettingsStore.hotwordsText(this))
        colorSpinner.adapter = arrayAdapter(colorNameIds.map { getString(it) })
        colorSpinner.setSelection(colorIndices.indexOf(SettingsStore.translationColorIndex(this)).coerceAtLeast(0))

        val sliderListener = object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) = refreshPreview()
            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        }
        listOf(fontSeek, opacitySeek, bgAlphaSeek, historySeek).forEach {
            it.setOnSeekBarChangeListener(sliderListener)
        }
        val selectionListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) = refreshPreview()
            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        colorSpinner.onItemSelectedListener = selectionListener
        targetSpinner.onItemSelectedListener = selectionListener
        refreshPreview()

        findViewById<MaterialButton>(R.id.reset_position).setOnClickListener {
            SettingsStore.clearOverlayPosition(this)
            Toast.makeText(this, R.string.settings_reset_done, Toast.LENGTH_SHORT).show()
        }

        findViewById<MaterialButton>(R.id.save).setOnClickListener {
            val provider =
                if (providerOpenai.isChecked) SettingsStore.PROVIDER_OPENAI
                else SettingsStore.PROVIDER_DASHSCOPE
            rememberDraft()
            for ((draftProvider, draft) in drafts) {
                SettingsStore.setApiKey(this, draft.key, draftProvider)
                SettingsStore.setBaseUrl(this, draftProvider, draft.endpoint)
                SettingsStore.setModel(this, draftProvider, draft.model)
            }
            SettingsStore.setProvider(this, provider)
            SettingsStore.setSourceLang(this, sourceCodes[sourceSpinner.selectedItemPosition])
            SettingsStore.setTargetLang(this, targetCodes[targetSpinner.selectedItemPosition])
            SettingsStore.setFontSize(this, fontSeek.progress)
            SettingsStore.setOverlayOpacity(this, opacitySeek.progress)
            SettingsStore.setOverlayBgAlpha(this, bgAlphaSeek.progress)
            SettingsStore.setHistoryLines(this, historySeek.progress)
            SettingsStore.setHotwords(this, hotwordsInput.text?.toString().orEmpty())
            SettingsStore.setTranslationColorIndex(this, colorIndices[colorSpinner.selectedItemPosition])
            Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt("settings_tab", findViewById<RadioGroup>(R.id.settings_tabs).checkedRadioButtonId)
        outState.putBoolean("settings_advanced", findViewById<View>(R.id.advanced_panel).visibility == View.VISIBLE)
        super.onSaveInstanceState(outState)
    }

    private fun updateProviderFields() {
        findViewById<View>(R.id.glossary_panel).visibility =
            if (currentProvider() == SettingsStore.PROVIDER_DASHSCOPE) View.VISIBLE else View.GONE
    }

    private fun refreshPreview() {
        findViewById<TextView>(R.id.font_size_value).text = getString(R.string.settings_font_value, fontSeek.progress)
        findViewById<TextView>(R.id.overlay_opacity_value).text = getString(R.string.settings_percent_value, opacitySeek.progress)
        findViewById<TextView>(R.id.overlay_bg_alpha_value).text = getString(R.string.settings_percent_value, bgAlphaSeek.progress)
        findViewById<TextView>(R.id.history_lines_value).text =
            if (historySeek.progress == 0) getString(R.string.settings_history_off)
            else getString(R.string.settings_history_value, historySeek.progress)
        val colorIndex = colorIndices[colorSpinner.selectedItemPosition.coerceAtLeast(0)]
        findViewById<SubtitlePreviewView>(R.id.subtitle_preview).configure(
            fontSeek.progress, SettingsStore.COLOR_PRESETS[colorIndex].toInt(),
            opacitySeek.progress, bgAlphaSeek.progress,
            targetCodes[targetSpinner.selectedItemPosition.coerceAtLeast(0)],
        )
    }

    private fun currentProvider(): String =
        if (providerOpenai.isChecked) SettingsStore.PROVIDER_OPENAI
        else SettingsStore.PROVIDER_DASHSCOPE

    private fun arrayAdapter(items: List<String>): ArrayAdapter<String> {
        val adapter = ArrayAdapter(
            this, R.layout.mimi_spinner_item, items,
        )
        adapter.setDropDownViewResource(R.layout.mimi_spinner_dropdown)
        return adapter
    }
}
