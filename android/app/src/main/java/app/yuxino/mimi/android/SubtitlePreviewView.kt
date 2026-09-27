package app.yuxino.mimi.android

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.AttributeSet
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/** Clearly marked sample content; never starts capture or opens a provider session. */
class SubtitlePreviewView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : LinearLayout(context, attrs) {
    private val source = TextView(context)
    private val translation = TextView(context)
    private val subtitle = LinearLayout(context)

    init {
        orientation = VERTICAL
        minimumHeight = dp(176)
        setPadding(dp(20), dp(18), dp(20), dp(20))
        background = GradientDrawable().apply {
            setColor(ContextCompat.getColor(context, R.color.mimi_preview_bg))
            cornerRadius = dp(14).toFloat()
        }
        val labelRow = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        labelRow.addView(TextView(context).apply {
            setText(R.string.preview_label)
            setTextColor(Color.rgb(184, 184, 184))
            textSize = 11f
        }, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
        labelRow.addView(TextView(context).apply {
            setText(R.string.preview_example)
            setTextColor(Color.rgb(145, 145, 145))
            textSize = 10f
        })
        addView(labelRow)
        subtitle.orientation = VERTICAL
        subtitle.setPadding(dp(8), dp(10), dp(8), dp(10))
        source.setTextColor(Color.rgb(203, 203, 203))
        source.textSize = 14f
        source.setLineSpacing(dp(3).toFloat(), 1f)
        translation.setTextColor(Color.WHITE)
        translation.textSize = 19f
        translation.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        translation.setLineSpacing(dp(4).toFloat(), 1f)
        subtitle.addView(source, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        subtitle.addView(translation, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
        })
        addView(subtitle, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(18)
        })
        configure(16, Color.WHITE, 100, 0, "zh")
    }

    fun configure(fontSize: Int, color: Int, opacity: Int, backgroundAlpha: Int, targetLang: String) {
        source.setText(if (targetLang == "en") R.string.preview_zh else R.string.preview_source)
        translation.setText(when (targetLang) {
            "en" -> R.string.preview_en
            "ja" -> R.string.preview_ja
            else -> R.string.preview_zh
        })
        source.textSize = fontSize.coerceIn(12, 24).toFloat()
        translation.textSize = fontSize.coerceIn(12, 24) + 3f
        translation.setTextColor(color)
        subtitle.alpha = opacity.coerceIn(20, 100) / 100f
        subtitle.background = GradientDrawable().apply {
            setColor(Color.argb(backgroundAlpha.coerceIn(0, 90) * 255 / 100, 16, 16, 16))
            cornerRadius = dp(8).toFloat()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
