package app.yuxino.mimi.android.provider

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

class TranslationPipelineTest {
    private class ManualDeadlines {
        data class Task(val dueNanos: Long, val action: () -> Unit, var cancelled: Boolean = false, var fired: Boolean = false)
        var nowNanos = 0L
        val tasks = mutableListOf<Task>()
        val pendingCount: Int get() = tasks.count { !it.cancelled && !it.fired }
        fun schedule(delayNanos: Long, action: () -> Unit): TranslationCall {
            check(delayNanos > 0)
            val task = Task(nowNanos + delayNanos, action)
            tasks.add(task)
            return TranslationCall { task.cancelled = true }
        }
        fun advanceTo(milliseconds: Long, fireTimers: Boolean = true) {
            nowNanos = TimeUnit.MILLISECONDS.toNanos(milliseconds)
            if (!fireTimers) return
            while (true) {
                val task = tasks.firstOrNull { !it.cancelled && !it.fired && it.dueNanos <= nowNanos } ?: break
                task.fired = true
                task.action()
            }
        }
    }
    private class FakeClient : TranslationClient {
        data class Pending(val source: String, val language: String, val callback: (TranslationResult) -> Unit, var cancelled: Boolean = false)
        val calls = mutableListOf<Pending>()
        override fun translate(text: String, sourceLanguage: String, targetLanguage: String, callback: (TranslationResult) -> Unit): TranslationCall {
            val call = Pending(text, sourceLanguage, callback)
            calls.add(call)
            return TranslationCall { call.cancelled = true }
        }
    }
    private val deadlines = ManualDeadlines()
    private val client = FakeClient()
    private val results = mutableListOf<Pair<String, String>>()
    private val errors = mutableListOf<String>()
    private val pipeline = TranslationPipeline(client, "auto", "zh", object : TranslationPipeline.Listener {
        override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) {
            assertEquals(20L, elapsedMs)
            results.add(source to translation)
        }
        override fun onError(code: String) { errors.add(code) }
    }, { deadlines.nowNanos }, deadlines::schedule)

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
        assertEquals(0, deadlines.pendingCount)
        deadlines.tasks.single().action() // Already-dispatched cancelled timers must also be harmless.
        assertTrue(errors.isEmpty())
    }

    @Test fun failureStopsTheQueueInsteadOfPairingTheNextTranslationWithTheFailedSource() {
        pipeline.submit("first")
        pipeline.submit("second")
        client.calls[0].callback(TranslationResult.Failure("translation_timeout", 20))
        client.calls[0].callback(TranslationResult.Success("late", 20))
        assertEquals(listOf("translation_timeout"), errors)
        assertEquals(1, client.calls.size)
        assertTrue(results.isEmpty())
        assertEquals(0, deadlines.pendingCount)
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
        assertEquals(0, deadlines.pendingCount)
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
        }, { deadlines.nowNanos }, deadlines::schedule)
        queue.submit("first")
        queue.submit("second")
        assertEquals(1, calls)
        assertEquals(listOf("translation_endpoint"), errors)
        assertEquals(0, deadlines.pendingCount)
    }
    @Test fun explicitSourceWinsAndAutomaticSourceNormalizesAsrAliases() {
        assertEquals("ja", translationSourceLanguage("ja", "English"))
        assertEquals("en", translationSourceLanguage("auto", "en-US"))
        assertEquals("ja", translationSourceLanguage("auto", "ja-JP"))
        assertEquals("zh", translationSourceLanguage("auto", "Chinese"))
        assertEquals("zh", translationSourceLanguage("auto", "Mandarin"))
        assertEquals("en", translationSourceLanguage("auto", "English"))
        assertEquals("ko", translationSourceLanguage("auto", "Korean"))
        for (label in listOf(null, "", "unknown provider language", "fr-FR", "x".repeat(100))) {
            assertEquals("auto", translationSourceLanguage("auto", label))
        }
        pipeline.submit("synthetic", "ja-JP")
        assertEquals("ja", client.calls.single().language)
    }

    @Test fun queueWaitingConsumesTheSameFinalDeadlineAndCancelsStalledHttp() {
        pipeline.submit("first", "en")
        deadlines.advanceTo(1_000)
        pipeline.submit("second", "ja")
        pipeline.submit("third", "en")
        deadlines.advanceTo(30_000)
        client.calls[0].callback(TranslationResult.Success("一", 20))
        assertEquals(listOf("first" to "一"), results)
        assertEquals(2, client.calls.size)
        assertTrue(deadlines.tasks[0].cancelled)
        assertEquals(TimeUnit.SECONDS.toNanos(46), deadlines.tasks[1].dueNanos)
        assertEquals(1, deadlines.pendingCount)
        deadlines.tasks[0].action() // A timer racing with cancellation cannot expire its successor.
        assertTrue(errors.isEmpty())
        deadlines.advanceTo(45_999)
        assertFalse(client.calls[1].cancelled)
        deadlines.advanceTo(46_000)
        assertTrue(client.calls[1].cancelled)
        assertEquals(listOf("translation_timeout"), errors)
        assertEquals(0, deadlines.pendingCount)
        client.calls[1].callback(TranslationResult.Success("late", 20))
        pipeline.submit("after expiry")
        assertEquals(2, client.calls.size)
        assertEquals(listOf("first" to "一"), results)
    }

    @Test fun anExpiredResponseCannotPublishEvenWhenTheDeadlineThreadHasNotRun() {
        pipeline.submit("first")
        pipeline.submit("second")
        deadlines.advanceTo(45_000, fireTimers = false)
        client.calls[0].callback(TranslationResult.Success("expired", 20))
        assertTrue(results.isEmpty())
        assertEquals(listOf("translation_timeout"), errors)
        assertTrue(client.calls[0].cancelled)
        assertEquals(0, deadlines.pendingCount)
        deadlines.tasks.single().action()
        assertEquals(listOf("translation_timeout"), errors)
        assertEquals(1, client.calls.size)
    }

    @Test fun aQueuedFinalThatExpiresDuringDeliveryNeverStartsAnotherHttpRequest() {
        val queue = TranslationPipeline(client, "en", "zh", object : TranslationPipeline.Listener {
            override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) {
                results.add(source to translation)
                // Simulate descheduling after publishing the first result but before starting its successor.
                deadlines.advanceTo(46_000, fireTimers = false)
            }
            override fun onError(code: String) { errors.add(code) }
        }, { deadlines.nowNanos }, deadlines::schedule)
        queue.submit("first")
        queue.submit("second")
        deadlines.advanceTo(44_000)
        client.calls[0].callback(TranslationResult.Success("一", 20))
        assertEquals(listOf("first" to "一"), results)
        assertEquals(listOf("translation_timeout"), errors)
        assertEquals(1, client.calls.size)
        assertEquals(0, deadlines.pendingCount)
    }

    @Test fun expiryWhileInstallingTheWatchdogDoesNotStartHttp() {
        val queue = TranslationPipeline(client, "en", "zh", object : TranslationPipeline.Listener {
            override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) { fail() }
            override fun onError(code: String) { errors.add(code) }
        }, { deadlines.nowNanos }, { delay, action ->
            deadlines.schedule(delay, action).also { deadlines.advanceTo(45_000, fireTimers = false) }
        })
        queue.submit("expired before start")
        assertTrue(client.calls.isEmpty())
        assertEquals(listOf("translation_timeout"), errors)
        assertEquals(0, deadlines.pendingCount)
    }

    @Test fun completingAllFinalsRemovesEveryDeadlineTask() {
        pipeline.submit("first")
        pipeline.submit("second")
        client.calls[0].callback(TranslationResult.Success("一", 20))
        client.calls[1].callback(TranslationResult.Success("二", 20))
        assertEquals(listOf("first" to "一", "second" to "二"), results)
        assertEquals(0, deadlines.pendingCount)
        deadlines.advanceTo(100_000)
        assertTrue(errors.isEmpty())
    }

    @Test fun stopWaitsForRequestStartupAndCancelsBeforeReturning() = assertStartupCancellation(expire = false)

    @Test fun deadlineWaitsForRequestStartupAndCancelsBeforeReturning() = assertStartupCancellation(expire = true)

    private fun assertStartupCancellation(expire: Boolean) {
        val startupEntered = CountDownLatch(1)
        val allowEnqueue = CountDownLatch(1)
        val cancellationEntered = CountDownLatch(1)
        val cancellationReturned = CountDownLatch(1)
        val startedRequests = AtomicInteger()
        val startsAfterCancellation = AtomicInteger()
        val cancelled = AtomicBoolean()
        val clock = AtomicLong()
        val deadline = AtomicReference<() -> Unit>()
        val callbackRef = AtomicReference<(TranslationResult) -> Unit>()
        val error = AtomicReference<String>()
        val delivered = AtomicInteger()
        val blockedClient = object : TranslationClient {
            override fun translate(text: String, sourceLanguage: String, targetLanguage: String, callback: (TranslationResult) -> Unit): TranslationCall {
                callbackRef.set(callback)
                // Simulate synchronous request construction before OkHttp's enqueue.
                startupEntered.countDown()
                check(allowEnqueue.await(3, TimeUnit.SECONDS))
                if (cancellationReturned.count == 0L) startsAfterCancellation.incrementAndGet()
                startedRequests.incrementAndGet()
                return TranslationCall { cancelled.set(true) }
            }
        }
        val queue = TranslationPipeline(blockedClient, "en", "zh", object : TranslationPipeline.Listener {
            override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) { delivered.incrementAndGet() }
            override fun onError(code: String) { error.set(code) }
        }, clock::get, { _, action ->
            deadline.set(action)
            TranslationCall { }
        })
        val executor = Executors.newFixedThreadPool(2)
        try {
            val submit = executor.submit { queue.submit("synthetic source") }
            assertTrue(startupEntered.await(3, TimeUnit.SECONDS))
            val stop = executor.submit {
                cancellationEntered.countDown()
                if (expire) {
                    clock.set(TimeUnit.SECONDS.toNanos(TranslationPipeline.MAX_FINAL_AGE_SECONDS))
                    deadline.get().invoke()
                } else queue.stop()
                cancellationReturned.countDown()
            }
            assertTrue(cancellationEntered.await(3, TimeUnit.SECONDS))
            // The old implementation returned here with no registered call to cancel.
            assertFalse(cancellationReturned.await(100, TimeUnit.MILLISECONDS))
            allowEnqueue.countDown()
            submit.get(3, TimeUnit.SECONDS)
            stop.get(3, TimeUnit.SECONDS)
            assertEquals(1, startedRequests.get())
            assertEquals(0, startsAfterCancellation.get())
            assertTrue(cancelled.get())
            callbackRef.get().invoke(TranslationResult.Success("late", 20))
            queue.submit("after cancellation")
            assertEquals(1, startedRequests.get())
            assertEquals(0, delivered.get())
            assertEquals(if (expire) "translation_timeout" else null, error.get())
        } finally {
            allowEnqueue.countDown()
            queue.stop()
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(3, TimeUnit.SECONDS))
        }
    }

    @Test fun synchronousFailureCleansUpWithoutHoldingTheLifecycleLock() {
        val executor = Executors.newSingleThreadExecutor()
        lateinit var queue: TranslationPipeline
        val immediateFailure = object : TranslationClient {
            override fun translate(text: String, sourceLanguage: String, targetLanguage: String, callback: (TranslationResult) -> Unit): TranslationCall {
                callback(TranslationResult.Failure("translation_endpoint", 0))
                return TranslationCall { }
            }
        }
        var deadlineCancelled = false
        queue = TranslationPipeline(immediateFailure, "en", "zh", object : TranslationPipeline.Listener {
            override fun onTranslation(source: String, language: String?, translation: String, elapsedMs: Long) { fail() }
            override fun onError(code: String) { errors.add(code) }
        }, { 0L }, { _, _ -> TranslationCall {
            // Cancellation must not keep an outer startup lock from a synchronous callback.
            executor.submit { queue.stop() }.get(3, TimeUnit.SECONDS)
            deadlineCancelled = true
        } })
        try {
            queue.submit("synthetic source")
            assertTrue(deadlineCancelled)
            assertEquals(listOf("translation_endpoint"), errors)
        } finally {
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(3, TimeUnit.SECONDS))
        }
    }

}
