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

## Installation

```bash
# From the Cove monorepo
cd packages/plugin
pnpm install

# Install into OpenClaw
openclaw plugins install ./packages/plugin
```

## Configuration

Add to your OpenClaw gateway config:

```yaml
channels:
  cove:
    token: your-bot-token      # or set COVE_BOT_TOKEN env var
    baseUrl: http://localhost:3400
    guildId: cove
    allowFrom:
      - "*"                    # or specific user IDs
```

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `COVE_BOT_TOKEN` | Bot authentication token | — |
| `COVE_BASE_URL` | Cove server URL | `http://localhost:3400` |

Config values take precedence over environment variables.

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
