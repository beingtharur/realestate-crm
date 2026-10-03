package com.realtypilot.companion

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject

/** Shows the CRM's alerts (new lead, follow-up due, site visit…) as normal phone notifications. */
object Alerts {
    const val CH_LOUD = "alerts"          // sound + pop-up
    const val CH_QUIET = "alerts_quiet"   // do-not-disturb hours: arrives silently
    const val CH_SERVICE = "service"      // the small "listening" notification Android requires

    fun createChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_LOUD, "Leads, follow-ups & visits", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "New leads, follow-ups and site visit reminders" })
        nm.createNotificationChannel(NotificationChannel(CH_QUIET, "Silent alerts (do not disturb)", NotificationManager.IMPORTANCE_LOW)
            .apply { description = "Alerts that arrive during your do-not-disturb hours" })
        nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "Connection status", NotificationManager.IMPORTANCE_MIN)
            .apply { description = "Keeps the app listening for new leads" })
    }

    fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun open(ctx: Context, url: String, req: Int): PendingIntent {
        val intent = Intent(if (url.startsWith("tel:")) Intent.ACTION_DIAL else Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(ctx, req, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** a = one item from GET /api/device/alerts */
    fun show(ctx: Context, a: JSONObject) {
        if (!canNotify(ctx)) return
        val id = a.getLong("id")
        val link = a.optString("link")
        val base = Prefs.baseUrl(ctx).trimEnd('/')
        val target = if (link.startsWith("#")) "$base/$link" else base
        val silent = a.optBoolean("silent")
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, if (silent) CH_QUIET else CH_LOUD) else Notification.Builder(ctx)
        b.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(a.optString("title"))
            .setContentText(a.optString("message"))
            .setStyle(Notification.BigTextStyle().bigText(a.optString("message")))
            .setContentIntent(open(ctx, target, id.toInt()))
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
        if (Build.VERSION.SDK_INT < 26) b.setPriority(if (silent) Notification.PRIORITY_LOW else Notification.PRIORITY_HIGH)
        val actionUrl = a.optString("action_url")
        if (actionUrl.isNotEmpty() && a.optString("action_label").isNotEmpty()) {
            b.addAction(Notification.Action.Builder(null, a.optString("action_label"), open(ctx, actionUrl, (id + 100000).toInt())).build())
        }
        ctx.getSystemService(NotificationManager::class.java).notify(id.toInt(), b.build())
    }

    /**
     * Asks the CRM for anything new. waitSeconds > 0 holds the request open until something arrives (live alerts);
     * 0 answers immediately (used as a safety net by the periodic sync). Returns how many were shown.
     */
    @Synchronized
    fun poll(ctx: Context, waitSeconds: Int): Int {
        if (!Prefs.isSignedIn(ctx)) return 0
        val last = Prefs.lastAlertId(ctx)
        val path = if (last < 0) "/api/device/alerts" else "/api/device/alerts?after=$last&wait=$waitSeconds"
        val res = Api.request(ctx, "GET", path, readTimeoutMs = (waitSeconds + 15) * 1000)
        val items = res.optJSONArray("items")
        var shown = 0
        if (items != null) for (i in 0 until items.length()) { show(ctx, items.getJSONObject(i)); shown++ }
        Prefs.setLastAlertId(ctx, res.optLong("last_id", maxOf(last, 0L)))
        return shown
    }
}
