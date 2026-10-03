package com.realtypilot.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

/** Android tells us when the phone goes back to idle (a call just ended) — that is the moment to sync. */
class PhoneStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val idle = intent.getStringExtra(TelephonyManager.EXTRA_STATE) == TelephonyManager.EXTRA_STATE_IDLE
        if (idle && Prefs.isSignedIn(context)) SyncWorker.syncSoon(context)
    }
}
