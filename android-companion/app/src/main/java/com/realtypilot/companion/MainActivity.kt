package com.realtypilot.companion

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.webkit.DownloadListener
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.File

/**
 * One app: the CRM runs inside a web view, and the phone-only jobs (call log sync, live alerts) run behind it.
 * The rep signs in once, on the CRM's own sign-in page; the page hands the token to [Bridge.session] and everything else follows.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var setupGroup: View
    private lateinit var messageText: TextView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var geoCallback: GeolocationPermissions.Callback? = null
    private var geoOrigin: String? = null
    private var pendingHash: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        setupGroup = findViewById(R.id.setupGroup)
        messageText = findViewById(R.id.messageText)
        findViewById<Button>(R.id.openButton).setOnClickListener { saveAddress() }
        configureWebView()
        pendingHash = intent?.getStringExtra("hash") ?: ""
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        showCrm()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val hash = intent.getStringExtra("hash") ?: return
        if (hash.startsWith("#")) web.evaluateJavascript("location.hash=" + JSONObject.quote(hash), null)
    }

    override fun onResume() {
        super.onResume()
        if (Prefs.isSignedIn(this)) { Alerts.createChannels(this); AlertService.start(this); Thread { try { CallSync.run(this) } catch (e: Exception) { /* retried by the background sync */ } }.start() }
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack() else super.onBackPressed() }

    private fun showCrm() {
        val base = Prefs.baseUrl(this)
        if (base.isEmpty()) { web.visibility = View.GONE; setupGroup.visibility = View.VISIBLE; return }
        setupGroup.visibility = View.GONE; web.visibility = View.VISIBLE
        if (web.url == null) web.loadUrl(base.trimEnd('/') + "/" + pendingHash)
    }

    private fun saveAddress() {
        val url = findViewById<EditText>(R.id.urlInput).text.toString().trim().trimEnd('/')
        if (!url.startsWith("https://") && !url.startsWith("http://")) { messageText.text = "Enter the address starting with https://"; return }
        Prefs.setBaseUrl(this, url)
        showCrm()
    }

    private fun sameSite(uri: Uri): Boolean = Uri.parse(Prefs.baseUrl(this)).let { it.host != null && it.host == uri.host && it.port == uri.port }

    private fun configureWebView() {
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = true
            setGeolocationEnabled(true)
            userAgentString = "$userAgentString RealtyPilotApp/1.2"
        }
        // The CRM only ever talks to itself; the bridge below is reachable only from pages on the saved CRM address.
        web.addJavascriptInterface(Bridge(), "RPNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "http" || u.scheme == "https") { if (sameSite(u)) return false }
                try { startActivity(Intent(if (u.scheme == "tel") Intent.ACTION_DIAL else Intent.ACTION_VIEW, u)) } catch (e: Exception) { /* no app to open it */ }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                return try { startActivityForResult(params.createIntent(), 11); true } catch (e: Exception) { fileCallback = null; false }
            }
            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) callback.invoke(origin, true, false)
                else { geoCallback = callback; geoOrigin = origin; requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 3) }
            }
        }
        web.setDownloadListener(DownloadListener { url, ua, disp, mime, _ ->
            try {
                val name = android.webkit.URLUtil.guessFileName(url, disp, mime)
                val req = DownloadManager.Request(Uri.parse(url)).setMimeType(mime).addRequestHeader("User-Agent", ua)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
                getSystemService(DownloadManager::class.java).enqueue(req)
                Toast.makeText(this, "Downloading $name", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { Toast.makeText(this, "Could not download the file", Toast.LENGTH_SHORT).show() }
        })
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 11) { fileCallback?.onReceiveValue(android.webkit.WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            3 -> { geoCallback?.invoke(geoOrigin, grantResults.any { it == PackageManager.PERMISSION_GRANTED }, false); geoCallback = null }
            1 -> if (CallSync.hasCallLogPermission(this)) Thread { try { CallSync.run(this) } catch (e: Exception) { } }.start()
                 else Toast.makeText(this, "Allow call log access in Settings → Apps → RealtyPilot to log calls automatically", Toast.LENGTH_LONG).show()
        }
        if (requestCode == 1 || requestCode == 2) askNext()
    }

    /** Ask for each phone permission once, one after the other, right after the first sign-in. */
    private fun askNext() {
        if (!CallSync.hasCallLogPermission(this)) { requestPermissions(arrayOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE), 1); return }
        if (!Alerts.canNotify(this)) { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2); return }
        if (!getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName) && !Prefs.askedBattery(this)) {
            Prefs.setAskedBattery(this)
            try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (e: Exception) { /* not available on this phone */ }
        }
    }

    /** What the CRM page can ask the app to do. Runs on a background thread, so anything visual goes through runOnUiThread. */
    inner class Bridge {
        /** Called by the page after sign-in (and on every start while signed in). */
        @JavascriptInterface fun session(token: String, userName: String, orgName: String) {
            val ctx = this@MainActivity
            if (token.isEmpty()) return
            val first = !Prefs.isSignedInWith(ctx, token)
            if (first) { Prefs.saveLogin(ctx, Prefs.baseUrl(ctx), token, userName); Prefs.setLastAlertId(ctx, -1L) }
            Prefs.setOrg(ctx, orgName)
            runOnUiThread {
                SyncWorker.schedulePeriodic(ctx); Alerts.createChannels(ctx); AlertService.start(ctx)
                if (first) askNext() else Thread { try { CallSync.run(ctx) } catch (e: Exception) { } }.start()
            }
        }
        /** Called by the page when the rep signs out. */
        @JavascriptInterface fun signedOut() {
            val ctx = this@MainActivity
            SyncWorker.cancelAll(ctx); AlertService.stop(ctx); Prefs.clear(ctx)
        }
        /** Saves a file the page generated in memory (exports, templates) into the phone's Downloads. */
        @JavascriptInterface fun saveFile(name: String, mime: String, base64: String) {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
                if (Build.VERSION.SDK_INT >= 29) {
                    val cv = ContentValues().apply { put(MediaStore.Downloads.DISPLAY_NAME, safe); put(MediaStore.Downloads.MIME_TYPE, mime); put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS) }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)!!
                    contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)!!; File(dir, safe).writeBytes(bytes)
                }
                runOnUiThread { Toast.makeText(this@MainActivity, "Saved $safe to Downloads", Toast.LENGTH_LONG).show() }
            } catch (e: Exception) { runOnUiThread { Toast.makeText(this@MainActivity, "Could not save the file", Toast.LENGTH_SHORT).show() } }
        }
        /** Lets the page know it is running inside the app, and whether call logging is switched on. */
        @JavascriptInterface fun callLogAllowed(): Boolean = CallSync.hasCallLogPermission(this@MainActivity)
    }
}
