package app.yuxino.mimi.android.provider

/** Pure metadata shared by setup, language selection and session creation. */
data class CredentialField(val id: String, val label: String, val secret: Boolean = true)

enum class ServiceProvider(
    val id: String, val title: String, val description: String, val sampleRate: Int,
    val sources: List<String>, val fields: List<CredentialField>,
    val endpoint: String = "", val model: String = "",
) {
    DASHSCOPE("dashscope", "阿里云", "通义实时翻译", 16000, listOf("auto", "zh", "en", "ja", "ko"),
        listOf(CredentialField("apiKey", "API Key")), DashScopeEngine.DASHSCOPE_REALTIME_WS, DashScopeEngine.MODEL),
    OPENAI("openai", "OpenAI", "Realtime Translation", 24000, listOf("auto"),
        listOf(CredentialField("apiKey", "API Key")), OpenAIRealtimeEngine.ENDPOINT, OpenAIRealtimeEngine.MODEL),
    GEMINI("gemini", "Google Gemini", "Live Translation", 16000, listOf("auto"),
        listOf(CredentialField("apiKey", "API Key")),
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent", "gemini-3.5-live-translate-preview"),
    AZURE("azure", "Azure OpenAI", "使用自己的 Azure 部署", 24000, listOf("auto"),
        listOf(CredentialField("endpoint", "资源地址", false), CredentialField("deployment", "翻译部署名称", false),
            CredentialField("transcriptionDeployment", "转写部署名称", false), CredentialField("apiKey", "API Key"))),
    VOLCANO("volcano", "火山引擎", "豆包同声传译 2.0", 16000, listOf("ja", "en", "zh"),
        listOf(CredentialField("apiKey", "API Key"))),
    TENCENT("tencent", "腾讯云", "实时语音翻译", 16000, listOf("ja", "en", "ko", "zh"),
        listOf(CredentialField("appId", "AppID", false), CredentialField("secretId", "SecretID"), CredentialField("secretKey", "SecretKey"))),
    BAIDU("baidu", "百度翻译", "实时语音翻译", 16000, listOf("ja", "en", "ko", "zh"),
        listOf(CredentialField("appId", "AppID", false), CredentialField("appKey", "AppKey"))),
    XAI("xai", "xAI Grok", "Grok Voice · 按语音轮次翻译", 24000, listOf("auto", "zh", "en", "ja", "ko", "vi", "id", "hi", "fr", "de", "ru", "it"),
        listOf(CredentialField("apiKey", "API Key")), "wss://api.x.ai/v1/realtime", "grok-voice-latest");

    val targets: List<String> get() = when (this) {
        OPENAI -> listOf("zh", "en", "ja", "ko", "ru", "es", "fr", "pt", "de", "it", "vi", "id", "hi")
        GEMINI -> listOf("zh", "en", "ja", "zh_tw", "ko", "ru", "es", "fr", "de", "it", "th", "vi", "id", "ms", "ar", "hi", "he", "ur", "bn", "pl", "nl", "tr", "km", "cs", "sv", "hu", "da", "fi", "tl", "fa")
        else -> listOf("zh", "en", "ja")
    }
    val hasAdvanced: Boolean get() = endpoint.isNotEmpty()
    // Independent text translation is currently available only with DashScope ASR.
    // Other speech providers keep their own model's translation catalog.
    fun targetsForTranslation(translation: TextTranslationProvider): List<String> =
        if (this == DASHSCOPE && translation.usesOpenAIProtocol) OPENAI_COMPATIBLE_TARGET_LANGUAGE_NAMES.keys.toList()
        else targets

    fun normalize(source: String, target: String, translation: TextTranslationProvider = TextTranslationProvider.BUILTIN): Pair<String, String> {
        val targets = targetsForTranslation(translation)
        val normalizedSource = source.takeIf { it in sources }
            ?: sources.firstOrNull { it != target } ?: sources.first()
        val normalizedTarget = target.takeIf { it in targets && it != normalizedSource }
            ?: targets.first { it != normalizedSource }
        return normalizedSource to normalizedTarget
    }
    fun configured(values: Map<String, String>): Boolean = fields.all { !values[it.id].isNullOrBlank() }
    companion object {
        fun fromId(id: String): ServiceProvider = entries.firstOrNull { it.id == id } ?: DASHSCOPE
    }
}

/** Never use a data class: generated toString must not expose credentials. */
class ServiceConfiguration(val provider: ServiceProvider, val credentials: Map<String, String>,
    val endpoint: String = "", val model: String = "") {
    fun value(field: String): String = credentials[field].orEmpty()
    override fun toString(): String = "ServiceConfiguration(${provider.id}, redacted)"
}
