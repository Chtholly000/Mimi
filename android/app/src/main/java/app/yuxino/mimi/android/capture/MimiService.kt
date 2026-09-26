package app.yuxino.mimi.android.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.IBinder
import android.os.Build
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import app.yuxino.mimi.android.R
import app.yuxino.mimi.android.SettingsStore
import app.yuxino.mimi.android.provider.DashScopeEngine
import app.yuxino.mimi.android.provider.EngineListener
import app.yuxino.mimi.android.provider.OpenAIRealtimeEngine
import app.yuxino.mimi.android.provider.ProviderEngine
import app.yuxino.mimi.android.provider.SubtitleBus
import app.yuxino.mimi.android.resample.StreamResampler
import kotlin.concurrent.thread

/**
 * Foreground service that owns the MediaProjection playback-capture loop and
 * the overlay subtitle window. One service, one lifecycle, one notification.
 */
class MimiService : Service() {

    private val mainHandler = Handler(Looper.getMainLooper())

    private var mediaProjection: MediaProjection? = null
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null
    private val capturing = java.util.concurrent.atomic.AtomicBoolean(false)
    private var engine: ProviderEngine? = null

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var statusView: TextView? = null
    private var historyView: TextView? = null
    private var sourceView: TextView? = null
    private var translationView: TextView? = null

    private val busListener = object : SubtitleBus.Listener {
        override fun onSubtitleChanged() {
            mainHandler.post { renderBus() }
        }
    }

    /** Hides the live lines after the sentence-final lands and speech pauses. */
    private val autoHideRunnable = Runnable { SubtitleBus.hideLive() }

    /**
     * Fallback hide: providers may never send a sentence-final when background
     * music keeps their VAD from firing, so any gap in streaming deltas also
     * hides the card.
     */
    private val watchdogRunnable = Runnable { SubtitleBus.hideLive() }

    /**
     * Only a sentence-final starts the quick hide. Any streaming draft cancels
     * it, so event gaps inside one utterance can never blink the card.
     */
    private fun scheduleAutoHide() {
        mainHandler.removeCallbacks(autoHideRunnable)
        mainHandler.postDelayed(autoHideRunnable, AUTO_HIDE_MS)
    }

