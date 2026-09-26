package app.yuxino.mimi.android

import android.os.Bundle
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

    private val colorNames = listOf("青绿（默认）", "白色", "黄色", "绿色", "粉色")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

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

        // Switching provider swaps the endpoint/model fields to that provider's values.
        providerGroup.setOnCheckedChangeListener { _, _ ->
            if (baseUrlInput.hasFocus() || modelInput.hasFocus()) return@setOnCheckedChangeListener
            baseUrlInput.setText(SettingsStore.baseUrl(this, currentProvider()))
            modelInput.setText(SettingsStore.model(this, currentProvider()))
        }
        sourceSpinner.setSelection(sourceCodes.indexOf(SettingsStore.sourceLang(this)).coerceAtLeast(0))
        targetSpinner.setSelection(targetCodes.indexOf(SettingsStore.targetLang(this)).coerceAtLeast(0))
        fontSeek.progress = SettingsStore.fontSize(this)
        opacitySeek.progress = SettingsStore.overlayOpacity(this)
        bgAlphaSeek.progress = SettingsStore.overlayBgAlpha(this)
        historySeek.progress = SettingsStore.historyLines(this)
        hotwordsInput.setText(SettingsStore.hotwords(this).keys.joinToString(", "))
        colorSpinner.adapter = arrayAdapter(colorNames)
        colorSpinner.setSelection(SettingsStore.translationColorIndex(this))

        findViewById<MaterialButton>(R.id.reset_position).setOnClickListener {
            SettingsStore.clearOverlayPosition(this)
            Toast.makeText(this, "已恢复默认位置", Toast.LENGTH_SHORT).show()
        }

        findViewById<MaterialButton>(R.id.save).setOnClickListener {
            val provider =
                if (providerOpenai.isChecked) SettingsStore.PROVIDER_OPENAI
                else SettingsStore.PROVIDER_DASHSCOPE
            SettingsStore.setProvider(this, provider)
            SettingsStore.setApiKey(this, apiKeyInput.text?.toString().orEmpty())
            SettingsStore.setBaseUrl(this, provider, baseUrlInput.text?.toString().orEmpty())
            SettingsStore.setModel(this, provider, modelInput.text?.toString().orEmpty())
            SettingsStore.setSourceLang(this, sourceCodes[sourceSpinner.selectedItemPosition])
            SettingsStore.setTargetLang(this, targetCodes[targetSpinner.selectedItemPosition])
            SettingsStore.setFontSize(this, fontSeek.progress)
            SettingsStore.setOverlayOpacity(this, opacitySeek.progress)
            SettingsStore.setOverlayBgAlpha(this, bgAlphaSeek.progress)
            SettingsStore.setHistoryLines(this, historySeek.progress)
            SettingsStore.setHotwords(this, hotwordsInput.text?.toString().orEmpty())
            SettingsStore.setTranslationColorIndex(this, colorSpinner.selectedItemPosition)
            Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    private fun currentProvider(): String =
        if (providerOpenai.isChecked) SettingsStore.PROVIDER_OPENAI
        else SettingsStore.PROVIDER_DASHSCOPE

    private fun arrayAdapter(items: List<String>): ArrayAdapter<String> {
        val adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_item, items,
        )
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        return adapter
    }
}
