package app.yuxino.mimi.android.provider

import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Serial final translations with explicit source pairing and a small bounded waiting queue. */
class TranslationPipeline(
    private val client: TranslationClient,
    private val sourceLanguage: String,
    private val targetLanguage: String,
    private val listener: Listener,
    private val nanoTime: () -> Long = System::nanoTime,
    private val scheduleDeadline: (Long, () -> Unit) -> TranslationCall = ::scheduleTranslationDeadline,
) {
    interface Listener {
        fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long)
        fun onError(code: String)
    }

    private class Entry(val text: String, val language: String?, val enqueuedAtNanos: Long)
    private val lock = Any()
    private val pending = ArrayDeque<Entry>()
    private var active: Entry? = null
    private var activeCall: TranslationCall? = null
    private var activeDeadline: TranslationCall? = null
    private var stopped = false

    fun submit(text: String, language: String? = null) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        var callToCancel: TranslationCall? = null
        var deadlineToCancel: TranslationCall? = null
        val next = synchronized(lock) {
            if (stopped) return
            if (trimmed.length > MAX_TRANSLATION_TEXT_CHARS || pending.size >= MAX_PENDING_TRANSLATIONS) {
                stopped = true
                pending.clear()
                active = null
                callToCancel = activeCall
                activeCall = null
                deadlineToCancel = activeDeadline
                activeDeadline = null
                listener.onError(if (trimmed.length > MAX_TRANSLATION_TEXT_CHARS) "translation_too_large" else "translation_queue_full")
                null
            } else {
                pending.addLast(Entry(trimmed, language, nanoTime()))
                takeNext()
            }
        }
        deadlineToCancel?.cancel()
        callToCancel?.cancel()
        next?.let(::launch)
    }

    fun stop() {
        val cancellations = synchronized(lock) {
            stopped = true
            pending.clear()
            active = null
            (activeCall to activeDeadline).also {
                activeCall = null
                activeDeadline = null
            }
        }
        cancellations.second?.cancel()
        cancellations.first?.cancel()
    }

    /** Call only under lock; reserving an entry prevents concurrent submissions starting another request. */
    private fun takeNext(): Entry? {
        if (stopped || active != null || pending.isEmpty()) return null
        return pending.removeFirst().also { active = it }
    }

    private fun remainingNanos(entry: Entry): Long =
        TimeUnit.SECONDS.toNanos(MAX_FINAL_AGE_SECONDS) - (nanoTime() - entry.enqueuedAtNanos)

    private fun expire(entry: Entry) {
        val cancellations = synchronized(lock) {
            if (stopped || active !== entry) return
            stopped = true
            pending.clear()
            active = null
            val owned = activeCall to activeDeadline
            activeCall = null
            activeDeadline = null
            listener.onError("translation_timeout")
            owned
        }
        // Never acquire the HTTP client's callback lock while holding the pipeline lock.
        cancellations.second?.cancel()
        cancellations.first?.cancel()
    }

    private fun launch(entry: Entry) {
        val remaining = synchronized(lock) {
            if (stopped || active !== entry) return
            remainingNanos(entry)
        }
        if (remaining <= 0) {
            expire(entry)
            return
        }
        // Waiting time belongs to the same final budget; starting HTTP never resets it.
        val deadline = scheduleDeadline(remaining) { expire(entry) }
        val ownsDeadline = synchronized(lock) {
            if (stopped || active !== entry) false else {
                activeDeadline = deadline
                true
            }
        }
        if (!ownsDeadline) {
            deadline.cancel()
            return
        }
        // HTTP construction/enqueue and handle installation share the lifecycle lock.
        // stop()/expire() cannot return while a request is still about to be enqueued.
        // Validation can call back synchronously: defer that result until installation
        // completes so its cleanup never cancels a transport while holding this lock.
        var installingCall = true
        var callbackClaimed = false
        var immediateResult: TranslationResult? = null
        val started = synchronized(lock) {
            if (stopped || active !== entry) return
            if (remainingNanos(entry) <= 0) false else {
                activeCall = client.translate(entry.text, translationSourceLanguage(sourceLanguage, entry.language), targetLanguage) { result ->
                    val deferred = synchronized(lock) {
                        if (callbackClaimed) return@translate
                        callbackClaimed = true
                        if (installingCall) {
                            immediateResult = result
                            true
                        } else false
                    }
                    if (!deferred) complete(entry, result)
                }
                installingCall = false
                true
            }
        }
        if (!started) expire(entry)
        else immediateResult?.let { complete(entry, it) }
    }

    private fun complete(entry: Entry, result: TranslationResult) {
        var deadlineToCancel: TranslationCall? = null
        var callToCancel: TranslationCall? = null
        val next = synchronized(lock) {
            if (stopped || active !== entry) return
            // A delayed timer must not allow an already-expired response to become a subtitle.
            val expired = remainingNanos(entry) <= 0
            if (expired) callToCancel = activeCall
            active = null
            activeCall = null
            deadlineToCancel = activeDeadline
            activeDeadline = null
            if (expired) {
                stopped = true
                pending.clear()
                listener.onError("translation_timeout")
            } else when (result) {
                is TranslationResult.Success -> listener.onTranslation(entry.text, entry.language, result.text, result.elapsedMs)
                is TranslationResult.Failure -> {
                    stopped = true
                    pending.clear()
                    listener.onError(result.code)
                }
            }
            takeNext()
        }
        deadlineToCancel?.cancel()
        callToCancel?.cancel()
        next?.let(::launch)
    }

    companion object {
        const val MAX_PENDING_TRANSLATIONS = 4
        const val MAX_FINAL_AGE_SECONDS = 45L
    }
}

/** One daemon for active finals; cancellation removes its queued task and captured source immediately. */
private object TranslationDeadlines {
    val executor = ScheduledThreadPoolExecutor(1) { task ->
        Thread(task, "mimi-translation-deadline").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
}

private fun scheduleTranslationDeadline(delayNanos: Long, action: () -> Unit): TranslationCall {
    val task = TranslationDeadlines.executor.schedule(Runnable { action() }, delayNanos, TimeUnit.NANOSECONDS)
    return TranslationCall { task.cancel(false) }
}

/** Explicit user choices are authoritative; ASR aliases only refine automatic recognition. */
internal fun translationSourceLanguage(configured: String, reported: String?): String {
    if (configured != "auto") return configured
    val normalized = reported?.takeIf { it.length <= 64 }?.trim()?.lowercase() ?: return "auto"
    val code = when (normalized) {
        "chinese", "mandarin" -> "zh"
        "english" -> "en"
        "japanese" -> "ja"
        "korean" -> "ko"
        else -> normalized.substringBefore('-')
    }
    return code.takeIf { it in setOf("zh", "en", "ja", "ko") } ?: "auto"
}