    private fun cancelAutoHide() {
        mainHandler.removeCallbacks(autoHideRunnable)
        // Keep the fallback watchdog armed across the whole session.
        mainHandler.removeCallbacks(watchdogRunnable)
        mainHandler.postDelayed(watchdogRunnable, WATCHDOG_MS)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        SubtitleBus.addListener(busListener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEverything()
            return START_NOT_STICKY
        }
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        val resultData = intent?.compatGetParcelableExtra(EXTRA_RESULT_DATA)
        if (resultCode == Int.MIN_VALUE || resultData == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        // Official order on Android 14+: startForeground with the
        // mediaProjection type first — getMediaProjection() then requires the
        // FGS to already be running with that type, and startForeground's
        // token deadline is satisfied by calling it immediately after.
        val projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startAsForeground()
        val projection = projectionManager.getMediaProjection(resultCode, resultData)
        if (projection == null) {
            Log.e(TAG, "getMediaProjection returned null")
            stopSelf()
            return START_NOT_STICKY
        }
        mediaProjection = projection
        startCapture(projection)
        return START_NOT_STICKY
    }

    private fun startAsForeground() {
        val stopIntent = PendingIntent.getForegroundService(
            this, 1,
            Intent(this, MimiService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_mimi)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setContentIntent(mainActivityIntent())
            .addAction(
                Notification.Action.Builder(
                    null, getString(R.string.stop_action), stopIntent,
                ).build(),
            )
            .setOngoing(true)
            .build()
        startForeground(
            NOTIFICATION_ID, notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        )
    }

    private fun mainActivityIntent(): PendingIntent =
        PendingIntent.getActivity(
            this, 0,
            Intent(this, app.yuxino.mimi.android.MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )

    private fun startCapture(projection: MediaProjection) {
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                mainHandler.post { stopEverything() }
            }
        }, mainHandler)

        // Open the audio engine with the configured provider.
        val provider = SettingsStore.provider(this)
        val apiKey = SettingsStore.apiKey(this)
        val sourceLang = SettingsStore.sourceLang(this)
        val targetLang = SettingsStore.targetLang(this)
        val listener = object : EngineListener {
            override fun onSessionReady() {
                Log.i(TAG, "session ready")
            }
            override fun onSourceDraft(text: String, language: String?) {
                cancelAutoHide()
                SubtitleBus.onSourceDraft(text, language)
            }
            override fun onSourceFinal(text: String, language: String?) {
                cancelAutoHide()
                SubtitleBus.onSourceFinal(text, language)
            }
            override fun onTranslationDraft(text: String) {
                cancelAutoHide()
                SubtitleBus.onTranslationDraft(text)
            }
            override fun onTranslationFinal(text: String) {
                SubtitleBus.onTranslationFinal(text)
                scheduleAutoHide()
            }
            override fun onError(code: String, message: String) =
                SubtitleBus.onStatus("错误[$code] $message")
            override fun onClosed() {
                Log.i(TAG, "session closed")
            }
            override fun onLog(message: String) {
                Log.i(TAG, message)
            }
        }
        engine = when (provider) {
            SettingsStore.PROVIDER_OPENAI -> OpenAIRealtimeEngine(listener)
            else -> DashScopeEngine(listener)
        }
        engine?.setHotwords(SettingsStore.hotwords(this))
        engine?.start(
            apiKey, sourceLang, targetLang,
            SettingsStore.baseUrl(this, provider),
            SettingsStore.model(this, provider),
        )

        // Playback capture at a fixed 48 kHz stereo float; the system resamples
        // whatever the apps actually play into this format for us.
        val captureConfig =
            AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(CAPTURE_RATE_HZ)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()
        val minBuffer = AudioRecord.getMinBufferSize(
            CAPTURE_RATE_HZ, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_FLOAT,
        )
        val record = AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(minBuffer * 4)
            .setAudioPlaybackCaptureConfig(captureConfig)
            .build()
        audioRecord = record

        val resampler = StreamResampler(CAPTURE_RATE_HZ, engine!!.sampleRateHz, 2)
        val readBuffer = FloatArray(CAPTURE_RATE_HZ / 10 * 2) // 100 ms of stereo

        capturing.set(true)
        record.startRecording()
        SubtitleBus.clear()
        showOverlay()
        captureThread = thread(name = "mimi-capture") {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            while (capturing.get()) {
                val read = record.read(readBuffer, 0, readBuffer.size, AudioRecord.READ_BLOCKING)
                if (read <= 0) continue
                val pcm = resampler.push(readBuffer.copyOf(read))
                if (pcm.isNotEmpty()) engine?.sendAudio(pcm)
            }
        }
    }

    private fun stopEverything() {
        if (!capturing.compareAndSet(true, false) && mediaProjection == null) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        captureThread?.join(600)
        captureThread = null
        try {
            audioRecord?.stop()
        } catch (_: Exception) {
        }
        audioRecord?.release()
        audioRecord = null
        engine?.stop()
        engine = null
        mediaProjection?.stop()
        mediaProjection = null
        hideOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        SubtitleBus.removeListener(busListener)
        super.onDestroy()
    }

