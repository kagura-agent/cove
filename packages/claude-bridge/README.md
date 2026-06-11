# @cove/claude-bridge

A lightweight Node.js daemon that bridges [Cove](https://github.com/anthropics/cove) (a self-hosted Discord-like chat app) with a local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

## Architecture

```
Cove Server (remote)              Local machine
┌─────────────┐                   ┌─────────────────┐
│  Gateway WS  │◄── WebSocket ───│  Bridge daemon   │
│  REST API    │◄── HTTP ────────│    ↕ stdin/stdout │
└─────────────┘                   │  Claude Code CLI │
                                  └─────────────────┘
```

The bridge connects to Cove's WebSocket gateway as a bot user, listens for messages, pipes them to Claude Code via `stream-json` I/O, and writes responses back to Cove channels through the REST API.

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

Or if installed globally / via `npx`:

```bash
cove-claude-bridge
```

## How it works

1. **Gateway connection**: Connects to Cove's Discord-compatible WebSocket gateway and authenticates as a bot
2. **Message handling**: Listens for `MESSAGE_CREATE` events, ignoring bot messages to prevent echo loops
3. **Claude process management**: Spawns one `claude` CLI process per channel using `stream-json` I/O format
4. **Streaming responses**: As Claude generates text, the bridge sends/edits messages in the Cove channel with debounced updates (300ms batching)
5. **Typing indicators**: Shows typing status while Claude is processing
6. **Session persistence**: Each channel gets a deterministic session ID derived from the channel ID, so Claude can resume conversations across bridge restarts
7. **Auto-reconnect**: Gateway disconnections are handled with exponential backoff and RESUME support

## Claude Code CLI flags

The bridge spawns Claude with:

```
claude --print \
  --input-format stream-json \
  --output-format stream-json \
  --session-id <deterministic-uuid> \
  --dangerously-skip-permissions
```

## Development

```bash
# Type check
pnpm run check

# Build
pnpm run build
```

## Limitations (MVP)

- No file/attachment handling
- Message content truncated at 2000 characters (Discord limit)
- No thread/reply support
- No slash commands
- Tool calls and thinking events from Claude are silently ignored
