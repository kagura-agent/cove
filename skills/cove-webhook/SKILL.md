---
name: "cove-webhook"
description: "Send cross-channel messages in Cove via webhooks. Use when sending messages that should trigger bot response in target channel."
status: active
version: "v1"
date: "2026-06-11T02:00:12.518Z"
---

# Cove Webhook

Send messages from one Cove channel to another via webhook. Webhook messages bypass bot self-echo filtering, so the target channel's bot can receive and respond.

## When to use

- Cross-channel messaging where target bot must respond (e.g. sending PR to #code-review for review)
- NOT for display-only notifications — use `openclaw message send` for those

## Workflow

1. Run the send script:
```bash
node ~/.openclaw/workspace-ruantang/cove/scripts/cove-webhook-send.mjs \
  --to <target-channel-name> \
  --from <source-channel-name> \
  --message "<text>"
```

The script source lives in the Cove repo at `scripts/cove-webhook-send.mjs`.

2. The script will:
   - Read bot token and base URL from `~/.openclaw/openclaw.json`
   - Resolve channel names to IDs via guild channels API
   - Find or create a webhook on the target channel (cached locally)
   - Execute the webhook with `username: "From #<source>"`

## Examples

```bash
# Send PR review request from #cove-dev to #code-review
node ~/.openclaw/workspace-ruantang/cove/scripts/cove-webhook-send.mjs \
  --to code-review \
  --from cove-dev \
  --message "请 review PR #294: https://github.com/kagura-agent/cove/pull/294"

# Send notification from #garden to #general
node ~/.openclaw/workspace-ruantang/cove/scripts/cove-webhook-send.mjs \
  --to general \
  --from garden \
  --message "New feature landed: webhook support!"
```

## Notes

- Webhook cache: `~/.openclaw/workspace-ruantang/.cove-webhooks.json`
- If webhook is deleted externally, script auto-detects 404 and recreates
- Rate limit: respects 429 Retry-After from Cove server
- Username override shows "From #source-channel" as message author