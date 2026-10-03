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
        val heading = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        heading.addView(label(activity, activity.getString(R.string.services_heading), 25f).apply { setTypeface(typeface,Typeface.BOLD) }, LinearLayout.LayoutParams(0,-2,1f))
        heading.addView(helpButton(activity, R.string.services_heading, R.string.services_hint, "services-help").apply {
            setOnClickListener {
                com.google.android.material.dialog.MaterialAlertDialogBuilder(activity)
                    .setTitle(R.string.services_heading)
                    .setMessage(activity.getString(R.string.services_hint) + "\n\n" + activity.getString(R.string.services_key_note))
                    .setPositiveButton(android.R.string.ok, null).show()
            }
        }, LinearLayout.LayoutParams(dp(activity,48),dp(activity,48)))
        container.addView(heading, LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(activity,16) })
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
                contentDescription="${providerTitle(activity, provider)}，${activity.getString(if(!configured) R.string.service_missing else if(active) R.string.service_active else R.string.service_configured)}"
            }
            val mark = android.widget.ImageView(activity).apply {
                setImageResource(serviceProviderIcon(provider))
                scaleType=android.widget.ImageView.ScaleType.FIT_CENTER
                setPadding(dp(activity,4),dp(activity,4),dp(activity,4),dp(activity,4))
                importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
            select.addView(mark, LinearLayout.LayoutParams(dp(activity,40),dp(activity,40)).apply { marginEnd=dp(activity,12) })
            val copy=LinearLayout(activity).apply { orientation=LinearLayout.VERTICAL }
            copy.addView(label(activity,providerTitle(activity, provider),16f).apply { setTypeface(typeface,if(active) Typeface.BOLD else Typeface.NORMAL) })
            copy.addView(label(activity, activity.getString(if(!configured) R.string.service_missing else if(active) R.string.service_active else R.string.service_configured),16f,true))
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
                textSize=16f; isAllCaps=false; minWidth=dp(activity,72); minimumWidth=dp(activity,72); minimumHeight=dp(activity,48); tag="configure-${provider.id}"
                contentDescription=activity.getString(R.string.service_edit_named,providerTitle(activity, provider))
                setTextColor(ContextCompat.getColor(activity,R.color.mimi_text))
                setOnClickListener { if(MimiService.isRunning) Toast.makeText(activity,R.string.service_stop_first,Toast.LENGTH_SHORT).show() else edit() }
            }
            row.addView(edit,LinearLayout.LayoutParams(-2,-2))
            container.addView(row)
            container.addView(View(activity).apply { setBackgroundColor(ContextCompat.getColor(activity,R.color.mimi_border)) },LinearLayout.LayoutParams(-1,dp(activity,1)))
        }
    }
}
