package app.yuxino.mimi.android.provider

import android.util.Base64
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * OpenAI Realtime Translation endpoint (gpt-realtime-translate).
 *
 * Wire protocol mirrors mimi's src-tauri/src/core/protocols/openai_realtime.rs:
 *   up   session.update { session.audio.input.transcription.model = gpt-realtime-whisper,
 *                         session.audio.output.language = zh|en|ja }
 *   up   session.input_audio_buffer.append { audio: base64(pcm16le mono 24k, 200 ms frames) }
 *   up   session.close
 *   down session.created/updated/closed,
 *        session.input_transcript.delta, session.output_transcript.delta,
 *        session.output_audio.delta (ignored), error
 *
 * mimi aligns the two append-only delta streams with per-boundary timing; this
 * implementation commits on sentence delimiters, which keeps the visible
 * behaviour (draft grows, final lands at a sentence end).
 */
class OpenAIRealtimeEngine(private val listener: EngineListener) : ProviderEngine {
    override val sampleRateHz: Int = 24_000

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private val sessionReady = AtomicBoolean(false)
    private val stopped = AtomicBoolean(false)
    private val audioBuffer = java.io.ByteArrayOutputStream()

    private var sourceLang: String = "auto"
    private var targetLang: String = "zh"
    private var model: String = MODEL

    private var sourceText = StringBuilder()
    private var translationText = StringBuilder()

    override fun start(
        apiKey: String,
        sourceLang: String,
        targetLang: String,
        customBaseUrl: String,
        customModel: String,
    ) {
        this.sourceLang = sourceLang
        this.targetLang = targetLang
        model = customModel.trim().ifEmpty { MODEL }
        val request = Request.Builder()
            .url(resolveEndpoint(customBaseUrl))
            .header("Authorization", "Bearer $apiKey")
            .build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                listener.onLog("已连接 OpenAI，正在配置会话…")
                ws.send(buildSessionUpdate().toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleServerEvent(JSONObject(text))
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (stopped.get()) return
                Log.w(TAG, "ws failure", t)
                listener.onError(
                    "transport_error",
                    "连接失败: ${t.message ?: "OpenAI connection failed"}",
                )
                sessionReady.set(false)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                listener.onLog("连接已关闭 ($code)")
                sessionReady.set(false)
                listener.onClosed()
            }
        })
    }

    override fun sendAudio(pcm16Mono: ByteArray) {
        if (!sessionReady.get()) return
        synchronized(audioBuffer) {
            audioBuffer.write(pcm16Mono)
            val data = audioBuffer.toByteArray()
            val frameBytes = 9_600 // 200 ms of 24 kHz mono PCM16
            var offset = 0
            while (offset + frameBytes <= data.size) {
                val frame = data.copyOfRange(offset, offset + frameBytes)
                webSocket?.send(encodeAudioAppend(frame).toString())
                offset += frameBytes
            }
            if (offset > 0) {
                audioBuffer.reset()
                audioBuffer.write(data, offset, data.size - offset)
            }
        }
    }

    override fun stop() {
        stopped.set(true)
        try {
            webSocket?.send(JSONObject().put("type", "session.close").toString())
            webSocket?.close(1000, "bye")
        } catch (_: Exception) {
        }
        sessionReady.set(false)
    }

    private fun resolveEndpoint(customBaseUrl: String): String {
        val custom = normalizeWebSocketUrl(customBaseUrl)
        val base = if (customBaseUrl.isBlank()) ENDPOINT else custom
        return if (base.contains("?")) {
            if (base.contains("model=")) base else "$base&model=$model"
        } else {
            "$base?model=$model"
        }
    }

    private fun buildSessionUpdate(): JSONObject {
        val input = JSONObject()
            .put("transcription", JSONObject().put("model", SOURCE_TRANSCRIPTION_MODEL))
        val output = JSONObject().put("language", targetLang)
        val audio = JSONObject().put("input", input).put("output", output)
        val session = JSONObject().put("audio", audio)
        return JSONObject()
            .put("type", "session.update")
            .put("session", session)
    }

    private fun encodeAudioAppend(pcm: ByteArray): JSONObject {
        val audio = Base64.encodeToString(pcm, Base64.NO_WRAP)
        return JSONObject()
            .put("type", "session.input_audio_buffer.append")
            .put("audio", audio)
    }

    private fun handleServerEvent(json: JSONObject) {
        when (json.optString("type")) {
            "session.created" -> Unit
            "session.updated" -> {
                sessionReady.set(true)
                listener.onSessionReady()
            }
            "session.closed" -> {
                sessionReady.set(false)
                listener.onClosed()
            }
            "session.input_transcript.delta" -> {
                sourceText.append(json.optString("delta"))
                commitAtBoundary(sourceText)?.let { committed ->
                    listener.onSourceFinal(committed)
                } ?: listener.onSourceDraft(sourceText.toString())
            }
            "session.output_transcript.delta" -> {
                translationText.append(json.optString("delta"))
                commitAtBoundary(translationText)?.let { committed ->
                    listener.onTranslationFinal(committed)
                } ?: listener.onTranslationDraft(translationText.toString())
            }
            "session.output_audio.delta" -> Unit
            "error" -> {
                val error = json.optJSONObject("error")
                listener.onError(
                    error?.optString("code") ?: "provider_error",
                    error?.optString("message") ?: "OpenAI returned an unknown error.",
                )
            }
        }
    }

    /** Splits the buffer at the last sentence delimiter, returning the committed prefix. */
    private fun commitAtBoundary(buffer: StringBuilder): String? {
        val text = buffer.toString()
        var last = -1
        for (delimiter in SENTENCE_DELIMITERS) {
            val index = text.lastIndexOf(delimiter)
            if (index > last) last = index
        }
        if (last < 0) return null
        val committed = text.substring(0, last + 1).trim()
        val rest = text.substring(last + 1)
        buffer.setLength(0)
        buffer.append(rest)
        return committed.ifBlank { null }
    }

    companion object {
        private const val TAG = "OpenAIRealtimeEngine"
        const val ENDPOINT = "wss://api.openai.com/v1/realtime/translations"
        const val MODEL = "gpt-realtime-translate"
        const val SOURCE_TRANSCRIPTION_MODEL = "gpt-realtime-whisper"
        private val SENTENCE_DELIMITERS = charArrayOf('.', '!', '?', '。', '！', '？', '\n')
    }
}
