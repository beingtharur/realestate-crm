package com.realtypilot.companion

import android.content.Context

/** Everything the app remembers. Stored in the app's private storage; removed on sign-out or uninstall. */
object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("realtypilot", Context.MODE_PRIVATE)

    fun baseUrl(c: Context): String = sp(c).getString("url", "") ?: ""
    fun token(c: Context): String = sp(c).getString("token", "") ?: ""
    fun userName(c: Context): String = sp(c).getString("user", "") ?: ""
    fun orgName(c: Context): String = sp(c).getString("org", "") ?: ""
    fun isSignedIn(c: Context): Boolean = token(c).isNotEmpty()

    fun saveLogin(c: Context, url: String, token: String, user: String) {
        sp(c).edit().putString("url", url).putString("token", token).putString("user", user)
            // Start from "now": calls made before signing in are never uploaded.
            .putLong("last_call_date", System.currentTimeMillis()).apply()
    }

    fun setOrg(c: Context, v: String) = sp(c).edit().putString("org", v).apply()
    fun askedBattery(c: Context): Boolean = sp(c).getBoolean("asked_battery", false)
    fun setAskedBattery(c: Context) = sp(c).edit().putBoolean("asked_battery", true).apply()

    /** Signing out forgets the person, not the company address — so the app reopens straight on the CRM sign-in page. */
    fun clear(c: Context) { val u = baseUrl(c); sp(c).edit().clear().putString("url", u).apply() }
    fun setBaseUrl(c: Context, url: String) = sp(c).edit().putString("url", url).apply()
    /** True once the web CRM has handed this app its sign-in token. */
    fun isSignedInWith(c: Context, t: String) = t.isNotEmpty() && token(c) == t

    /** Start time of the newest call-log entry already looked at. */
    fun lastCallDate(c: Context): Long = sp(c).getLong("last_call_date", System.currentTimeMillis())
    fun setLastCallDate(c: Context, v: Long) = sp(c).edit().putLong("last_call_date", v).apply()

    /** 10-digit numbers of this user's CRM leads. Only calls to/from these numbers are uploaded. */
    fun numbers(c: Context): Set<String> = sp(c).getStringSet("numbers", emptySet()) ?: emptySet()

    fun saveSync(c: Context, numbers: Set<String>, pendingJson: String, org: String) {
        sp(c).edit().putStringSet("numbers", numbers).putString("pending", pendingJson).putString("org", org).apply()
    }

    fun pendingJson(c: Context): String = sp(c).getString("pending", "[]") ?: "[]"

    /** Call-log ids already uploaded (most recent 300), so an overlapping re-read does not resend them. */
    fun sentIds(c: Context): Set<String> = sp(c).getStringSet("sent", emptySet()) ?: emptySet()
    fun saveSentIds(c: Context, ids: Collection<String>) =
        sp(c).edit().putStringSet("sent", ids.toList().takeLast(300).toSet()).apply()

    /** Highest notification id already shown on this phone. -1 = never polled (the first poll only learns the position). */
    fun lastAlertId(c: Context): Long = sp(c).getLong("alert_id", -1L)
    fun setLastAlertId(c: Context, v: Long) = sp(c).edit().putLong("alert_id", v).apply()
    fun alertsOk(c: Context): Boolean = sp(c).getBoolean("alerts_ok", false)
    fun setAlertsOk(c: Context, v: Boolean) = sp(c).edit().putBoolean("alerts_ok", v).apply()

    fun lastSyncText(c: Context): String = sp(c).getString("last_sync_text", "Not synced yet") ?: ""
    fun setLastSyncText(c: Context, v: String) = sp(c).edit().putString("last_sync_text", v).apply()
}