    /** Overlay window: draggable vertically, full width, translucent card. */
    private fun showOverlay() {
        if (overlayView != null) return
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        val bgAlpha = SettingsStore.overlayBgAlpha(this)
        val container = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(((bgAlpha / 100.0) * 255).toInt() shl 24 or 0x101828)
            }
            alpha = SettingsStore.overlayOpacity(this@MimiService) / 100f
        }

        val status = TextView(this).apply {
            setTextColor(0xFF8A93A6.toInt())
            textSize = 11f
            visibility = View.GONE
        }
        val history = TextView(this).apply {
            setTextColor(0xFFB7BFCE.toInt())
            textSize = (SettingsStore.fontSize(this@MimiService) - 3).coerceAtLeast(11).toFloat()
            setLineSpacing(dp(2).toFloat(), 1f)
        }
        val source = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = SettingsStore.fontSize(this@MimiService).toFloat()
            setTypeface(typeface, Typeface.BOLD)
        }
        val translation = TextView(this).apply {
            setTextColor(SettingsStore.translationColor(this@MimiService))
            textSize = (SettingsStore.fontSize(this@MimiService) + 3).toFloat()
            setTypeface(typeface, Typeface.BOLD)
            // Keep the card inside the screen in either orientation.
            maxWidth = (resources.displayMetrics.widthPixels * 0.92f).toInt()
        }

        container.addView(status)
        container.addView(history)
        container.addView(source)
        container.addView(translation)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            // Always horizontally centered over the video, offset from the
            // bottom edge; the card hugs its text in both directions.
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(SettingsStore.overlayYOffset(this@MimiService))
        }

        // Vertical drag only; horizontal centering is fixed so every sentence
        // length stays self-centered, like native video subtitles.
        var initialY = 0
        var initialTouchY = 0f
        container.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    initialY = params.y
                    initialTouchY = event.rawY
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    val newY = (initialY - (event.rawY - initialTouchY)).toInt()
                    params.y = newY.coerceAtLeast(0)
                    wm.updateViewLayout(container, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    SettingsStore.setOverlayYOffset(
                        this, params.y / resources.displayMetrics.density.toInt().coerceAtLeast(1),
                    )
                    false
                }
                else -> false
            }
        }

        wm.addView(container, params)
        overlayView = container
        statusView = status
        historyView = history
        sourceView = source
        translationView = translation
        renderBus()
    }

    private fun hideOverlay() {
        try {
            overlayView?.let { windowManager?.removeView(it) }
        } catch (_: Exception) {
        }
        overlayView = null
        statusView = null
        historyView = null
        sourceView = null
        translationView = null
    }

    private fun renderBus() {
        statusView?.apply {
            val line = SubtitleBus.statusLine
            visibility = if (line.isEmpty()) View.GONE else View.VISIBLE
            text = line
        }
        historyView?.apply {
            val maxLines = SettingsStore.historyLines(this@MimiService)
            visibility = if (maxLines <= 0) View.GONE else View.VISIBLE
            setMaxLines(maxOf(maxLines, 1) * 2) // each history pair renders as two lines
            text = synchronized(SubtitleBus.history) {
                SubtitleBus.history.joinToString("\n") { pair ->
                    "${pair.source}\n${pair.translation}"
                }
            }
        }
        // Live display: translation line always; the source line joins only
        // when the speech is English (detected or configured).
        val liveVisible = !SubtitleBus.liveHidden
        val sourceIsEnglish =
            SettingsStore.sourceLang(this) == "en" ||
                SubtitleBus.detectedSourceLanguage?.startsWith("en") == true
        sourceView?.apply {
            visibility = if (liveVisible && sourceIsEnglish) View.VISIBLE else View.GONE
            text = when {
                SubtitleBus.sourceDraft.isNotEmpty() -> SubtitleBus.sourceDraft
                else -> SubtitleBus.sourceFinal
            }
        }
        translationView?.apply {
            visibility = if (liveVisible) View.VISIBLE else View.GONE
            text = when {
                SubtitleBus.translationDraft.isNotEmpty() -> SubtitleBus.translationDraft
                else -> SubtitleBus.translationFinal
            }
        }
        // Hide the card's padding footprint when nothing is on screen.
        overlayView?.visibility = if (liveVisible || SubtitleBus.statusLine.isNotEmpty())
            View.VISIBLE else View.GONE
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "MimiService"
        private const val CHANNEL_ID = "capture"
        private const val NOTIFICATION_ID = 41
        private const val CAPTURE_RATE_HZ = 48_000
        private const val AUTO_HIDE_MS = 600L
        private const val WATCHDOG_MS = 3_000L
        private val SENTENCE_DELIMITERS = charArrayOf('.', '!', '?', '。', '！', '？', '，', ',')

        const val ACTION_STOP = "app.yuxino.mimi.android.action.STOP"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"

        fun startIntent(context: Context, resultCode: Int, resultData: Intent): Intent =
            Intent(context, MimiService::class.java)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_RESULT_DATA, resultData)

        fun stopIntent(context: Context): Intent =
            Intent(context, MimiService::class.java).setAction(ACTION_STOP)

        private fun Intent.compatGetParcelableExtra(key: String): Intent? =
            if (Build.VERSION.SDK_INT >= 33) {
                getParcelableExtra(key, Intent::class.java)
            } else {
                @Suppress("DEPRECATION")
                getParcelableExtra(key) as? Intent
            }
    }
}
