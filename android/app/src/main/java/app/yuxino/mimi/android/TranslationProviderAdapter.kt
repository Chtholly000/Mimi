package app.yuxino.mimi.android

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.TextView
import androidx.core.content.ContextCompat
import app.yuxino.mimi.android.provider.TextTranslationProvider

/** Match desktop provider marks without changing their artwork, colors or aspect ratios. */
internal class TranslationProviderAdapter(context: Context, private val providers: List<TextTranslationProvider>) :
    ArrayAdapter<String>(context, R.layout.mimi_spinner_item, providers.map { context.getString(translationProviderLabel(it)) }) {
    init { setDropDownViewResource(R.layout.mimi_spinner_dropdown) }

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
        bind(super.getView(position, convertView, parent), position, showArrow = true)

    override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View =
        bind(super.getDropDownView(position, convertView, parent), position, showArrow = false)

    private fun bind(view: View, position: Int, showArrow: Boolean): View = view.apply {
        val row = this as TextView
        val iconResource = when (providers[position]) {
            TextTranslationProvider.BUILTIN -> R.drawable.ic_translation_alibaba
            TextTranslationProvider.OPENAI_COMPATIBLE -> R.drawable.ic_service_languages
            TextTranslationProvider.DEEPL -> R.drawable.ic_translation_deepl
            TextTranslationProvider.DEEPLX -> R.drawable.ic_translation_deeplx
            TextTranslationProvider.NONE -> R.drawable.ic_translation_captions
        }
        val icon = ContextCompat.getDrawable(context, iconResource)?.apply { setBounds(0, 0, dp(24), dp(24)) }
        val arrow = if (showArrow) ContextCompat.getDrawable(context, R.drawable.ic_expand)?.apply { setBounds(0, 0, dp(16), dp(16)) } else null
        row.setCompoundDrawablesRelative(icon, null, arrow, null)
        row.compoundDrawablePadding = dp(12)
        row.textSize = 16f
    }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density + 0.5f).toInt()
}
