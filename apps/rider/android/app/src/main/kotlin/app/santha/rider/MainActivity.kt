package app.santha.rider

import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNotificationChannels()
    }

    /**
     * Push channels (review G1). The backend sends urgent messages to "orders_alarm": new orders and delivery offers must ring like a phone call, with the Santha chime (res/raw/order_alert.wav).
     * Everything else uses "updates" (the default channel in the manifest).
     */
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
            val sound = Uri.parse("android.resource://$packageName/${R.raw.order_alert}")
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        manager.createNotificationChannel(
            NotificationChannel("updates", getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT),
        )
        manager.createNotificationChannel(
            NotificationChannel("orders_alarm", getString(R.string.channel_orders_alarm), NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(sound, attrs)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 600, 300, 600)
            },
        )
    }
}
