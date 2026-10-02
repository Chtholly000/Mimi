package app.yuxino.mimi.android.provider

import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Real HTTP on loopback, using synthetic text only; no provider credentials or upstream calls. */
class OpenAITranslationClientTest {
    private val validResponse = """{"choices":[{"finish_reason":"stop","message":{"content":"<think>synthetic reasoning</think>你好。"}}]}"""

    private class Exchange(private val socket: Socket) : AutoCloseable {
        val requestMethod: String
        val requestPath: String
        val requestHeaders = mutableMapOf<String, String>()
        val responseHeaders = mutableMapOf<String, String>()
        val requestBody: ByteArrayInputStream

        init {
            socket.soTimeout = 3_000
            val input = DataInputStream(socket.getInputStream())
            fun line(): String {
                val bytes = ByteArrayOutputStream()
                while (true) {
                    val value = input.read()
                    check(value >= 0) { "Unexpected request EOF" }
                    if (value == 10) return bytes.toString("US-ASCII").removeSuffix("\r")
                    check(bytes.size() < 8_192) { "Oversized request header" }
                    bytes.write(value)
                }
            }
            val requestLine = line().split(' ')
            check(requestLine.size == 3)
            requestMethod = requestLine[0]
            requestPath = requestLine[1]
            while (true) {
                val header = line()
                if (header.isEmpty()) break
                check(requestHeaders.size < 100) { "Too many request headers" }
                val separator = header.indexOf(':')
                check(separator > 0)
                requestHeaders[header.substring(0, separator).lowercase()] = header.substring(separator + 1).trim()
            }
            val length = requestHeaders["content-length"]?.toIntOrNull() ?: 0
            check(length in 0..65_536) { "Unexpected request length" }
            val body = ByteArray(length)
            input.readFully(body)
            requestBody = ByteArrayInputStream(body)
        }

        fun reply(code: Int, body: String) {
            val bytes = body.toByteArray(Charsets.UTF_8)
            val header = buildString {
                append("HTTP/1.1 $code Response\r\n")
                append("Content-Type: application/json\r\n")
                append("Content-Length: ${bytes.size}\r\n")
                append("Connection: close\r\n")
                responseHeaders.forEach { (name, value) -> append("$name: $value\r\n") }
                append("\r\n")
            }
            socket.getOutputStream().apply {
                write(header.toByteArray(Charsets.US_ASCII))
                write(bytes)
                flush()
            }
            close()
        }

        override fun close() { socket.close() }
    }

    private class Fixture(handler: (Exchange) -> Unit) : AutoCloseable {
        private val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        private val failure = AtomicReference<Throwable>()
        @Volatile private var running = true
        @Volatile private var connection: Socket? = null
        val endpoint = "http://127.0.0.1:${server.localPort}/v1"
        private val worker = Thread({
            try {
                while (running) {
                    val socket = server.accept()
                    connection = socket
                    socket.use { Exchange(it).use(handler) }
                    connection = null
                }
            } catch (error: Throwable) {
                // Closing a connection after cancellation, timeout or size rejection is expected.
                if (running && error !is IOException) failure.set(error)
            }
        }, "chatmock-http-fixture").apply { isDaemon = true; start() }

        override fun close() {
            running = false
            server.close()
            connection?.close()
            worker.interrupt()
            worker.join(4_000)
            check(!worker.isAlive) { "HTTP fixture did not stop" }
            failure.get()?.let { throw AssertionError("HTTP fixture failed", it) }
        }
    }

    private fun await(start: ((TranslationResult) -> Unit) -> TranslationCall): TranslationResult {
        val latch = CountDownLatch(1)
        val result = AtomicReference<TranslationResult>()
        start { result.set(it); latch.countDown() }
        assertTrue("HTTP request did not finish", latch.await(5, TimeUnit.SECONDS))
        return result.get()
    }

