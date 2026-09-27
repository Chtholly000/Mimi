package app.yuxino.mimi.android.provider

import org.junit.Assert.*
import org.junit.Test

class DashScopeProtocolTest {
    private var error: Pair<String, String>? = null
    private val listener = object : EngineListener {
        override fun onSessionReady() = Unit
        override fun onSourceDraft(text: String, language: String?) = Unit
        override fun onSourceFinal(text: String, language: String?) = Unit
        override fun onTranslationDraft(text: String) = Unit
        override fun onTranslationFinal(text: String) = Unit
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
