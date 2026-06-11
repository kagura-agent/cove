# @cove/claude-bridge

A lightweight Node.js daemon that bridges [Cove](https://github.com/kagura-agent/cove) (a self-hosted Discord-like chat app) with a local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

## Architecture

```
Cove Server (remote)              Local machine
┌─────────────┐                   ┌─────────────────┐
│  Gateway WS  │◄── WebSocket ───│  Bridge daemon   │
│  REST API    │◄── HTTP ────────│                   │
└─────────────┘                   │  Claude Code CLI │
                                  └─────────────────┘
```

The bridge connects to Cove's WebSocket gateway as a bot user, listens for messages, spawns Claude Code per message via `-p` flag, and writes responses back to Cove channels through the REST API.

## Setup

```bash
# From the monorepo root
pnpm install

# Build the bridge
cd packages/claude-bridge
pnpm run build
```

## Configuration

All configuration is via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `COVE_BASE_URL` | ✅ | Cove server URL (e.g. `https://staging.cove.kagura-agent.com`) |
| `COVE_BOT_TOKEN` | ✅ | Bot authentication token |
| `COVE_GUILD_ID` | ✅ | Guild ID to scope message handling |
| `CLAUDE_WORKING_DIR` | ❌ | Working directory for Claude processes (default: cwd) |

## Usage

```bash
COVE_BASE_URL=https://staging.cove.kagura-agent.com \
COVE_BOT_TOKEN=your-bot-token \
COVE_GUILD_ID=1512349650185617408 \
CLAUDE_WORKING_DIR=/path/to/workspace \
  node dist/index.js
```

## How it works

1. **Gateway connection**: Connects to Cove's Discord-compatible WebSocket gateway and authenticates as a bot
2. **Message handling**: Listens for `MESSAGE_CREATE` events, filtering by guild ID and ignoring bot messages to prevent echo loops
3. **Claude process management**: Spawns `claude --print -p "<message>"` per user message with `--output-format stream-json` for structured output
4. **Streaming responses**: As Claude generates text, the bridge sends/edits messages in the Cove channel with debounced updates (300ms batching)
5. **Typing indicators**: Shows typing status while Claude is processing
6. **Message queuing**: If a user sends a message while Claude is still processing, it's queued and dispatched after the current process exits
7. **Auto-reconnect**: Gateway disconnections are handled with exponential backoff and RESUME support

## Claude Code CLI flags

The bridge spawns Claude with:

```
claude --print \
  --verbose \
  --output-format stream-json \
  --dangerously-skip-permissions \
  -p "<user message>"
```

Each message spawns a fresh process. Sessions are independent (no cross-message context).

## Development

```bash
# Type check
pnpm run check

# Build
pnpm run build
```

## Limitations (MVP)

- No session persistence across messages (each message is a one-shot)
- No file/attachment handling
- Message content truncated at 2000 characters
- No thread/reply support
- No slash commands or project switching
- Tool calls and thinking events from Claude are silently ignored
- Only sanitized env vars (PATH, HOME, ANTHROPIC_API_KEY, etc.) are passed to child processes
