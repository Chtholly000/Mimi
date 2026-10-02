package app.yuxino.mimi.android.provider

/** Serial final translations with explicit source pairing and a small bounded waiting queue. */
class TranslationPipeline(
    private val client: TranslationClient,
    private val sourceLanguage: String,
    private val targetLanguage: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long)
        fun onError(code: String)
    }

    private class Entry(val text: String, val language: String?)
    private val lock = Any()
    private val pending = ArrayDeque<Entry>()
    private var active: Entry? = null
    private var activeCall: TranslationCall? = null
    private var stopped = false

    fun submit(text: String, language: String? = null) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        var callToCancel: TranslationCall? = null
        val next = synchronized(lock) {
            if (stopped) return
            if (trimmed.length > MAX_TRANSLATION_TEXT_CHARS || pending.size >= MAX_PENDING_TRANSLATIONS) {
                stopped = true
                pending.clear()
                active = null
                callToCancel = activeCall
                activeCall = null
                listener.onError(if (trimmed.length > MAX_TRANSLATION_TEXT_CHARS) "translation_too_large" else "translation_queue_full")
                null
            } else {
                pending.addLast(Entry(trimmed, language))
                takeNext()
            }
        }
        callToCancel?.cancel()
        next?.let(::launch)
    }

    fun stop() {
        val call = synchronized(lock) {
            stopped = true
            pending.clear()
            active = null
            activeCall.also { activeCall = null }
        }
        call?.cancel()
    }

    /** Call only under lock; reserving an entry prevents concurrent submissions starting another request. */
    private fun takeNext(): Entry? {
        if (stopped || active != null || pending.isEmpty()) return null
        return pending.removeFirst().also { active = it }
    }

    private fun launch(entry: Entry) {
        synchronized(lock) { if (stopped || active !== entry) return }
        val call = client.translate(entry.text, entry.language ?: sourceLanguage, targetLanguage) { result ->
            val next = synchronized(lock) {
                if (stopped || active !== entry) return@translate
                active = null
                activeCall = null
                when (result) {
                    is TranslationResult.Success -> listener.onTranslation(entry.text, entry.language, result.text, result.elapsedMs)
                    is TranslationResult.Failure -> {
                        stopped = true
                        pending.clear()
                        listener.onError(result.code)
                    }
                }
                takeNext()
            }
            next?.let(::launch)
        }
        val cancel = synchronized(lock) {
            if (stopped || active !== entry) true else {
                activeCall = call
                false
            }
        }
        if (cancel) call.cancel()
    }

    companion object {
        const val MAX_PENDING_TRANSLATIONS = 4
    }
}
