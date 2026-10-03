package com.realtypilot.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/** One screen: sign in, see sync status, dial calls that were started from the CRM. Not a CRM and not a dialer. */
class MainActivity : Activity() {
    private lateinit var loginGroup: View
    private lateinit var mainGroup: View
    private lateinit var statusText: TextView
    private lateinit var messageText: TextView
    private lateinit var pendingList: LinearLayout
    private lateinit var permissionButton: Button
    private lateinit var notifyButton: Button
    private lateinit var batteryButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        loginGroup = findViewById(R.id.loginGroup)
        mainGroup = findViewById(R.id.mainGroup)
        statusText = findViewById(R.id.statusText)
        messageText = findViewById(R.id.messageText)
        pendingList = findViewById(R.id.pendingList)
        permissionButton = findViewById(R.id.permissionButton)
        notifyButton = findViewById(R.id.notifyButton)
        batteryButton = findViewById(R.id.batteryButton)

        findViewById<Button>(R.id.loginButton).setOnClickListener { signIn() }
        findViewById<Button>(R.id.syncButton).setOnClickListener { syncNow() }
        findViewById<Button>(R.id.signOutButton).setOnClickListener { signOut() }
        permissionButton.setOnClickListener { askPermissions() }
        notifyButton.setOnClickListener { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2) }
        batteryButton.setOnClickListener {
            try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
            catch (e: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }

    override fun onResume() {
        super.onResume()
        render()
        if (Prefs.isSignedIn(this)) { Alerts.createChannels(this); AlertService.start(this); syncNow(silent = true) }
    }

    private fun render() {
        val signedIn = Prefs.isSignedIn(this)
        loginGroup.visibility = if (signedIn) View.GONE else View.VISIBLE
        mainGroup.visibility = if (signedIn) View.VISIBLE else View.GONE
        if (!signedIn) return
        val allowed = CallSync.hasCallLogPermission(this)
        permissionButton.visibility = if (allowed) View.GONE else View.VISIBLE
        notifyButton.visibility = if (Alerts.canNotify(this)) View.GONE else View.VISIBLE
        val pm = getSystemService(PowerManager::class.java)
        batteryButton.visibility = if (pm.isIgnoringBatteryOptimizations(packageName)) View.GONE else View.VISIBLE
        statusText.text = buildString {
            append("Signed in as ${Prefs.userName(this@MainActivity)}")
            if (Prefs.orgName(this@MainActivity).isNotEmpty()) append(" · ${Prefs.orgName(this@MainActivity)}")
            append("\n")
            append(if (allowed) "✓ Call log access allowed" else "✗ Call log access needed — tap the button below")
            append("\n").append(if (!Alerts.canNotify(this@MainActivity)) "✗ Notifications are off — tap Allow notifications" else if (Prefs.alertsOk(this@MainActivity)) "✓ Live alerts connected" else "… Live alerts reconnecting (they resume by themselves)")
            append("\nLeads on this phone: ${Prefs.numbers(this@MainActivity).size}")
            append("\nLast sync: ${Prefs.lastSyncText(this@MainActivity)}")
            append("\nCalls sync by themselves whenever the phone is online — nothing to press.")
        }
        renderPending()
    }

    /** Calls the user started with the CALL button in the web CRM. Tapping one opens the normal phone dialer. */
    private fun renderPending() {
        pendingList.removeAllViews()
        val pending = try { JSONArray(Prefs.pendingJson(this)) } catch (e: Exception) { JSONArray() }
        if (pending.length() == 0) {
            pendingList.addView(TextView(this).apply { text = "Nothing waiting. Tap CALL on a lead in the CRM." })
            return
        }
        for (i in 0 until pending.length()) {
            val p = pending.getJSONObject(i)
            val phone = p.optString("phone")
            pendingList.addView(Button(this).apply {
                text = "📞  ${p.optString("lead_name")}  ·  $phone"
                setAllCaps(false)
                setOnClickListener { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:+91$phone"))) }
            })
        }
    }

    private fun signIn() {
        val url = findViewById<EditText>(R.id.urlInput).text.toString().trim().trimEnd('/')
        val email = findViewById<EditText>(R.id.emailInput).text.toString().trim()
        val password = findViewById<EditText>(R.id.passwordInput).text.toString()
        if (!url.startsWith("https://") && !url.startsWith("http://")) { say("Enter the CRM address starting with https://"); return }
        if (email.isEmpty() || password.isEmpty()) { say("Enter your CRM email and password"); return }
        say("Signing in…")
        Thread {
            try {
                val body = JSONObject().put("email", email).put("password", password)
                    .put("client", "companion").put("device_name", "${Build.MANUFACTURER} ${Build.MODEL}")
                val res = Api.request(this, "POST", "/api/auth/login", body, auth = false, baseUrl = url)
                Prefs.saveLogin(this, url, res.getString("token"), res.getJSONObject("user").optString("name"))
                SyncWorker.schedulePeriodic(this)
                Prefs.setLastAlertId(this, -1L)          // start fresh: only alerts from now on
                runOnUiThread {
                    Alerts.createChannels(this); AlertService.start(this)
                    if (!Alerts.canNotify(this)) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
                    findViewById<EditText>(R.id.passwordInput).setText("")
                    say("Signed in. Calls to your leads will now be logged automatically.")
                    render()
                    if (!CallSync.hasCallLogPermission(this)) askPermissions() else syncNow(silent = true)
                }
            } catch (e: Exception) {
                runOnUiThread { say(e.message ?: "Could not reach the CRM. Check the address and your internet connection.") }
            }
        }.start()
    }

    private fun syncNow(silent: Boolean = false) {
        if (!silent) say("Syncing…")
        Thread {
            try {
                val s = CallSync.run(this)
                runOnUiThread { if (!silent) say(s.message); render() }
            } catch (e: ApiException) {
                if (e.code == 401) Prefs.clear(this)
                runOnUiThread { say(if (e.code == 401) "You were signed out. Please sign in again." else e.message ?: "Sync failed"); render() }
            } catch (e: Exception) {
                runOnUiThread { if (!silent) say("Could not reach the CRM — will retry automatically."); render() }
            }
        }.start()
    }

    private fun signOut() {
        val ctx = this
        Thread {
            try { Api.request(ctx, "POST", "/api/auth/logout", JSONObject()) } catch (e: Exception) { /* offline: still sign out locally */ }
            SyncWorker.cancelAll(ctx)
            AlertService.stop(ctx)
            Prefs.clear(ctx)
            runOnUiThread { say("Signed out."); render() }
        }.start()
    }

    private fun askPermissions() {
        requestPermissions(arrayOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        render()
        if (requestCode == 2) return
        if (CallSync.hasCallLogPermission(this)) syncNow()
        else say("Without call log access the app cannot read call durations. You can allow it in Settings → Apps → RealtyPilot Companion → Permissions.")
    }

    private fun say(text: String) { messageText.text = text }
}
