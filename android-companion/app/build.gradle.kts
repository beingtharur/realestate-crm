plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.realtypilot.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.realtypilot.companion"
        minSdk = 26          // Android 8.0
        targetSdk = 35
        versionCode = 3
        versionName = "1.2"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // Background sync that survives app restarts and reboots. The only library the app uses.
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
