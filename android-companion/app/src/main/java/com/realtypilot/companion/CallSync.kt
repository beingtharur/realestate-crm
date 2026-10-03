package com.realtypilot.companion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class SyncSummary(val uploaded: Int, val logged: Int, val message: String)

/**
 * The whole job of this app:
 *   1. ask the CRM which phone numbers are this user's leads
 *   2. read finished calls from the phone's own call log
 *   3. upload only the calls whose number is a lead (personal calls never leave the phone)
 * The CRM attaches each call to the right lead and ignores anything it has already received.
 */
object CallSync {
    private const val OVERLAP_MS = 6 * 60 * 60 * 1000L   // re-read the last 6 hours: catches calls that ended out of order
    private const val BATCH = 100

    fun hasCallLogPermission(ctx: Context): Boolean =
        ctx.checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    /** "+91 98765-43210" → "9876543210". Empty when it is not a 10-digit mobile. */
    fun normalize(number: String): String {
        val digits = number.filter { it.isDigit() }
        return if (digits.length >= 10) digits.takeLast(10) else ""
    }

    private fun typeName(type: Int): String? = when (type) {
        CallLog.Calls.OUTGOING_TYPE -> "outgoing"
        CallLog.Calls.INCOMING_TYPE -> "incoming"
        CallLog.Calls.MISSED_TYPE -> "missed"
        CallLog.Calls.REJECTED_TYPE -> "rejected"
        CallLog.Calls.BLOCKED_TYPE -> "blocked"
        CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
        CallLog.Calls.ANSWERED_EXTERNALLY_TYPE -> "incoming"
        else -> null
    }

    @Synchronized
    fun run(ctx: Context): SyncSummary {
        if (!Prefs.isSignedIn(ctx)) return SyncSummary(0, 0, "Not signed in")

        // 1. lead numbers + calls waiting to be made
        val cfg = Api.request(ctx, "GET", "/api/device/sync")
        val numbers = HashSet<String>()
        val arr = cfg.getJSONArray("numbers")
        for (i in 0 until arr.length()) numbers.add(arr.getString(i))
        Prefs.saveSync(ctx, numbers, cfg.getJSONArray("pending").toString(), cfg.optString("org"))

        if (!hasCallLogPermission(ctx)) return done(ctx, SyncSummary(0, 0, "Call log access is not allowed yet"))

        // 2. finished calls since the last sync
        val since = Prefs.lastCallDate(ctx)
        val sent = LinkedHashSet(Prefs.sentIds(ctx))
        val batch = ArrayList<JSONObject>()
        var newest = since
        ctx.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
            "${CallLog.Calls.DATE} > ?", arrayOf((since - OVERLAP_MS).toString()), "${CallLog.Calls.DATE} ASC"
        )?.use { c ->
            while (c.moveToNext()) {
                val date = c.getLong(3)
                if (date > newest) newest = date
                val extId = "${c.getLong(0)}-$date"
                if (sent.contains(extId)) continue
                val number = normalize(c.getString(1) ?: "")
                if (number.isEmpty() || !numbers.contains(number)) continue      // not a CRM lead → stays on the phone
                val type = typeName(c.getInt(2)) ?: continue
                batch.add(JSONObject().put("ext_id", extId).put("phone", number).put("type", type)
                    .put("started_at", date).put("duration", c.getLong(4)))
            }
        }

        // 3. upload
        var logged = 0
        for (chunk in batch.chunked(BATCH)) {
            val res = Api.request(ctx, "POST", "/api/device/calls", JSONObject().put("calls", JSONArray(chunk)))
            val results = res.getJSONArray("results")
            for (i in 0 until results.length()) {
                val r = results.getJSONObject(i)
                sent.add(r.getString("ext_id"))
                if (r.optString("result") == "logged") logged++
            }
        }
        Prefs.saveSentIds(ctx, sent)
        Prefs.setLastCallDate(ctx, newest)
        val msg = if (batch.isEmpty()) "No new calls to leads" else "$logged call(s) added to the CRM"
        return done(ctx, SyncSummary(batch.size, logged, msg))
    }

    private fun done(ctx: Context, s: SyncSummary): SyncSummary {
        val time = SimpleDateFormat("dd MMM, hh:mm a", Locale.getDefault()).format(Date())
        Prefs.setLastSyncText(ctx, "$time — ${s.message}")
        return s
    }
}
