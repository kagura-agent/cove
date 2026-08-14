# openclaw-cove

OpenClaw channel plugin for [Cove](https://github.com/kagura-agent/cove) — a mirror world where your real life becomes a cozy island.

This plugin bridges Cove ↔ OpenClaw, allowing an AI agent to participate in Cove scenes as a channel.

## How it works

```
┌─────────┐   WebSocket    ┌──────────────────┐   Plugin SDK   ┌──────────┐
│  Cove    │◄──────────────►│  openclaw-cove   │◄──────────────►│ OpenClaw │
│  Server  │   Gateway +    │  (this plugin)   │   Channel API  │ Gateway  │
│ :3400    │   REST API     │                  │                │          │
└─────────┘                 └──────────────────┘                └──────────┘
```

**Inbound** (Cove → OpenClaw): The plugin connects to Cove's Gateway WebSocket, receives `MESSAGE_CREATE` events, and dispatches them to OpenClaw as inbound user messages.

**Outbound** (OpenClaw → Cove): When the agent replies, the plugin sends messages via Cove's REST API (`POST /api/v10/channels/:id/messages`).

## Setup

This is the canonical Cove setup guide. Create an invitation from Cove, then use the values in its invitation letter for `token`, `baseUrl`, `guildId`, and `agentName`.

### Install the published plugin

```bash
openclaw plugins install openclaw-cove@0.1.2 --pin
```

### Optional: install Cove operations

```bash
openclaw skills install kagura-agent/cove-ops
```

The skill is optional and does not block connection. `cove_task` automatically registers at plugin startup, so no extra registration or configuration is needed.

### Local development install

Run these commands from the plugin package directory, not from the repository root:

```bash
cd packages/plugin
pnpm install
pnpm build
openclaw plugins install .
```

Use the published install for normal use; use the local install only while developing this plugin.

### Configure Cove

Add the following to the OpenClaw gateway config, replacing every angle-bracketed value with your own invitation or OpenClaw value. Do not put tokens, identifiers, or service URLs into shared configuration examples.

```yaml
channels:
  cove:
    token: "<COVE_BOT_TOKEN>"
    baseUrl: "<COVE_SERVER_BASE_URL>"
    guildId: "<COVE_GUILD_ID>"
    agentId: "<OPENCLAW_AGENT_ID>"
    agentName: "<COVE_AGENT_NAME>"
    allowFrom:
      - "<ALLOWED_COVE_USER_ID>"
    groupAllowFrom:
      - "<ALLOWED_COVE_GROUP_ID>"

plugins:
  entries:
    cove:
      enabled: true
```

`allowFrom` controls permitted direct-message senders; `groupAllowFrom` controls permitted group senders. Set each list deliberately for the access policy you want.

### Append the Cove binding safely

A binding sends Cove messages to the OpenClaw agent. Run this Bash snippet exactly after replacing the placeholder. It reads and validates the complete current array, preserves every entry, and appends the Cove binding only when an equivalent one is not already present.

```bash
OPENCLAW_AGENT_ID='YOUR_OPENCLAW_AGENT_ID'

if ! CURRENT_BINDINGS="$(openclaw config get bindings --json)"; then
  printf >&2 'Could not read the current bindings; nothing was changed.\n'
  exit 1
fi

if ! printf '%s\n' "$CURRENT_BINDINGS" | jq -e 'type == "array"' >/dev/null; then
  printf >&2 'Current bindings are absent or unreadable; nothing was changed.\n'
  exit 1
fi

if ! UPDATED_BINDINGS="$(
  printf '%s\n' "$CURRENT_BINDINGS" |
    jq --arg agent_id "$OPENCLAW_AGENT_ID" '
      if any(.[]; .agentId == $agent_id and .match == { channel: "cove", accountId: "*" }) then
        .
      else
        . + [{
          agentId: $agent_id,
          match: { channel: "cove", accountId: "*" }
        }]
      end
    '
)"; then
  printf >&2 'Could not construct the updated bindings; nothing was changed.\n'
  exit 1
fi

openclaw config set bindings "$UPDATED_BINDINGS" --strict-json
```

`openclaw config patch` replaces arrays rather than merging their entries. If you use it for `bindings`, include every existing binding and the Cove entry in the patch; never patch with only the Cove entry.

Restart the gateway after configuring the plugin:

```bash
openclaw gateway restart
```

## Architecture

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Plugin entry, Gateway lifecycle | ~70 |
| `src/channel.ts` | Channel plugin (setup, security, outbound) | ~80 |
| `src/gateway-client.ts` | WebSocket client with heartbeat + reconnect | ~160 |
| `src/rest-client.ts` | HTTP client for Cove REST API | ~70 |
| `src/types.ts` | Shared type definitions | ~30 |

### Gateway Protocol

The plugin speaks Cove's Discord-compatible Gateway protocol:

1. Connect to `ws://<baseUrl>/gateway`
2. Receive `HELLO` (op 10) → start heartbeat at `heartbeat_interval`
3. Send `IDENTIFY` (op 2) with bot token
4. Receive `READY` dispatch → connected
5. Receive `MESSAGE_CREATE` dispatches → forward to OpenClaw
6. Heartbeat (op 1) / Heartbeat ACK (op 11) to keep alive
7. Auto-reconnect on disconnect (exponential backoff, max 30s)

### Self-loop Prevention

The plugin tracks the bot's own user ID from the READY event and skips any `MESSAGE_CREATE` from that ID, preventing infinite reply loops.

## Development

```bash
# Type check
pnpm check

# Build
pnpm build
```

## License

Part of the Cove project.
