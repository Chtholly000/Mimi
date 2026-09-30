package app.yuxino.mimi.android.capture

import app.yuxino.mimi.android.resample.StreamResampler
import org.junit.Assert.*
import org.junit.Test

class CaptureHealthTest {
    @Test fun graceAndNoPcmAreIndependentOfServiceRunning() {
        val health = CaptureHealth(100)
        assertEquals(CaptureHealth.State.WAITING, health.snapshot(5_099).state)
        health.observe(byteArrayOf(), 2_000)
        assertEquals(CaptureHealth.State.NO_PCM, health.snapshot(5_100).state)
        assertNull(health.snapshot(5_100).pcmAgeMs)
    }

    @Test fun silenceSoundStallAndRecoveryAreDistinct() {
        val health = CaptureHealth(0)
        health.observe(ByteArray(20), 5_000)
        assertEquals(CaptureHealth.State.SILENT, health.snapshot(5_000).state)
        health.observe(byteArrayOf(0, -128), 5_001)
        assertEquals(CaptureHealth.State.AUDIO, health.snapshot(5_001).state)
        health.observe(ByteArray(20), 10_001)
        val silent = health.snapshot(10_001)
        assertEquals(CaptureHealth.State.SILENT, silent.state)
        assertEquals(0L, silent.pcmAgeMs)
        assertEquals(5_000L, silent.soundAgeMs)
        assertEquals(CaptureHealth.State.NO_PCM, health.snapshot(15_001).state)
        health.observe(byteArrayOf(1, 0), 15_002)
        assertEquals(CaptureHealth.State.AUDIO, health.snapshot(15_002).state)
    }

    @Test fun newSessionCannotReuseOldObservation() {
        val old = CaptureHealth(0)
        old.observe(byteArrayOf(1, 0), 10_000)
        val replacement = CaptureHealth(10_000)
        assertEquals(CaptureHealth.State.WAITING, replacement.snapshot(10_001).state)
        assertEquals(CaptureHealth.State.NO_PCM, replacement.snapshot(15_000).state)
    }

    @Test fun measureProviderPcmAfterStereoCancellation() {
        val pcm = StreamResampler(48_000, 16_000, 2).push(floatArrayOf(1f, -1f, 1f, -1f, 1f, -1f))
        val health = CaptureHealth(0)
        health.observe(pcm, 5_000)
        assertEquals(CaptureHealth.State.SILENT, health.snapshot(5_000).state)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectPartialPcmSample() { CaptureHealth(0).observe(byteArrayOf(1), 5_000) }
}
