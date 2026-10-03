package app.yuxino.mimi.android.provider

import org.junit.Assert.*
import org.junit.Test

class DashScopeProtocolTest {
    private var error: Pair<String, String>? = null
    private var translationEvents = 0
    private val listener = object : EngineListener {
        override fun onSessionReady() = Unit
        override fun onSourceDraft(text: String, language: String?) = Unit
        override fun onSourceFinal(text: String, language: String?) = Unit
        override fun onTranslationDraft(text: String) { translationEvents++ }
        override fun onTranslationFinal(text: String) { translationEvents++ }
        override fun onError(code: String, message: String) { error = code to message }
        override fun onClosed() = Unit
        override fun onLog(message: String) = Unit
    }

    @Test fun glossaryPreservesTargetPhrasesAsStrings() {
        val engine = DashScopeEngine(listener)
        engine.setHotwords(mapOf("mimi" to "耳", "version" to "123"))
        val phrases = engine.buildSessionUpdate().getJSONObject("session")
            .getJSONObject("translation").getJSONObject("corpus").getJSONObject("phrases")
        assertEquals("耳", phrases.get("mimi"))
        assertEquals("123", phrases.get("version"))
    }

    @Test fun transcriptionOnlySessionExcludesTranslationConfiguration() {
        val session = DashScopeEngine(listener, transcriptionOnly = true).buildSessionUpdate().getJSONObject("session")
        assertFalse(session.has("translation"))
        assertFalse(session.getJSONObject("input_audio_transcription").has("model"))
        assertFalse(session.has("modalities"))
        assertEquals("server_vad", session.getJSONObject("turn_detection").getString("type"))
        assertEquals(800, session.getJSONObject("turn_detection").getInt("silence_duration_ms"))
        assertEquals(16_000, session.getInt("sample_rate"))
    }

    @Test fun transcriptionOnlyEndpointReplacesAnyPastedLiveTranslationModel() {
        val engine = DashScopeEngine(listener, transcriptionOnly = true)
        assertEquals("wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${DashScopeEngine.ASR_MODEL}", engine.resolveEndpoint(""))
        assertEquals("wss://example.test/realtime?region=test&model=${DashScopeEngine.ASR_MODEL}",
            engine.resolveEndpoint("wss://example.test/realtime?model=old-live-translate&region=test&model=other"))
        // Existing integrated speech translation continues to honor a pasted model override.
        assertEquals("wss://example.test/realtime?model=custom-model",
            DashScopeEngine(listener).resolveEndpoint("wss://example.test/realtime?model=custom-model"))
    }

    @Test fun transcriptionOnlyNeverEmitsProviderTranslations() {
        val event = """{"type":"response.text.done","text":"synthetic translation"}"""
        DashScopeEngine(listener, transcriptionOnly = true).receiveServerMessage(event)
        assertEquals(0, translationEvents)
        DashScopeEngine(listener).receiveServerMessage(event)
        assertEquals(1, translationEvents)
    }

    @Test fun malformedServerEventReportsErrorWithoutThrowing() {
        DashScopeEngine(listener).receiveServerMessage("not JSON: private text")
        assertEquals("invalid_server_event", error?.first)
        assertFalse(error!!.second.contains("private text"))
    }

    @Test fun errorDoesNotForwardProviderContent() {
        DashScopeEngine(listener).receiveServerMessage(
            """{"type":"error","error":{"code":"invalid_value","message":"private text"}}"""
        )
        assertEquals("invalid_value", error?.first)
        assertFalse(error!!.second.contains("private text"))
    }

    @Test fun stoppedEngineIgnoresLateServerEvents() {
        val engine = DashScopeEngine(listener)
        engine.stop()
        engine.receiveServerMessage("not JSON")
        assertNull(error)
    }

    @Test fun diagnosticCodeRejectsArbitraryProviderMessages() {
        assertEquals("invalid_api_key", sanitizeErrorCode("invalid_api_key"))
        assertEquals("provider_error", sanitizeErrorCode("Invalid transcript: private text"))
        assertEquals("provider_error", sanitizeErrorCode("a".repeat(65)))
        assertEquals("provider_error", sanitizeErrorCode(null))
    }
}
