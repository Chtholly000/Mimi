package app.yuxino.mimi.android.capture

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
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
import android.widget.Toast
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean
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
    private var capturing: AtomicBoolean? = null
    private var generation = 0
    private var projectionCallback: MediaProjection.Callback? = null
    private var engine: ProviderEngine? = null

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var immersiveSession = false
    private var sessionSourceLanguage = "auto"
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
        if (isRunning) return START_NOT_STICKY
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
        try {
            startAsForeground()
            val projection = checkNotNull(projectionManager.getMediaProjection(resultCode, resultData))
            mediaProjection = projection
            startCapture(projection)
            setRunning(true)
        } catch (_: Exception) {
            Log.w(TAG, "capture_start_failed")
            Toast.makeText(this, R.string.capture_failed, Toast.LENGTH_LONG).show()
            stopEverything()
        }
        return START_NOT_STICKY
    }

    private fun startAsForeground() {
        val stopIntent = PendingIntent.getService(
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
        check(ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "audio_permission_required"
        }
        val sessionGeneration = ++generation
        SubtitleBus.clear()
        SubtitleBus.setHistoryLimit(SettingsStore.historyLines(this))
        val callback = object : MediaProjection.Callback() {
            override fun onStop() {
                if (generation == sessionGeneration) stopEverything()
            }
        }
        projectionCallback = callback
        projection.registerCallback(callback, mainHandler)

        // Serialize provider callbacks with stop/start and ignore stale sessions.
        fun dispatch(action: () -> Unit) {
            mainHandler.post { if (generation == sessionGeneration) action() }
        }
        val provider = SettingsStore.provider(this)
        val apiKey = SettingsStore.apiKey(this)
        val sourceLang = SettingsStore.sourceLang(this)
        sessionSourceLanguage = sourceLang
        val targetLang = SettingsStore.targetLang(this)
        val listener = object : EngineListener {
            override fun onSessionReady() = dispatch { Log.i(TAG, "session ready") }
            override fun onSourceDraft(text: String, language: String?) = dispatch {
                cancelAutoHide()
                SubtitleBus.onSourceDraft(text, language)
            }
            override fun onSourceFinal(text: String, language: String?) = dispatch {
                cancelAutoHide()
                SubtitleBus.onSourceFinal(text, language)
            }
            override fun onTranslationDraft(text: String) = dispatch {
                cancelAutoHide()
                SubtitleBus.onTranslationDraft(text)
            }
            override fun onTranslationFinal(text: String) = dispatch {
                SubtitleBus.onTranslationFinal(text)
                scheduleAutoHide()
            }
            override fun onError(code: String, message: String) = dispatch {
                // Provider error bodies can echo user content or credentials.
                Toast.makeText(this@MimiService, R.string.capture_failed, Toast.LENGTH_LONG).show()
                stopEverything()
            }
            override fun onClosed() = dispatch { stopEverything() }
            override fun onLog(message: String) = Unit
        }
        engine = when (provider) {
            SettingsStore.PROVIDER_OPENAI -> OpenAIRealtimeEngine(listener)
            SettingsStore.PROVIDER_DASHSCOPE -> DashScopeEngine(listener)
            else -> app.yuxino.mimi.android.provider.StreamingServiceEngine(SettingsStore.configuration(this), listener)
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
        check(minBuffer > 0) { "unsupported_capture_format" }
        val record = AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(minBuffer * 4)
            .setAudioPlaybackCaptureConfig(captureConfig)
            .build()
        audioRecord = record
        check(record.state == AudioRecord.STATE_INITIALIZED) { "capture_uninitialized" }

        val resampler = StreamResampler(CAPTURE_RATE_HZ, engine!!.sampleRateHz, 2)
        val readBuffer = FloatArray(CAPTURE_RATE_HZ / 10 * 2) // 100 ms of stereo

        val captureActive = AtomicBoolean(true)
        capturing = captureActive
        val sessionEngine = checkNotNull(engine)
        record.startRecording()
        check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "capture_not_started" }
        showOverlay()
        captureThread = thread(name = "mimi-capture") {
            try {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
                while (captureActive.get()) {
                    val read = record.read(readBuffer, 0, readBuffer.size, AudioRecord.READ_BLOCKING)
                    if (!captureActive.get()) break
                    check(read >= 0) { "capture_read_failed" }
                    if (read == 0) continue
                    val pcm = resampler.push(readBuffer.copyOf(read))
                    if (captureActive.get() && pcm.isNotEmpty()) sessionEngine.sendAudio(pcm)
                }
            } catch (_: Exception) {
                mainHandler.post {
                    if (generation == sessionGeneration) {
                        Toast.makeText(this, R.string.capture_failed, Toast.LENGTH_LONG).show()
                        stopEverything()
                    }
                }
            } finally {
                record.release()
            }
        }
    }

    private fun releaseSession() {
        ++generation
        mainHandler.removeCallbacksAndMessages(null)
        capturing?.set(false)
        capturing = null
        // Stop blocking reads before waiting for the worker to finish.
        val record = audioRecord
        audioRecord = null
        try { record?.stop() } catch (_: Exception) { }
        val worker = captureThread
        captureThread = null
        if (worker != null) worker.join(600) else record?.release()
        engine?.stop()
        engine = null
        val projection = mediaProjection
        mediaProjection = null
        projectionCallback?.let { projection?.unregisterCallback(it) }
        projectionCallback = null
        try { projection?.stop() } catch (_: Exception) { }
        SubtitleBus.clear()
        hideOverlay()
        setRunning(false)
    }

    private fun stopEverything() {
        releaseSession()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        SubtitleBus.removeListener(busListener)
        releaseSession()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    /** Compact subtitle card, or a plain-text overlay that passes touches to the video. */
    private fun showOverlay() {
        if (overlayView != null) return
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        immersiveSession = SettingsStore.immersiveSubtitles(this)
        val bgAlpha = if (immersiveSession) 0 else SettingsStore.overlayBgAlpha(this)
        val container = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            val horizontalPadding = if (immersiveSession) 3 else 14
            setPadding(dp(horizontalPadding), dp(9), dp(horizontalPadding), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(((bgAlpha / 100.0) * 255).toInt() shl 24 or 0x101010)
            }
            alpha = if (immersiveSession) 1f else SettingsStore.overlayOpacity(this@MimiService) / 100f
        }

        val status = TextView(this).apply {
            setTextColor(0xFFADADAD.toInt())
            textSize = 11f
            visibility = View.GONE
        }
        val history = TextView(this).apply {
            setTextColor(0xFFB7B7B7.toInt())
            textSize = (SettingsStore.fontSize(this@MimiService) - 3).coerceAtLeast(11).toFloat()
            setLineSpacing(dp(2).toFloat(), 1f)
        }
        val source = TextView(this).apply {
            setTextColor(0xFFE7E7E7.toInt())
            textSize = SettingsStore.fontSize(this@MimiService).toFloat()
            maxLines = 2
            maxWidth = (resources.displayMetrics.widthPixels * 0.88f).toInt()
            if (immersiveSession) setShadowLayer(dp(4).toFloat(), 0f, dp(1).toFloat(), Color.BLACK)
        }
        val translation = TextView(this).apply {
            setTextColor(SettingsStore.translationColor(this@MimiService))
            textSize = (SettingsStore.fontSize(this@MimiService) + 3).toFloat()
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 3
            if (immersiveSession) setShadowLayer(dp(4).toFloat(), 0f, dp(1).toFloat(), Color.BLACK)
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
                or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                or (if (immersiveSession) WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else 0),
            PixelFormat.TRANSLUCENT,
        ).apply {
            // Always horizontally centered over the video, offset from the
            // bottom edge; the card hugs its text in both directions.
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(SettingsStore.overlayYOffset(this@MimiService))
            // Android 12+ passes touches through an untrusted overlay only when
            // its window opacity stays at or below the system threshold (0.8).
            if (immersiveSession) alpha = 0.8f
        }

        // Vertical drag only; horizontal centering is fixed so every sentence
        // length stays self-centered, like native video subtitles.
        var initialY = 0
        var initialTouchY = 0f
        if (!immersiveSession) container.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    initialY = params.y
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val newY = (initialY - (event.rawY - initialTouchY)).toInt()
                    params.y = newY.coerceAtLeast(0)
                    wm.updateViewLayout(container, params)
                    true
                }
                MotionEvent.ACTION_UP -> {
                    container.performClick()
                    SettingsStore.setOverlayYOffset(
                        this, (params.y / resources.displayMetrics.density).toInt(),
                    )
                    true
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
            visibility = if (maxLines <= 0 || immersiveSession) View.GONE else View.VISIBLE
            setMaxLines(maxOf(maxLines, 1) * 2) // each history pair renders as two lines
            text = SubtitleBus.historySnapshot().takeLast(maxLines).joinToString("\n") { pair ->
                "${pair.source}\n${pair.translation}"
            }
        }
        // Live display: translation line always; the source line joins only
        // when the speech is English (detected or configured).
        val liveVisible = !SubtitleBus.liveHidden
        val sourceIsEnglish =
            sessionSourceLanguage == "en" ||
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
        @Volatile var isRunning: Boolean = false
            private set
        private val stateListeners = CopyOnWriteArraySet<() -> Unit>()
        fun addStateListener(listener: () -> Unit) { stateListeners.add(listener) }
        fun removeStateListener(listener: () -> Unit) { stateListeners.remove(listener) }
        private fun setRunning(value: Boolean) {
            isRunning = value
            stateListeners.forEach { it() }
        }

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
