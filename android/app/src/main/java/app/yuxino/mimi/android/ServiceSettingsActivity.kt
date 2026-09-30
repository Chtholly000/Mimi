package app.yuxino.mimi.android

import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.yuxino.mimi.android.capture.MimiService
import app.yuxino.mimi.android.provider.*
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

class ServiceSettingsActivity : AppCompatActivity() {
    private val inputs = linkedMapOf<String, Pair<TextInputLayout,TextInputEditText>>()
    private lateinit var provider: ServiceProvider
    private lateinit var saved: ServiceConfiguration
    private var storageUnavailable = false
    private lateinit var endpointInput: TextInputEditText
    private lateinit var modelInput: TextInputEditText
    private var hotwordsInput: TextInputEditText? = null
    private lateinit var status: android.widget.TextView
    private fun dp(value:Int)=ServiceSettingsUi.dp(this,value)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        provider=ServiceProvider.fromId(intent.getStringExtra("provider").orEmpty())
        saved=runCatching { SettingsStore.configuration(this,provider) }.getOrElse { storageUnavailable = true; ServiceConfiguration(provider, emptyMap()) }
        val root=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }
        val header=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL; setPadding(dp(12),0,dp(24),0) }
        header.addView(ImageButton(this).apply {
            id=R.id.back; setImageResource(R.drawable.ic_back); setBackgroundColor(android.graphics.Color.TRANSPARENT)
            imageTintList=ContextCompat.getColorStateList(context,R.color.mimi_text)
            contentDescription=getString(R.string.settings_back); setOnClickListener { finish() }
        },LinearLayout.LayoutParams(dp(48),dp(48)))
        header.addView(ServiceSettingsUi.label(this,providerTitle(this, provider),21f))
        root.addView(header,LinearLayout.LayoutParams(-1,dp(64)))
        val scroll=ScrollView(this).apply { isFillViewport=true }
        val content=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(24),dp(12),dp(24),dp(24)) }
        content.addView(ServiceSettingsUi.label(this,providerDescription(this, provider),14f,true))
        status=ServiceSettingsUi.label(this,getString(if(runCatching { SettingsStore.isConfigured(this,provider) }.getOrDefault(false)) R.string.service_saved_hint else R.string.service_setup_hint),13f,true)
        if (storageUnavailable) status.text = getString(R.string.guide_storage_unavailable)
        content.addView(status,LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(10); bottomMargin=dp(24) })
        val help = providerHelp(provider)
        content.addView(ServiceSettingsUi.label(this, getString(help.setup), 13f, true))
        listOf(getString(R.string.guide_official) to help.documentation, getString(R.string.guide_billing) to help.billing).forEach { (title, url) ->
            content.addView(MaterialButton(this, null, com.google.android.material.R.attr.borderlessButtonStyle).apply {
                text = title; isAllCaps = false
                setOnClickListener {
                    try { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
                    catch (_: android.content.ActivityNotFoundException) { Toast.makeText(this@ServiceSettingsActivity, getString(R.string.guide_no_browser), Toast.LENGTH_SHORT).show() }
                }
            })
        }
        content.addView(ServiceSettingsUi.label(this, getString(R.string.guide_local_save), 12f, true))
        provider.fields.forEach { field ->
            val title = when (field.id) {
                "endpoint" -> getString(R.string.guide_field_endpoint)
                "deployment" -> getString(R.string.guide_field_deployment)
                "transcriptionDeployment" -> getString(R.string.guide_field_transcription)
                else -> field.label
            }
            val pair=field(content,field.id,title,field.secret)
            if(field.secret) {
                if(saved.value(field.id).isNotBlank()) pair.first.helperText=getString(R.string.service_secret_saved)
            } else pair.second.setText(saved.value(field.id))
            inputs[field.id]=pair
        }
        val advanced=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; visibility=View.GONE }
        if(provider.hasAdvanced || provider == ServiceProvider.DASHSCOPE) {
            val toggle=MaterialButton(this,null,com.google.android.material.R.attr.borderlessButtonStyle).apply {
                id=R.id.advanced_toggle; text=getString(R.string.settings_advanced); isAllCaps=false
                setTextColor(ContextCompat.getColor(context,R.color.mimi_text))
                setOnClickListener { advanced.visibility=if(advanced.visibility==View.VISIBLE) View.GONE else View.VISIBLE
                    setText(if(advanced.visibility==View.VISIBLE) R.string.settings_advanced_collapse else R.string.settings_advanced) }
            }
            content.addView(toggle,LinearLayout.LayoutParams(-1,dp(48)))
        }
        endpointInput=field(advanced,"baseUrl",getString(R.string.service_endpoint),false).second
        modelInput=field(advanced,"model",getString(R.string.service_model),false).second
        endpointInput.setText(saved.endpoint); endpointInput.hint=provider.endpoint
        modelInput.setText(saved.model); modelInput.hint=provider.model
        if(provider == ServiceProvider.DASHSCOPE) {
            hotwordsInput=field(advanced,"hotwords",getString(R.string.service_glossary),false).second.apply {
                setText(runCatching { SettingsStore.hotwordsText(this@ServiceSettingsActivity) }.getOrDefault("")); hint="Mimi=mimi"
            }
        }
        if(provider.hasAdvanced) content.addView(advanced)
        scroll.addView(content); root.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        val footer=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(24),dp(8),dp(24),dp(12)) }
        footer.addView(MaterialButton(this).apply {
            id=R.id.save; text=getString(R.string.service_save_use); setOnClickListener { save() }
        },LinearLayout.LayoutParams(-1,dp(52)))
        root.addView(footer); setContentView(root); applySystemBarInsets()
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }
    private fun field(container:LinearLayout, tag:String, title:String, secret:Boolean):Pair<TextInputLayout,TextInputEditText> {
        val box=TextInputLayout(this).apply {
            hint=title; if(secret) endIconMode=TextInputLayout.END_ICON_PASSWORD_TOGGLE
            isSaveEnabled=false
        }
        val edit=TextInputEditText(box.context).apply {
            this.tag="credential-$tag"; isSaveEnabled=false; importantForAutofill=View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            inputType=if(secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            isSingleLine=true; textSize=15f; typeface=android.graphics.Typeface.DEFAULT
        }
        box.addView(edit,LinearLayout.LayoutParams(-1,-2))
        container.addView(box,LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(18) })
        return box to edit
    }
    private fun save() {
        if(MimiService.isRunning) { Toast.makeText(this,R.string.service_stop_first,Toast.LENGTH_SHORT).show(); return }
        var valid=true
        val values=provider.fields.associate { field ->
            val (layout,edit)=inputs.getValue(field.id)
            val value=edit.text.toString().trim().ifBlank { if(field.secret) saved.value(field.id) else "" }
            layout.error=if(value.isBlank()) getString(R.string.service_required) else null
            if(value.isBlank()) valid=false
            field.id to value
        }
        if(!valid) return
        val config=ServiceConfiguration(provider,values,endpointInput.text.toString().trim(),modelInput.text.toString().trim())
        val (source, target) = runCatching {
            provider.normalize(SettingsStore.sourceLang(this), SettingsStore.targetLang(this))
        }.getOrElse { status.text = getString(R.string.guide_storage_unavailable); return }
        // Validate URL/signing requirements locally without contacting a provider or logging secrets.
        try {
            if(provider.hasAdvanced && config.endpoint.isNotBlank()) endpoint(config)
            if(provider !in listOf(ServiceProvider.DASHSCOPE,ServiceProvider.OPENAI)) createProtocol(config,source,target).request()
        } catch (_:Exception) { status.text=getString(R.string.service_invalid); return }
        if(!runCatching { SettingsStore.saveConfiguration(this,config) && SettingsStore.activateProvider(this,provider) }.getOrDefault(false)) {
            status.text=getString(R.string.guide_storage_unavailable); return
        }
        hotwordsInput?.let { SettingsStore.setHotwords(this,it.text.toString()) }
        Toast.makeText(this,R.string.settings_saved,Toast.LENGTH_SHORT).show(); finish()
    }
}