    @Test fun connectionCheckMakesTheActualTranslationRequestAndMeasuresItsDuration() {
        val method = AtomicReference<String>()
        val path = AtomicReference<String>()
        val auth = AtomicReference<String>()
        val payload = AtomicReference<JSONObject>()
        Fixture { exchange ->
            method.set(exchange.requestMethod)
            path.set(exchange.requestPath)
            auth.set(exchange.requestHeaders["authorization"])
            payload.set(JSONObject(exchange.requestBody.bufferedReader().readText()))
            Thread.sleep(25)
            exchange.reply(200, validResponse)
        }.use { fixture ->
            val client = OpenAITranslationClient(TranslationConfiguration(fixture.endpoint, "fixture-model", allowLocalHttp = true))
            val result = await(client::check) as TranslationResult.Success
            assertEquals("POST", method.get())
            assertEquals("/v1/chat/completions", path.get())
            assertNull(auth.get())
            assertEquals("fixture-model", payload.get().getString("model"))
            assertFalse(payload.get().getBoolean("stream"))
            assertEquals("Hello.", payload.get().getJSONArray("messages").getJSONObject(1).getString("content"))
            assertEquals("你好。", result.text)
            assertTrue(result.elapsedMs >= 20)
        }
    }

    @Test fun optionalProxyKeyIsOnlySentToTheConfiguredDestinationAndRedirectsAreRejected() {
        val count = AtomicInteger()
        val auth = AtomicReference<String>()
        Fixture { exchange ->
            count.incrementAndGet()
            auth.set(exchange.requestHeaders["authorization"])
            exchange.responseHeaders["Location"] = "/redirected"
            exchange.reply(302, "private provider error")
        }.use { fixture ->
            // Even an injected client's permissive defaults cannot enable redirects.
            val client = OpenAITranslationClient(TranslationConfiguration(fixture.endpoint, "fixture-model", "proxy-key", true), OkHttpClient())
            val result = await(client::check) as TranslationResult.Failure
            assertEquals("translation_http_302", result.code)
            assertEquals("Bearer proxy-key", auth.get())
            assertEquals(1, count.get())
            assertFalse(result.toString().contains("private provider error"))
        }
    }

    @Test fun providerErrorsAndMalformedResponsesAreContentFree() {
        for ((code, body, expected) in listOf(
            Triple(401, "private credentials and text", "translation_http_401"),
            Triple(200, "private invalid JSON text", "translation_response"),
            Triple(200, "x".repeat(MAX_TRANSLATION_RESPONSE_BYTES.toInt() + 1), "translation_too_large"),
        )) {
            Fixture { it.reply(code, body) }.use { fixture ->
                val client = OpenAITranslationClient(TranslationConfiguration(fixture.endpoint, "fixture-model", allowLocalHttp = true))
                val result = await(client::check) as TranslationResult.Failure
                assertEquals(expected, result.code)
                assertFalse(result.toString().contains("private"))
            }
        }
    }

    @Test fun cancellationSuppressesAResponseAlreadyInFlight() {
        val requestSeen = CountDownLatch(1)
        val releaseResponse = CountDownLatch(1)
        val callbacks = AtomicInteger()
        Fixture { exchange ->
            requestSeen.countDown()
            releaseResponse.await(3, TimeUnit.SECONDS)
            try { exchange.reply(200, validResponse) } catch (_: java.io.IOException) { exchange.close() }
        }.use { fixture ->
            val transport = OkHttpClient()
            val client = OpenAITranslationClient(TranslationConfiguration(fixture.endpoint, "fixture-model", allowLocalHttp = true), transport)
            val call = client.check { callbacks.incrementAndGet() }
            assertTrue(requestSeen.await(3, TimeUnit.SECONDS))
            call.cancel()
            releaseResponse.countDown()
            val idle = CountDownLatch(1)
            transport.dispatcher.idleCallback = Runnable { idle.countDown() }
            if (transport.dispatcher.runningCallsCount() > 0) assertTrue(idle.await(3, TimeUnit.SECONDS))
            assertEquals(0, callbacks.get())
        }
    }

    @Test fun timeoutTerminatesTheRequestWithASafeFailure() {
        val releaseResponse = CountDownLatch(1)
        Fixture { exchange ->
            releaseResponse.await(3, TimeUnit.SECONDS)
            try { exchange.reply(200, validResponse) } catch (_: java.io.IOException) { exchange.close() }
        }.use { fixture ->
            val transport = OkHttpClient.Builder().callTimeout(100, TimeUnit.MILLISECONDS).build()
            val client = OpenAITranslationClient(TranslationConfiguration(fixture.endpoint, "fixture-model", allowLocalHttp = true), transport)
            val result = await(client::check) as TranslationResult.Failure
            releaseResponse.countDown()
            assertEquals("translation_timeout", result.code)
            assertTrue(result.elapsedMs >= 50)
        }
    }
}
