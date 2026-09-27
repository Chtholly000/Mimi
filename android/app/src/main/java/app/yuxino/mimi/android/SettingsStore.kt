package app.yuxino.mimi.android

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** EncryptedSharedPreferences-backed settings (API key stays in Android Keystore-backed storage). */
object SettingsStore {
    private const val FILE = "mimi_secure"

    private const val KEY_PROVIDER = "provider"
    private const val KEY_API_KEY = "api_key"
    private const val KEY_SOURCE_LANG = "source_lang"
    private const val KEY_TARGET_LANG = "target_lang"
    private const val KEY_FONT_SIZE = "font_size"
    private const val KEY_BASE_URL_PREFIX = "base_url_"
    private const val KEY_MODEL_PREFIX = "model_"
    private const val KEY_OVERLAY_OPACITY = "overlay_opacity"
    private const val KEY_OVERLAY_BG_ALPHA = "overlay_bg_alpha"
    private const val KEY_HISTORY_LINES = "history_lines"
    private const val KEY_HOTWORDS = "hotwords"
    private const val KEY_TRANSLATION_COLOR = "translation_color"
    private const val KEY_OVERLAY_X = "overlay_x"
    private const val KEY_OVERLAY_Y = "overlay_y"
    private const val KEY_OVERLAY_SAVED = "overlay_saved"

    const val PROVIDER_DASHSCOPE = "dashscope"
    const val PROVIDER_OPENAI = "openai"

    private var prefs: SharedPreferences? = null

    private fun get(context: Context): SharedPreferences {
        return prefs ?: synchronized(this) {
            prefs ?: run {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context, FILE, masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                ).also { prefs = it }
            }
        }
    }

    fun provider(context: Context): String =
        get(context).getString(KEY_PROVIDER, PROVIDER_DASHSCOPE) ?: PROVIDER_DASHSCOPE

    fun setProvider(context: Context, value: String) =
        get(context).edit().putString(KEY_PROVIDER, value).apply()

    fun apiKey(context: Context): String =
        get(context).getString(KEY_API_KEY, "") ?: ""

    fun setApiKey(context: Context, value: String) =
        get(context).edit().putString(KEY_API_KEY, value.trim()).apply()

    /** Custom endpoint per provider; blank means the official endpoint. */
    fun baseUrl(context: Context, provider: String): String =
        get(context).getString(KEY_BASE_URL_PREFIX + provider, "") ?: ""

    fun setBaseUrl(context: Context, provider: String, value: String) =
        get(context).edit().putString(KEY_BASE_URL_PREFIX + provider, value.trim()).apply()

    /** Optional model override per provider; blank means the engine's default. */
    fun model(context: Context, provider: String): String =
        get(context).getString(KEY_MODEL_PREFIX + provider, "") ?: ""

    fun setModel(context: Context, provider: String, value: String) =
        get(context).edit().putString(KEY_MODEL_PREFIX + provider, value.trim()).apply()

    /** Overlay window opacity, 20..100 (percent). */
    fun overlayOpacity(context: Context): Int =
        get(context).getInt(KEY_OVERLAY_OPACITY, 80).coerceIn(20, 100)

    fun setOverlayOpacity(context: Context, value: Int) =
        get(context).edit().putInt(KEY_OVERLAY_OPACITY, value.coerceIn(20, 100)).apply()

    /** Confirmed history pairs shown above the live lines; 0 hides history. */
    fun historyLines(context: Context): Int =
        get(context).getInt(KEY_HISTORY_LINES, 0).coerceIn(0, 6)

    fun setHistoryLines(context: Context, value: Int) =
        get(context).edit().putInt(KEY_HISTORY_LINES, value.coerceIn(0, 6)).apply()

    /**
     * Hotword pairs parsed from comma/newline-separated `term=weight` or bare
     * `term` entries; weight defaults to 1. Only DashScope uses them.
     */
    fun hotwords(context: Context): Map<String, String> {
        val raw = get(context).getString(KEY_HOTWORDS, "") ?: ""
        return raw.split(',', '\n', '，')
            .mapNotNull { entry ->
                val item = entry.trim()
                if (item.isEmpty()) return@mapNotNull null
                val idx = item.indexOf('=')
                if (idx > 0) item.substring(0, idx).trim() to item.substring(idx + 1).trim()
                else item to "1"
            }
            .toMap()
    }

    fun setHotwords(context: Context, value: String) =
        get(context).edit().putString(KEY_HOTWORDS, value.trim()).apply()

    /** Subtitle card background alpha, 0 (invisible) .. 90 (nearly solid). */
    fun overlayBgAlpha(context: Context): Int =
        get(context).getInt(KEY_OVERLAY_BG_ALPHA, 0).coerceIn(0, 90)

    fun setOverlayBgAlpha(context: Context, value: Int) =
        get(context).edit().putInt(KEY_OVERLAY_BG_ALPHA, value.coerceIn(0, 90)).apply()

    /** Last overlay vertical offset from the bottom edge, persisted. */
    fun overlayYOffset(context: Context): Int =
        get(context).getInt(KEY_OVERLAY_Y, 48).coerceIn(0, 2000)

    fun setOverlayYOffset(context: Context, y: Int) =
        get(context).edit().putInt(KEY_OVERLAY_Y, y.coerceIn(0, 2000)).apply()

    /** Clears a persisted drag position so the card returns to bottom-center. */
    fun clearOverlayPosition(context: Context) =
        get(context).edit().putInt(KEY_OVERLAY_Y, 48).apply()

    /** Preset translation colors, index-matched to the settings spinner. */
    val COLOR_PRESETS = listOf(0xFF4FD1C5, 0xFFFFFFFF, 0xFFFFD54F, 0xFF9AE66E, 0xFFF49AB5)

    fun translationColor(context: Context): Int {
        val index = get(context).getInt(KEY_TRANSLATION_COLOR, 0)
            .coerceIn(0, COLOR_PRESETS.size - 1)
        return COLOR_PRESETS[index].toInt()
    }

    fun translationColorIndex(context: Context): Int =
        get(context).getInt(KEY_TRANSLATION_COLOR, 0)
            .coerceIn(0, COLOR_PRESETS.size - 1)

    fun setTranslationColorIndex(context: Context, index: Int) =
        get(context).edit()
            .putInt(KEY_TRANSLATION_COLOR, index.coerceIn(0, COLOR_PRESETS.size - 1))
            .apply()

    fun sourceLang(context: Context): String =
        get(context).getString(KEY_SOURCE_LANG, "auto") ?: "auto"

    fun setSourceLang(context: Context, value: String) =
        get(context).edit().putString(KEY_SOURCE_LANG, value).apply()

    fun targetLang(context: Context): String =
        get(context).getString(KEY_TARGET_LANG, "zh") ?: "zh"

    fun setTargetLang(context: Context, value: String) =
        get(context).edit().putString(KEY_TARGET_LANG, value).apply()

    fun fontSize(context: Context): Int =
        get(context).getInt(KEY_FONT_SIZE, 16)

    fun setFontSize(context: Context, value: Int) =
        get(context).edit().putInt(KEY_FONT_SIZE, value).apply()
}
