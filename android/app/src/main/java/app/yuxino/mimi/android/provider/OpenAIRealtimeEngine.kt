package app.yuxino.mimi.android.provider

import android.util.Base64
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.json.JSONException
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
        .followRedirects(false)
        .followSslRedirects(false)
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

    private val sourceText = TranscriptBuffer()
    private val translationText = TranscriptBuffer()

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
            .url(resolveEndpoint(customBaseUrl).also { require(it.startsWith("wss://")) { "speech_https_required" } })
            .header("Authorization", "Bearer $apiKey")
            .build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                listener.onLog("已连接 OpenAI，正在配置会话…")
                ws.send(buildSessionUpdate().toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                receiveServerMessage(text)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (stopped.get()) return
                Log.w(TAG, "WebSocket transport failure (HTTP ${response?.code ?: 0})")
                listener.onError(
                    "transport_error",
                    "连接失败，请检查网络和服务配置。",
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
        if (stopped.get() || !sessionReady.get()) return
        synchronized(audioBuffer) {
            audioBuffer.write(pcm16Mono)
            val data = audioBuffer.toByteArray()
            val frameBytes = 9_600 // 200 ms of 24 kHz mono PCM16
            var offset = 0
            while (offset + frameBytes <= data.size) {
                val frame = data.copyOfRange(offset, offset + frameBytes)
                if (webSocket?.send(encodeAudioAppend(frame).toString()) != true) {
                    audioBuffer.reset()
                    sessionReady.set(false)
                    listener.onError("audio_send_failed", "音频发送失败，请重新连接。")
                    return
                }
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
        synchronized(audioBuffer) { audioBuffer.reset() }
        sourceText.clear()
        translationText.clear()
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

    internal fun receiveServerMessage(text: String) {
        if (stopped.get()) return
        try {
            handleServerEvent(JSONObject(text))
        } catch (_: JSONException) {
            sessionReady.set(false)
            listener.onError("invalid_server_event", "服务返回了无效数据，请重新连接。")
        }
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
                val update = sourceText.append(json.optString("delta"))
                update.final?.let { listener.onSourceFinal(it) }
                if (update.draft.isNotEmpty()) listener.onSourceDraft(update.draft)
            }
            "session.output_transcript.delta" -> {
                val update = translationText.append(json.optString("delta"))
                update.final?.let { listener.onTranslationFinal(it) }
                if (update.draft.isNotEmpty()) listener.onTranslationDraft(update.draft)
            }
            "session.output_audio.delta" -> Unit
            "error" -> {
                val error = json.optJSONObject("error")
                listener.onError(
                    sanitizeErrorCode(error?.optString("code")),
                    "服务请求失败，请检查 API Key 和服务配置。",
                )
            }
        }
    }

    companion object {
        private const val TAG = "OpenAIRealtimeEngine"
        const val ENDPOINT = "wss://api.openai.com/v1/realtime/translations"
        const val MODEL = "gpt-realtime-translate"
        const val SOURCE_TRANSCRIPTION_MODEL = "gpt-realtime-whisper"
    }
}
