package app.yuxino.mimi.android

import app.yuxino.mimi.android.provider.ServiceProvider

/** Same provider artwork as desktop, with neutral controls separate from each brand mark. */
internal fun serviceProviderIcon(provider: ServiceProvider): Int = when (provider) {
    ServiceProvider.DASHSCOPE -> R.drawable.ic_translation_alibaba
    ServiceProvider.OPENAI -> R.drawable.ic_provider_openai
    ServiceProvider.GEMINI -> R.drawable.ic_provider_gemini
    ServiceProvider.AZURE -> R.drawable.ic_provider_azure
    ServiceProvider.VOLCANO -> R.drawable.ic_provider_volcano
    ServiceProvider.TENCENT -> R.drawable.ic_provider_tencent
    ServiceProvider.BAIDU -> R.drawable.ic_provider_baidu
    ServiceProvider.XAI -> R.drawable.ic_provider_xai
}
