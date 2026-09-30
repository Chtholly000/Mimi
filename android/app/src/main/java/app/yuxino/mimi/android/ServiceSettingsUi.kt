package app.yuxino.mimi.android

import android.content.Intent
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import app.yuxino.mimi.android.provider.ServiceProvider
import app.yuxino.mimi.android.capture.MimiService
import com.google.android.material.button.MaterialButton

internal object ServiceSettingsUi {
    fun dp(activity: AppCompatActivity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    fun label(activity: AppCompatActivity, text: String, size: Float = 14f, secondary: Boolean = false) = TextView(activity).apply {
        this.text = text; textSize = size
        setTextColor(ContextCompat.getColor(activity, if(secondary) R.color.mimi_muted else R.color.mimi_text))
        setLineSpacing(dp(activity,3).toFloat(),1f)
    }
    fun renderList(activity: AppCompatActivity, container: LinearLayout) {
        container.removeAllViews()
        container.addView(label(activity, activity.getString(R.string.services_heading), 25f).apply { setTypeface(typeface,Typeface.BOLD) })
        container.addView(label(activity, activity.getString(R.string.services_hint), 13f, true), LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(activity,8); bottomMargin=dp(activity,22) })
        for(provider in ServiceProvider.entries) {
            val active = SettingsStore.provider(activity) == provider.id
            val configured = SettingsStore.isConfigured(activity,provider)
            val row = LinearLayout(activity).apply {
                orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL
                minimumHeight=dp(activity,78); tag="service-${provider.id}"
            }
            val select = LinearLayout(activity).apply {
                orientation=LinearLayout.HORIZONTAL; gravity=Gravity.CENTER_VERTICAL
                minimumHeight=dp(activity,72); isClickable=true; isFocusable=true
                contentDescription="${providerTitle(activity, provider)}，${activity.getString(if(active) R.string.service_active else if(configured) R.string.service_configured else R.string.service_missing)}"
            }
            val mark = android.widget.ImageView(activity).apply {
                setImageResource(if(active) R.drawable.ic_check else when(provider) {
                    ServiceProvider.DASHSCOPE,ServiceProvider.AZURE -> R.drawable.ic_service_cloud
                    ServiceProvider.XAI -> R.drawable.ic_service_waves_horizontal
                    else -> R.drawable.ic_service_languages
                })
                setPadding(dp(activity,8),dp(activity,8),dp(activity,8),dp(activity,8))
                imageTintList=ContextCompat.getColorStateList(activity,R.color.mimi_text)
                importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            select.addView(mark, LinearLayout.LayoutParams(dp(activity,40),dp(activity,40)).apply { marginEnd=dp(activity,12) })
            val copy=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL }
            copy.addView(label(activity,providerTitle(activity, provider),16f).apply { setTypeface(typeface,if(active) Typeface.BOLD else Typeface.NORMAL) })
            copy.addView(label(activity, if(active) activity.getString(R.string.service_active) else if(configured) activity.getString(R.string.service_configured) else providerDescription(activity, provider),12f,true))
            select.addView(copy,LinearLayout.LayoutParams(0,-2,1f))
            fun edit() { activity.startActivity(Intent(activity,ServiceSettingsActivity::class.java).putExtra("provider",provider.id)) }
            select.setOnClickListener {
                when {
                    MimiService.isRunning -> Toast.makeText(activity,R.string.service_stop_first,Toast.LENGTH_SHORT).show()
                    !configured -> edit()
                    !active -> { SettingsStore.activateProvider(activity,provider); renderList(activity,container) }
                    else -> edit()
                }
            }
            row.addView(select,LinearLayout.LayoutParams(0,-2,1f))
            val edit=MaterialButton(activity,null,com.google.android.material.R.attr.borderlessButtonStyle).apply {
                text=activity.getString(if(configured) R.string.service_edit else R.string.service_configure)
                textSize=13f; isAllCaps=false; minWidth=0; minimumWidth=0; tag="configure-${provider.id}"
                contentDescription=activity.getString(R.string.service_edit_named,providerTitle(activity, provider))
                setTextColor(ContextCompat.getColor(activity,R.color.mimi_text))
                setOnClickListener { if(MimiService.isRunning) Toast.makeText(activity,R.string.service_stop_first,Toast.LENGTH_SHORT).show() else edit() }
            }
            row.addView(edit,LinearLayout.LayoutParams(dp(activity,72),dp(activity,48)))
            container.addView(row)
            container.addView(View(activity).apply { setBackgroundColor(ContextCompat.getColor(activity,R.color.mimi_border)) },LinearLayout.LayoutParams(-1,dp(activity,1)))
        }
        container.addView(label(activity,activity.getString(R.string.services_key_note),12f,true),LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(activity,20) })
    }
}
