package com.realtypilot.companion

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val code: Int, message: String) : Exception(message)

/** Talks to the existing CRM API with the same sign-in token the web app uses. Call from a background thread. */
object Api {
    fun request(ctx: Context, method: String, path: String, body: JSONObject? = null, auth: Boolean = true, baseUrl: String? = null, readTimeoutMs: Int = 20000): JSONObject {
        val base = (baseUrl ?: Prefs.baseUrl(ctx)).trimEnd('/')
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15000
            conn.readTimeout = readTimeoutMs
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "RealtyPilotCompanion/1.0 (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})")
            if (auth) conn.setRequestProperty("Authorization", "Bearer " + Prefs.token(ctx))
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) throw ApiException(code, json.optString("error", "Server error ($code)"))
            return json
        } finally {
            conn.disconnect()
        }
    }
}
