package app.yuxino.mimi.android.capture

import app.yuxino.mimi.android.R
import app.yuxino.mimi.android.provider.CREDENTIAL_AUTHENTICATION_FAILED

/** Provider messages are deliberately excluded from user-facing feedback. */
internal fun providerErrorMessageResource(code: String): Int = when (code) {
    CREDENTIAL_AUTHENTICATION_FAILED -> R.string.service_authentication_failed
    else -> R.string.capture_failed
}
