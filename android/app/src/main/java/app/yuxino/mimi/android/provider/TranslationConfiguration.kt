package app.yuxino.mimi.android.provider

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Credentials belong only to this text-translation endpoint, never to the speech provider. */
data class TranslationConfiguration(
    val endpoint: String,
    val model: String,
    val apiKey: String = "",
    val allowLocalHttp: Boolean = false,
) {
    override fun toString(): String = "TranslationConfiguration(credentials=redacted)"
}

/** Accept a Chat Completions endpoint or a /v1 base URL without DNS resolution. */
fun normalizeTranslationEndpoint(config: TranslationConfiguration): String {
    val endpoint = config.endpoint.trim()
    require(endpoint.length in 1..2048 && endpoint.none { it.isISOControl() }) { "translation_endpoint" }
    require(endpoint.startsWith("https://") || endpoint.startsWith("http://")) { "translation_endpoint" }
    require(!endpoint.contains('\\') && !endpoint.substringAfter("://").substringBefore('/').contains('@')) { "translation_endpoint" }
    val url = endpoint.toHttpUrlOrNull() ?: throw IllegalArgumentException("translation_endpoint")
    require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) {
        "translation_endpoint"
    }
    require(url.isHttps || (config.allowLocalHttp && isLocalTranslationHost(url.host))) {
        "translation_https_required"
    }
    val path = url.encodedPath.trimEnd('/')
    val completedPath = when {
        path.endsWith("/chat/completions") -> path
        path.endsWith("/v1") -> "$path/chat/completions"
        path.isEmpty() -> "/v1/chat/completions"
        else -> throw IllegalArgumentException("translation_endpoint")
    }
    return url.newBuilder().encodedPath(completedPath).build().toString()
}

// This explicit allowlist also matches Android's network_security_config.xml.
private fun isLocalTranslationHost(host: String): Boolean =
    host in setOf("localhost", "127.0.0.1", "::1", "10.0.2.2")

internal fun validateTranslationConfiguration(config: TranslationConfiguration): String {
    val endpoint = normalizeTranslationEndpoint(config)
    require(config.model.trim().length in 1..128 && config.model.none { it.isISOControl() }) {
        "translation_model"
    }
    require(config.apiKey.length <= 4096 && config.apiKey.none { it.isISOControl() }) { "translation_key" }
    return endpoint
}
