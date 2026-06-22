# Spec: Fix intermittent `scp -r` failure in staging deploy

**Issue:** #392
**Status:** Draft

## Problem

The `deploy-staging.yml` workflow uses `scp -r packages/client/dist/*` to upload the client build to the staging VM. When the glob expands to a mix of files and directories (e.g. `index.html`, `assets/`, `favicon.ico`), OpenSSH 9.x's default SFTP-based scp can race on mkdir for subdirectories — causing intermittent failures like:

```
scp: dest open ".../assets/index-CZJTeOtc.js": No such file or directory
```

This affects both the `deploy` job (PR push) and the `redeploy-main` job (PR close without merge), leaving staging pinned to a stale build.

## Solution

Replace the `scp -r` invocation with a **tar pipe** in both jobs:

```bash
tar -C packages/client/dist -cf - . | $SSH "mkdir -p /tmp/cove-staging-client-$GITHUB_RUN_ID && tar -C /tmp/cove-staging-client-$GITHUB_RUN_ID -xf -"
```

### Why tar pipe

| Approach | Pros | Cons |
|----------|------|------|
| `scp -O` (legacy protocol) | Minimal change | Still multiple round-trips; deprecated flag may be removed |
| **tar pipe** | Single stream, atomic, no SFTP semantics, faster | Slightly less readable |
| Copy dir then mv | Simple | Extra disk space, two commands |
| rsync | Cleanest | May not be installed on runner |

Tar pipe is the best balance: no SFTP race, single TCP stream, no extra dependencies (tar + ssh are always available on ubuntu runners), and faster than scp for many small files.

## Scope

Files changed: `.github/workflows/deploy-staging.yml`

Changes:
1. In the `deploy` job's "Deploy to VM1 (staging)" step — replace the `$SCP -r packages/client/dist/*` line with the tar pipe.
2. In the `redeploy-main` job's "Deploy main to staging" step — same replacement.
3. The `$SCP` variable assignment can stay (still used for `server-bundle.js` upload, which is a single file and won't race).

## Verification

- Push a PR with this change; the `deploy` job should succeed.
- Close the PR without merging; the `redeploy-main` job should succeed.
- Verify `/var/www/cove-staging/assets/` contains the expected JS/CSS files after deploy.
