package com.realtypilot.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart or an app update: start listening again and sync, without the rep opening the app. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!Prefs.isSignedIn(context)) return
        SyncWorker.schedulePeriodic(context)
        SyncWorker.syncSoon(context, 10)
        AlertService.start(context)
    }
}
