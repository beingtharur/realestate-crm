# Deploying RealtyPilot (Render)

## One-time setup
1. Push this repo to a **private** GitHub repository.
2. In Render: **New → Blueprint**, pick the repo. It reads `render.yaml` (one web service + 1 GB disk, Starter plan — the free plan has no disk and would lose all data).
3. When the service is live, open its URL **immediately** and create your organization and admin account. The very first sign-up is always allowed; after that, new organizations are blocked (`ALLOW_SIGNUP=false`).
4. Optional AI assistant: add `ANTHROPIC_API_KEY` under Render → Environment (never commit it).
5. Render → Settings: turn on a spending/budget alert, and enable 2-factor on your Render and GitHub accounts.
6. In GitHub → Settings → Branches, protect `main`: require a pull request and the "CI" check.

## Checks after every deploy (2 minutes)
- `https://<your-app>/healthz` shows `{"ok":true}`.
- Sign in, open Leads, add a test lead, delete it.
- Submit the public enquiry form 11 times from one phone: the 11th should be refused, but a different phone on another network must still get through (confirms `TRUST_PROXY` is right).

## Backups
- The app copies its database to `/data/backups` at start-up and every 24 h (newest 7 kept).
- Render also takes daily disk snapshots (kept at least 7 days).
- Take a copy off the server regularly: Render → Shell → `npm run backup`, then download the file with `scp`/Render's file transfer.

## Restore
1. Render → Suspend the service.
2. Open a Render Shell, then `cp /data/backups/<chosen file> /data/realtypilot.db` and delete `/data/realtypilot.db-wal` and `/data/realtypilot.db-shm`.
3. Resume the service and run the post-deploy checks.
Practise this once on a staging copy before you need it.

## Roll back a bad release
Render → Events → pick the previous successful deploy → **Rollback**. (Database changes are additive only, so the old version runs on the new database.)

## If a password or key leaks
Reset the user's password from Team & Targets (this signs out all their devices), regenerate the webhook secret in Settings, and revoke/replace the Anthropic key at console.anthropic.com.
