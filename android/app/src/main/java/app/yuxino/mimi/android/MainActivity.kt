package app.yuxino.mimi.android

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.yuxino.mimi.android.capture.MimiService
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity() {

    private lateinit var startStop: MaterialButton
    private var running = false

    private val projectionManager: MediaProjectionManager by lazy {
        getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        startStop = findViewById(R.id.start_stop)
        findViewById<MaterialButton>(R.id.go_settings).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        startStop.setOnClickListener {
            if (running) {
                stopService()
            } else {
                beginStartFlow()
            }
        }

        requestNotificationPermissionIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        refreshUi()
    }

    private fun refreshUi() {
        val overlayOk = Settings.canDrawOverlays(this)
        val keyOk = SettingsStore.apiKey(this).isNotEmpty()
        startStop.text = getString(
            if (running) R.string.stop_capture else R.string.start_capture,
        )
        if (!overlayOk) {
            Toast.makeText(this, R.string.need_overlay_permission, Toast.LENGTH_LONG).show()
        } else if (!keyOk) {
            Toast.makeText(this, R.string.need_api_key, Toast.LENGTH_LONG).show()
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS,
            )
        }
    }

    private fun beginStartFlow() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, R.string.need_overlay_permission, Toast.LENGTH_LONG).show()
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                ),
            )
            return
        }
        if (SettingsStore.apiKey(this).isEmpty()) {
            Toast.makeText(this, R.string.need_api_key, Toast.LENGTH_LONG).show()
            startActivity(Intent(this, SettingsActivity::class.java))
            return
        }
        projectionManager.createScreenCaptureIntent().let {
            ActivityCompat.startActivityForResult(this, it, REQ_PROJECTION, null)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PROJECTION) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                ContextCompat.startForegroundService(
                    this, MimiService.startIntent(this, resultCode, data),
                )
                running = true
                refreshUi()
            }
        }
    }

    private fun stopService() {
        startService(MimiService.stopIntent(this))
        running = false
        refreshUi()
    }

    companion object {
        private const val REQ_NOTIFICATIONS = 11
        private const val REQ_PROJECTION = 12
    }
}
