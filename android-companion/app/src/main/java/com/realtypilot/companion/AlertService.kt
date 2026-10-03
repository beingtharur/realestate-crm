package com.realtypilot.companion

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder

/**
 * Keeps one request open to the CRM so a new lead, a follow-up or a visit reminder reaches the phone within a second or two.
 * No Google services needed. Also syncs calls the moment the phone gets internet back.
 */
class AlertService : Service() {
    @Volatile private var running = false
    private var thread: Thread? = null
    private var net: ConnectivityManager.NetworkCallback? = null
    private val lock = Object()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Alerts.createChannels(this)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, Alerts.CH_SERVICE) else Notification.Builder(this))
            .setSmallIcon(android.R.drawable.ic_menu_call).setContentTitle("RealtyPilot is on").setContentText("Listening for new leads and reminders").setOngoing(true).build()
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, n)
        } catch (e: Exception) { stopSelf(); return START_NOT_STICKY }
        if (!Prefs.isSignedIn(this)) { stopSelf(); return START_NOT_STICKY }
        if (!running) { running = true; thread = Thread { loop() }.also { it.isDaemon = true; it.start() } }
        watchNetwork()
        return START_STICKY
    }

    /** Internet came back (or changed): sync calls straight away and retry the alert connection without waiting. */
    private fun watchNetwork() {
        if (net != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                SyncWorker.syncSoon(this@AlertService, 2)
                synchronized(lock) { lock.notifyAll() }
            }
        }
        try { cm.registerDefaultNetworkCallback(cb); net = cb } catch (e: Exception) { /* periodic sync still covers it */ }
    }

    private fun loop() {
        var failures = 0
        while (running && Prefs.isSignedIn(this)) {
            try {
                Alerts.poll(this, 25)
                failures = 0
                Prefs.setAlertsOk(this, true)
            } catch (e: ApiException) {
                if (e.code == 401) { Prefs.clear(this); break }
                failures++
                Prefs.setAlertsOk(this, false)
                pause(failures)
            } catch (e: Exception) {
                failures++
                Prefs.setAlertsOk(this, false)
                pause(failures)
            }
        }
        running = false
        stopSelf()
    }

    /** 2, 4, 8… up to 60 seconds, but a returning network cuts the wait short. */
    private fun pause(failures: Int) {
        val ms = minOf(60_000L, 2_000L shl minOf(failures, 5))
        synchronized(lock) { try { lock.wait(ms) } catch (e: InterruptedException) { /* stopping */ } }
    }

    override fun onDestroy() {
        running = false
        net?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (e: Exception) { /* ignore */ } }
        synchronized(lock) { lock.notifyAll() }
        thread?.interrupt()
        super.onDestroy()
    }

    companion object {
        /** Safe to call any time; does nothing when signed out. Falls back quietly where Android refuses a background start. */
        fun start(ctx: Context) {
            if (!Prefs.isSignedIn(ctx)) return
            try {
                val i = Intent(ctx, AlertService::class.java)
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Exception) { /* the 15-minute sync polls alerts as a safety net */ }
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, AlertService::class.java)) }
    }
}
