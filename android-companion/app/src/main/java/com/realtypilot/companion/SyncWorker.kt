package com.realtypilot.companion

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Runs the sync in the background: right after a call ends, and every 15 minutes as a safety net. */
class SyncWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result = try {
        CallSync.run(applicationContext)
        try { Alerts.poll(applicationContext, 0) } catch (e: ApiException) { if (e.code == 401) throw e } catch (e: Exception) { /* safety-net poll only */ }
        AlertService.start(applicationContext)                                      // revive the live connection if Android stopped it
        Result.success()
    } catch (e: ApiException) {
        if (e.code == 401) { Prefs.clear(applicationContext); Result.failure() }   // signed out on the server
        else Result.retry()
    } catch (e: Exception) {
        Result.retry()                                                             // no network etc. — try again later
    }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedulePeriodic(ctx: Context) {
            val work = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("realtypilot-periodic", ExistingPeriodicWorkPolicy.KEEP, work)
        }

        /** A few seconds after hanging up, so Android has written the call to its log. */
        fun syncSoon(ctx: Context, delaySeconds: Long = 5) {
            val work = OneTimeWorkRequestBuilder<SyncWorker>().setInitialDelay(delaySeconds, TimeUnit.SECONDS).setConstraints(online).build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("realtypilot-after-call", ExistingWorkPolicy.REPLACE, work)
        }

        fun cancelAll(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork("realtypilot-periodic")
            WorkManager.getInstance(ctx).cancelUniqueWork("realtypilot-after-call")
        }
    }
}
