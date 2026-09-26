package app.yuxino.mimi.android.resample

import java.io.ByteArrayOutputStream

/**
 * Streaming interleaved-audio downmix and downsample to mono 16-bit PCM.
 *
 * Each output sample is the average of the input samples falling into its
 * interval (a box filter), which provides anti-aliasing at O(1) per input
 * sample and is sufficient for ASR. Accumulator state carries across pushes.
 */
class StreamResampler(
    private val inputSampleRateHz: Int,
    private val targetSampleRateHz: Int,
    private val channelCount: Int,
) {
    private val ratio: Double = inputSampleRateHz.toDouble() / targetSampleRateHz.toDouble()

    private var acc = 0.0
    private var accCount = 0
    private var position = 0.0

    init {
        require(inputSampleRateHz > 0 && targetSampleRateHz > 0 && channelCount > 0) {
            "invalid resampler configuration"
        }
    }

    /** Accepts interleaved float frames of any length; returns PCM16 little-endian mono bytes. */
    fun push(interleaved: FloatArray): ByteArray {
        // Downsampled mono output is never larger than the input; size for that.
        val out = ByteArrayOutputStream(interleaved.size + 64)
        val frames = interleaved.size / channelCount
        for (frame in 0 until frames) {
            var mixed = 0.0
            val base = frame * channelCount
            for (c in 0 until channelCount) {
                mixed += interleaved[base + c].toDouble()
            }
            acc += mixed / channelCount
            accCount++
            position += 1.0

            if (position >= ratio) {
                val value = (acc / accCount).coerceIn(-1.0, 1.0)
                val quantized = if (value >= 0.0) (value * 32767.0).toInt() else (value * 32768.0).toInt()
                out.write(quantized and 0xFF)
                out.write((quantized shr 8) and 0xFF)
                acc = 0.0
                accCount = 0
                position -= ratio
            }
        }
        return out.toByteArray()
    }
}
