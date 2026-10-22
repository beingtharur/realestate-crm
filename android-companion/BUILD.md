# Build the RealtyPilot Android app (APK) — 10 minutes

You need: **Android Studio** (free, https://developer.android.com/studio). Nothing else — it brings its own Java and downloads Gradle.

1. **Put your live CRM address in the app (recommended).** Open `android-companion/gradle.properties` and set
   `crmUrl=https://your-crm.onrender.com` (no slash at the end). Reps then never type it. Leave it empty to make each rep type it once.
2. Open Android Studio → **Open** → choose the `android-companion` folder. Wait for "Gradle sync" to finish (first time downloads ~1 GB; it may ask to install
   Android SDK 35 — click *Install*). If it asks which Gradle to use, choose the one from `gradle-wrapper.properties`.
3. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**. When it says *APK(s) generated*, click **locate**.
   The file is `app/build/outputs/apk/debug/app-debug.apk`.
4. **Share it:** WhatsApp refuses `.apk` files. Either rename it to `RealtyPilot.apk.zip` before sending (reps rename it back to `.apk` after downloading),
   or upload it to Google Drive and send the link.
5. **Install on a phone (Android 8 or newer):** open the file → allow "Install unknown apps" for the app you opened it from → Install.
   Play Protect may say "unknown developer" — tap *Install anyway* (it is your own app, not on the Play Store).

## First test on a phone (5 minutes)
1. Open the app → (enter the CRM address if asked) → sign in on the CRM page with a rep's email and password.
2. Allow **Phone / Call logs**, **Notifications** (and battery, if asked).
3. In the CRM open a lead → tap **Call** → talk 10 seconds → hang up → within a minute the call shows on the lead's timeline.
4. Create a lead from the admin's computer, assigned to that rep → the phone should buzz with a notification; tapping it opens that lead inside the app.
5. Turn the phone sideways, then back; open the keyboard in a form (Add lead) — fields must stay visible.
6. On Xiaomi / Oppo / Vivo / Realme / Samsung: Settings → Apps → RealtyPilot → Battery → **Unrestricted**, otherwise sync can be delayed.

## If the build fails
Copy the red error text from Android Studio's *Build* tab and send it — most fixes are one line.
