# Spec: Fix intermittent `scp -r` failure in staging deploy

**Issue:** #392
**Status:** Draft (R1 feedback addressed)

## Problem

The `deploy-staging.yml` workflow uses `scp -r packages/client/dist/*` to upload the client build to the staging VM. When the glob expands to a mix of files and directories (e.g. `index.html`, `assets/`, `favicon.ico`), OpenSSH 9.x's default SFTP-based scp can race on mkdir for subdirectories — causing intermittent failures like:

```
scp: dest open ".../assets/index-CZJTeOtc.js": No such file or directory
```

This affects both the `deploy` job (PR push) and the `redeploy-main` job (PR close without merge), leaving staging pinned to a stale build.

## Solution

Replace the `scp -r` client upload block with a **tar pipe** — a single SSH stream that transfers all files without SFTP semantics.

### Why tar pipe

- **Single stream** — no parallel mkdir race, no SFTP protocol
- **No extra dependencies** — tar + ssh are always available on ubuntu runners
- **Faster** — fewer round-trips for many small files
- **Not atomic** — the transfer itself is sequential (not a filesystem-level atomic swap), but eliminates the race condition that causes failures

### Before / After

Both `deploy` and `redeploy-main` jobs have this 3-line block for client upload:

**Before (current):**
```bash
$SSH "sudo rm -rf /tmp/cove-staging-client-$GITHUB_RUN_ID && mkdir -p /tmp/cove-staging-client-$GITHUB_RUN_ID"
$SCP -r packages/client/dist/* $USER@$HOST:/tmp/cove-staging-client-$GITHUB_RUN_ID/
$SSH "sudo rm -rf /var/www/cove-staging && sudo mkdir -p /var/www/cove-staging && sudo cp -r /tmp/cove-staging-client-$GITHUB_RUN_ID/* /var/www/cove-staging/ && rm -rf /tmp/cove-staging-client-$GITHUB_RUN_ID"
```

**After:**
```bash
$SSH "rm -rf /tmp/cove-staging-client && mkdir -p /tmp/cove-staging-client"
tar -C packages/client/dist -cf - . | $SSH "tar -C /tmp/cove-staging-client -xf -"
$SSH "sudo rm -rf /var/www/cove-staging && sudo mkdir -p /var/www/cove-staging && sudo cp -r /tmp/cove-staging-client/* /var/www/cove-staging/ && rm -rf /tmp/cove-staging-client"
```

Changes:
1. **Line 1** — Drop `$GITHUB_RUN_ID` suffix (unnecessary with tar pipe — no parallel scp race). Use plain `/tmp/cove-staging-client`. Drop `sudo` (user owns /tmp files).
2. **Line 2** — Replace `$SCP -r packages/client/dist/*` with tar pipe. Single stream, no glob expansion, no SFTP.
3. **Line 3** — Update path to match (drop `$GITHUB_RUN_ID` suffix). Logic unchanged: rm old → mkdir → cp from tmp → cleanup tmp.

### Why drop `$GITHUB_RUN_ID`

The original `$GITHUB_RUN_ID` suffix existed to avoid collisions if multiple deploys ran simultaneously. With `concurrency: group: staging-deploy, cancel-in-progress: true`, only one deploy runs at a time. The suffix adds no value and complicates the path references.

### Empty dist guard

Add a pre-check before tar to fail fast if build produced no output:

```bash
test -d packages/client/dist/assets || { echo "❌ Client build missing assets/"; exit 1; }
```

## Scope

**File:** `.github/workflows/deploy-staging.yml`

**Jobs affected:** `deploy` (lines ~70-72), `redeploy-main` (lines ~130-132)

**Other lines unchanged:** The `$SCP` variable, server bundle upload, systemd unit, health check — all stay as-is.

## Verification

- Push this PR → `deploy` job should succeed with tar pipe
- Close without merge → `redeploy-main` job should succeed
- Check `/var/www/cove-staging/assets/` has expected JS/CSS files
- Run `ls /var/www/cove-staging/` on VM to confirm structure is correct
