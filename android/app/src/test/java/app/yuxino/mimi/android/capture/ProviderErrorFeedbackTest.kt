package app.yuxino.mimi.android.capture

import app.yuxino.mimi.android.R
import app.yuxino.mimi.android.provider.websocketFailureCode
import org.junit.Assert.*
import org.junit.Test

class ProviderErrorFeedbackTest {
    @Test fun handshakeAuthenticationFailuresGiveAnActionableCredentialMessage() {
        for (status in listOf(401, 403)) {
            assertEquals(R.string.service_authentication_failed, providerErrorMessageResource(websocketFailureCode(status)))
        }
    }

    @Test fun networkFailuresAndUnrecognizedProviderLabelsStaySanitized() {
        for (status in listOf(429, 500, null)) {
            assertEquals(R.string.capture_failed, providerErrorMessageResource(websocketFailureCode(status)))
        }
        for (code in listOf("", "provider_error", "private-provider-message", "credential_authentication_failed: private-token")) {
            assertEquals(R.string.capture_failed, providerErrorMessageResource(code))
        }
    }
}
