package app.yuxino.mimi.android.provider

/**
 * A provider session: WebSocket streaming transcription + translation.
 *
 * The capture service pushes mono PCM16 bytes at [sampleRateHz]; the engine
 * frames, base64-encodes, and streams them. Server events surface on the bus.
 */
interface ProviderEngine {
    val sampleRateHz: Int

    /**
     * Opens the WebSocket and sends the session configuration.
     * [customBaseUrl] is an optional complete endpoint override; blank means
     * the provider's official endpoint. [customModel] overrides the model
     * query parameter; blank means the engine's default.
     */
    fun start(
        apiKey: String,
        sourceLang: String,
        targetLang: String,
        customBaseUrl: String = "",
        customModel: String = "",
    )

    /**
     * Optional vocabulary biasing, applied before [start]. Providers that do
     * not support hotwords ignore it.
     */
    fun setHotwords(words: Map<String, String>) = Unit

    /** Pushes one chunk of mono PCM16LE audio at [sampleRateHz]. */
    fun sendAudio(pcm16Mono: ByteArray)

    /** Closes the session gracefully. */
    fun stop()
}

/** Events every engine maps its wire protocol onto. */
interface EngineListener {
    fun onSessionReady()

    /** [language] is the provider's detected source language, if reported. */
    fun onSourceDraft(text: String, language: String? = null)
    fun onSourceFinal(text: String, language: String? = null)
    fun onTranslationDraft(text: String)
    fun onTranslationFinal(text: String)
    fun onError(code: String, message: String)
    fun onClosed()

    /** Connection-level progress, surfaced on the overlay status line. */
    fun onLog(message: String)
}

/** Normalizes a user-pasted base URL into a WebSocket endpoint. */
fun normalizeWebSocketUrl(url: String): String {
    val trimmed = url.trim()
    return when {
        trimmed.startsWith("wss://") || trimmed.startsWith("ws://") -> trimmed
        trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
        trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
        else -> "wss://$trimmed"
    }
}
