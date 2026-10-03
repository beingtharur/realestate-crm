# RealtyPilot Companion (Android)

A small helper app for sales reps. It is **not** a CRM and **not** a dialer. It does one thing:

> After you finish a normal phone call with one of your CRM leads, it reads the call's start time and
> duration from the phone's own call log and adds it to that lead's timeline in RealtyPilot.

No recording, no transcription, no cloud telephony, no extra cost — calls go through the rep's normal SIM.

## How it works

```
Rep taps CALL on a lead in the web CRM ──► CRM saves a "waiting for phone" entry and opens the phone dialer
Rep talks and hangs up as usual
Android tells the app the call ended ──► app reads the call log
App uploads the call (number, in/out, start time, duration) ──► CRM completes the entry on the lead
Lead timeline:  Outgoing call · Completed · Duration: 04:32
```

* Calls dialled straight from the phone (without the CRM) and incoming calls from leads are logged too.
* **Privacy:** the app first downloads the list of the rep's lead numbers. Only calls to/from those numbers
  are uploaded. Personal calls never leave the phone. Calls made before signing in are never uploaded.
* The same call is never stored twice (each upload carries the phone's call-log id).

## Build and install

The project **builds** (debug APK, Gradle 8.9 + Android Gradle Plugin 8.7, JDK 17, lint has warnings only) but it has
**not been run on a real phone yet** — test it on one phone before rolling out to the team.

Command-line build (what was used): with JDK 17, the Android SDK (platform 35, build-tools) and Gradle 8.9 installed,
```bash
echo "sdk.dir=/path/to/android/sdk" > local.properties
gradle :app:assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```
Or use Android Studio:

1. Install **Android Studio** (free). Open this `android-companion` folder as a project and let it sync
   (it downloads Gradle 8.9, the Android Gradle plugin 8.7 and WorkManager).
   If it asks for a Gradle wrapper, accept — or run `gradle wrapper` once in this folder.
2. Plug in an Android phone (Android 8.0 or newer) with USB debugging on, press **Run**.
3. For the team: **Build → Build APK(s)** and share the APK file, or use a private channel
   (managed Google Play / an MDM). See "Play Store" below.

## First use (each rep)

1. Open the app, enter the CRM address (e.g. `https://crm.yourcompany.com`), CRM email and password.
   The password is used once to sign in and is **not stored** — only the sign-in token is.
2. Allow **Call logs** and **Phone** permissions when asked.
3. In the web CRM: avatar → **My profile** shows "📱 Linked".
4. Turn off battery optimisation for the app on Xiaomi / Oppo / Vivo / Realme / Samsung phones
   (Settings → Apps → RealtyPilot Companion → Battery → Unrestricted), otherwise sync can be delayed.

Testing against a CRM on your laptop: use a **debug** build and the laptop's LAN address,
e.g. `http://192.168.1.10:3100` (debug builds allow `http://`; release builds require `https://`).

## What Android does and does not allow

| Topic | Reality |
|---|---|
| **Play Store** | Google restricts `READ_CALL_LOG` to default dialer/assistant apps. A public listing will be rejected unless Google grants an exception. Distribute the APK directly or through managed/private Google Play. |
| **Duration** | Comes from the phone's call log — the same number the rep sees in the Phone app. On most phones outgoing duration counts from when the other side answers. |
| **Outgoing call, 0 seconds** | Android does not say whether it was unanswered, busy, switched off or declined. All show as **No Answer**. |
| **Rejected** | Only known for *incoming* calls the rep declined. |
| **Failed** | Shown when the rep tapped CALL in the CRM but no call record arrived within 2 hours (dialer closed, no network, app not syncing). The rep can tap "Log result" on the timeline. |
| **Timing** | Sync runs a few seconds after hanging up. If the phone delays background work, it runs within ~15 minutes or as soon as the app is opened. |
| **Dual SIM** | Calls from either SIM are read. The app does not record which SIM was used. |
| **WhatsApp / VoIP calls** | Not in the phone's call log, so not captured. |
| **iPhone** | iOS does not let any app read call history. iPhone users get a "Log call" prompt in the web CRM instead. |

## CRM endpoints the app uses (all existing sign-in rules apply)

| Call | Purpose |
|---|---|
| `POST /api/auth/login` with `client: "companion"`, `device_name` | Normal CRM login; marks the session as a phone |
| `GET /api/device/sync` | The rep's lead numbers + calls waiting to be made |
| `POST /api/device/calls` `{ calls: [{ ext_id, phone, type, started_at, duration }] }` | Finished calls. `type`: outgoing / incoming / missed / rejected / blocked / voicemail |
| `POST /api/auth/logout` | Sign out |

## Files

```
app/src/main/AndroidManifest.xml      permissions + call-ended receiver
app/src/main/java/.../CallSync.kt     the logic: read call log → filter to lead numbers → upload
app/src/main/java/.../SyncWorker.kt   background runs (after a call, every 15 min)
app/src/main/java/.../PhoneStateReceiver.kt   "a call just ended"
app/src/main/java/.../MainActivity.kt the one screen
app/src/main/java/.../Api.kt, Prefs.kt        HTTP + storage
```


## Live alerts and automatic sync (v1.1)

* **Alerts:** `AlertService` (a small foreground service, notification "RealtyPilot is on") keeps one long request open to the CRM and shows
  new leads, follow-up and site-visit reminders as phone notifications within seconds. Tap opens the lead in the CRM; the button on the
  notification (Call / WhatsApp client) opens the dialer or WhatsApp with the message ready. Do-not-disturb hours arrive silently.
  No Firebase/Google services are used, so it works with a self-hosted CRM.
* **Automatic sync:** calls upload right after a call ends, whenever internet returns (network callback), after a reboot or app update
  (`BootReceiver`), and every 15 minutes (WorkManager). Calls made offline stay in the phone's call log and are uploaded later — the sync
  only moves forward after a successful upload. There is nothing to press; *Check now* is only for impatient moments.
* **First run:** allow Notifications (Android 13+) and set battery to *Unrestricted*; the app asks for both.
