package app.yuxino.mimi.android.provider

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WebsocketFailureTest {
    @Test fun sharedHandshakeFailuresKeepAuthenticationDistinctFromNetworkFailures() {
        val contract = requireNotNull(javaClass.getResourceAsStream("/translation-contracts.json"))
            .bufferedReader().use { JSONObject(it.readText()) }
        assertEquals(1, contract.getInt("schemaVersion"))
        val cases = contract.getJSONArray("websocketHandshakeFailures")
        assertTrue(cases.length() > 0)
        repeat(cases.length()) { index ->
            val case = cases.getJSONObject(index)
            val status = if (case.isNull("httpStatus")) null else case.getInt("httpStatus")
            val expected = if (case.isNull("expected")) "transport_error" else case.getString("expected")
            assertEquals(case.getString("id"), expected, websocketFailureCode(status))
        }
    }
}
