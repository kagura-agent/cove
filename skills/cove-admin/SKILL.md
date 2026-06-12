---
name: "cove-admin"
description: "Manage Cove channels and server settings via REST API. Create, list, update, delete channels."
version: "v1"
date: "2026-06-12"
---

# Cove Admin

Manage Cove server resources (channels, etc.) via the REST API.

## When to use

- Creating, listing, updating, or deleting channels
- Managing server/guild settings
- Any Cove admin operation that goes through the REST API

## Config

Reads from `~/.openclaw/openclaw.json`:
```json
{
  "channels": {
    "cove": {
      "token": "<bot-token>",
      "baseUrl": "https://staging.cove.kagura-agent.com",
      "guildId": "<guild-id>"
    }
  }
}
```

**API prefix is `/api/v10`** (not `/api/v1`).

## Channel Management

```bash
SCRIPT="node $(dirname "$0")/scripts/cove-admin.mjs"

# Create channel
$SCRIPT channel create --name <name> [--topic <topic>]

# List channels
$SCRIPT channel list

# Update channel
$SCRIPT channel update --id <channel-id> [--name <name>] [--topic <topic>]

# Delete channel
$SCRIPT channel delete --id <channel-id>
```

## Direct API Usage

If the script doesn't cover your case, call the API directly:

```javascript
const fs = require('fs');
const c = JSON.parse(fs.readFileSync(process.env.HOME + '/.openclaw/openclaw.json', 'utf-8'));
const cove = c.channels.cove;
const API = cove.baseUrl + '/api/v10';
const headers = { Authorization: 'Bot ' + cove.token, 'Content-Type': 'application/json' };

// Example: create channel
fetch(`${API}/guilds/${cove.guildId}/channels`, {
  method: 'POST', headers,
  body: JSON.stringify({ name: 'my-channel', topic: 'description' })
}).then(r => r.json()).then(console.log);
```

## Key Endpoints

| Action | Method | Path |
|--------|--------|------|
| List channels | GET | `/api/v10/guilds/{guildId}/channels` |
| Create channel | POST | `/api/v10/guilds/{guildId}/channels` |
| Update channel | PATCH | `/api/v10/channels/{channelId}` |
| Delete channel | DELETE | `/api/v10/channels/{channelId}` |

## Notes

- Bot token uses `Bot ` prefix in Authorization header (same as Discord)
- Channel names are lowercase, no spaces (use hyphens)
- The guild ID is fixed per deployment, stored in config
