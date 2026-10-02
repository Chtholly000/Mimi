package app.yuxino.mimi.android.provider

import org.junit.Assert.*
import org.junit.Test

class TranslationPipelineTest {
    private class FakeClient : TranslationClient {
        data class Pending(val source: String, val language: String, val callback: (TranslationResult) -> Unit, var cancelled: Boolean = false)
        val calls = mutableListOf<Pending>()
        override fun translate(text: String, sourceLanguage: String, targetLanguage: String, callback: (TranslationResult) -> Unit): TranslationCall {
            val call = Pending(text, sourceLanguage, callback)
            calls.add(call)
            return TranslationCall { call.cancelled = true }
        }
    }
    private val client = FakeClient()
    private val results = mutableListOf<Pair<String, String>>()
    private val errors = mutableListOf<String>()
    private val pipeline = TranslationPipeline(client, "auto", "zh", object : TranslationPipeline.Listener {
        override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) {
            assertEquals(20L, elapsedMs)
            results.add(source to translation)
        }
        override fun onError(code: String) { errors.add(code) }
    })

    @Test fun finalRequestsAreSerialAndPairedWithTheirOwnSource() {
        pipeline.submit("first", "en")
        pipeline.submit("second", "ja")
        assertEquals(1, client.calls.size)
        assertEquals("en", client.calls[0].language)
        client.calls[0].callback(TranslationResult.Success("一", 20))
        assertEquals(listOf("first" to "一"), results)
        assertEquals(2, client.calls.size)
        assertEquals("ja", client.calls[1].language)
        // A duplicated/out-of-order old response must never consume the next source.
        client.calls[0].callback(TranslationResult.Success("wrong", 20))
        client.calls[1].callback(TranslationResult.Success("二", 20))
        assertEquals(listOf("first" to "一", "second" to "二"), results)
    }

    @Test fun stopCancelsActiveWorkAndRejectsLateCompletions() {
        pipeline.submit("first")
        pipeline.submit("second")
        pipeline.stop()
        assertTrue(client.calls[0].cancelled)
        client.calls[0].callback(TranslationResult.Success("late", 20))
        pipeline.submit("third")
        assertTrue(results.isEmpty())
        assertEquals(1, client.calls.size)
    }

    @Test fun failureStopsTheQueueInsteadOfPairingTheNextTranslationWithTheFailedSource() {
        pipeline.submit("first")
        pipeline.submit("second")
        client.calls[0].callback(TranslationResult.Failure("translation_timeout", 20))
        client.calls[0].callback(TranslationResult.Success("late", 20))
        assertEquals(listOf("translation_timeout"), errors)
        assertEquals(1, client.calls.size)
        assertTrue(results.isEmpty())
    }

    @Test fun overflowIsExplicitAndCancelsExistingWork() {
        pipeline.submit("active")
        repeat(TranslationPipeline.MAX_PENDING_TRANSLATIONS) { pipeline.submit("pending $it") }
        pipeline.submit("overflow")
        assertEquals(listOf("translation_queue_full"), errors)
        assertTrue(client.calls[0].cancelled)
        client.calls[0].callback(TranslationResult.Success("late", 20))
        assertEquals(1, client.calls.size)
        assertTrue(results.isEmpty())
    }

    @Test fun blankFinalsAreIgnoredAndOversizedFinalsFailWithoutANetworkRequest() {
        pipeline.submit("  ")
        pipeline.submit("x".repeat(MAX_TRANSLATION_TEXT_CHARS + 1))
        assertTrue(client.calls.isEmpty())
        assertEquals(listOf("translation_too_large"), errors)
    }

    @Test fun synchronousValidationFailureDoesNotLeaveAnActiveSlotOrStartMoreWork() {
        var calls = 0
        val immediate = object : TranslationClient {
            override fun translate(text: String, sourceLanguage: String, targetLanguage: String, callback: (TranslationResult) -> Unit): TranslationCall {
                calls++
                callback(TranslationResult.Failure("translation_endpoint", 0))
                return TranslationCall { }
            }
        }
        val queue = TranslationPipeline(immediate, "en", "zh", object : TranslationPipeline.Listener {
            override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) { fail() }
            override fun onError(code: String) { errors.add(code) }
        })
        queue.submit("first")
        queue.submit("second")
        assertEquals(1, calls)
        assertEquals(listOf("translation_endpoint"), errors)
    }
}
