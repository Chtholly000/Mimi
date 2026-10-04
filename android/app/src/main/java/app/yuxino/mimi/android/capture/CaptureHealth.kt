package app.yuxino.mimi.android.capture

/** Content-free observations. Silence is not proof of a source policy or DRM. */
class CaptureHealth(private val startedAtMs: Long) {
    enum class State { WAITING, NO_PCM, SILENT, AUDIO }
    data class Snapshot(val state: State, val pcmAgeMs: Long?, val soundAgeMs: Long?)
    private var pcmAtMs: Long? = null
    private var soundAtMs: Long? = null

    @Synchronized fun observe(pcm16: ByteArray, nowMs: Long) {
        require(pcm16.size % 2 == 0)
        if (pcm16.isEmpty()) return
        pcmAtMs = nowMs
        if (pcm16.any { it != 0.toByte() }) soundAtMs = nowMs
    }

    @Synchronized fun snapshot(nowMs: Long): Snapshot {
        val pcmAge = pcmAtMs?.let { (nowMs - it).coerceAtLeast(0) }
        val soundAge = soundAtMs?.let { (nowMs - it).coerceAtLeast(0) }
        val state = when {
            nowMs - startedAtMs < GRACE_MS -> State.WAITING
            pcmAge == null || pcmAge >= GRACE_MS -> State.NO_PCM
            soundAge == null || soundAge >= GRACE_MS -> State.SILENT
            else -> State.AUDIO
        }
        return Snapshot(state, pcmAge, soundAge)
    }

    companion object { const val GRACE_MS = 5_000L }
}
