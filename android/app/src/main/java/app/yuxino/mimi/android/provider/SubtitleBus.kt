package app.yuxino.mimi.android.provider

/**
 * Shared subtitle state plus a simple listener registry. The capture service
 * pushes provider events here; the overlay renders the state on the main thread.
 */
object SubtitleBus {
    data class Pair(val source: String, val translation: String)

    private val listeners = mutableListOf<Listener>()
    private val lock = Any()

    @Volatile var sourceDraft: String = ""
    @Volatile var sourceFinal: String = ""
    @Volatile var translationDraft: String = ""
    @Volatile var translationFinal: String = ""
    @Volatile var statusLine: String = ""

    /** True while the live lines should stay hidden (speech paused). */
    @Volatile var liveHidden: Boolean = false

    /** Provider-detected source language of the current line, e.g. "en". */
    @Volatile var detectedSourceLanguage: String? = null

    /** Confirmed history, newest last, bounded. */
    private val history = ArrayDeque<Pair>()
    private var historyLimit = 0
    /** Queue of source finals awaiting their translation for pairing. */
    private val pendingSources = ArrayDeque<String>()

    const val MAX_HISTORY = 6
    const val MAX_PENDING = 8

    interface Listener {
        fun onSubtitleChanged()
    }

    fun addListener(listener: Listener) {
        synchronized(lock) { listeners.add(listener) }
    }

    fun removeListener(listener: Listener) {
        synchronized(lock) { listeners.remove(listener) }
    }

    private fun notifyListeners() {
        val snapshot = synchronized(lock) { listeners.toList() }
        for (listener in snapshot) {
            try {
                listener.onSubtitleChanged()
            } catch (_: Exception) {
            }
        }
    }

    fun onSourceDraft(text: String, language: String? = null) {
        val trimmed = lastSentence(text)
        if (trimmed.isBlank()) return
        sourceDraft = trimmed
        detectedSourceLanguage = normalizeLang(language) ?: detectedSourceLanguage
        liveHidden = false
        notifyListeners()
    }

    fun onSourceFinal(text: String, language: String? = null) {
        val trimmed = lastSentence(text)
        if (trimmed.isBlank()) return
        sourceFinal = trimmed
        sourceDraft = ""
        detectedSourceLanguage = normalizeLang(language) ?: detectedSourceLanguage
        liveHidden = false
        synchronized(this) {
            if (historyLimit > 0) {
                if (pendingSources.size >= MAX_PENDING) pendingSources.removeFirst()
                pendingSources.addLast(trimmed)
            }
        }
        notifyListeners()
    }

    fun onTranslationDraft(text: String) {
        val trimmed = lastSentence(text)
        if (trimmed.isBlank() && translationFinal.isNotEmpty()) return
        translationDraft = trimmed
        liveHidden = false
        notifyListeners()
    }

    fun onTranslationFinal(text: String) {
        val trimmed = lastSentence(text)
        if (trimmed.isBlank()) return
        translationFinal = trimmed
        translationDraft = ""
        liveHidden = false
        synchronized(this) {
            if (historyLimit > 0) {
                val source = pendingSources.removeFirstOrNull() ?: sourceFinal
                if (history.size >= historyLimit) history.removeFirst()
                history.addLast(Pair(source, trimmed))
            }
        }
        notifyListeners()
    }

    fun setHistoryLimit(limit: Int) {
        synchronized(this) {
            historyLimit = limit.coerceIn(0, MAX_HISTORY)
            while (history.size > historyLimit) history.removeFirst()
            if (historyLimit == 0) pendingSources.clear()
        }
        notifyListeners()
    }

    fun historySnapshot(): List<Pair> = synchronized(this) { history.toList() }

    fun onStatus(line: String) {
        statusLine = line
        notifyListeners()
    }

    /** Hides the live lines until the next subtitle event. */
    fun hideLive() {
        liveHidden = true
        notifyListeners()
    }

    private fun normalizeLang(language: String?): String? {
        val value = language?.trim()?.lowercase()?.takeWhile { it.isLetterOrNull() }
        return value?.takeIf { it.length in 2..8 }
    }

    private fun Char.isLetterOrNull(): Boolean = isLetter()

    private val SENTENCE_DELIMITERS = charArrayOf('.', '!', '?', '。', '！', '？', '，', ',')

    /**
     * Streams and finals both accumulate full utterances on the wire; only the
     * last sentence is ever displayed. Handles the paused case (text ends with
     * a delimiter: return the last complete sentence) so a finished sentence
     * never lets the whole buffer through.
     */
    private fun lastSentence(input: String): String {
        val text = input.trim()
        var effectiveEnd = text.length
        while (effectiveEnd > 0 && text[effectiveEnd - 1] in SENTENCE_DELIMITERS) {
            effectiveEnd--
        }
        if (effectiveEnd == 0) return ""
        var last = -1
        for (delimiter in SENTENCE_DELIMITERS) {
            val index = text.lastIndexOf(delimiter, effectiveEnd - 1)
            if (index > last) last = index
        }
        val tail = if (last >= 0) {
            text.substring(last + 1, effectiveEnd)
        } else {
            text.substring(0, effectiveEnd)
        }
        return tail.trim().takeLast(200)
    }

    fun clear() {
        synchronized(this) {
            sourceDraft = ""; sourceFinal = ""; translationDraft = ""; translationFinal = ""
            statusLine = ""
            detectedSourceLanguage = null
            liveHidden = false
            history.clear()
            pendingSources.clear()
        }
        notifyListeners()
    }
}
