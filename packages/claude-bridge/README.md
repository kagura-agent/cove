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

## Prerequisites

- Node.js 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude --version`)
- A Cove server instance with a bot user created

## Installation

```bash
# Clone the monorepo
git clone https://github.com/kagura-agent/cove.git
cd cove

# Install dependencies
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
| `COVE_BOT_TOKEN` | ✅ | Bot authentication token (create a bot user in Cove, use its token) |
| `COVE_GUILD_ID` | ✅ | Guild ID (find via `GET /api/v10/users/@me/guilds` with bot auth) |
| `CLAUDE_WORKING_DIR` | ❌ | Working directory for Claude processes (default: cwd) |

### Getting a bot token

1. Create a bot user in your Cove instance (via API: `POST /api/v10/users` with `{ "username": "claude", "bot": true }`)
2. The response includes the bot's `token` — save it securely
3. Ensure the bot is a member of the target guild and has `VIEW_CHANNEL` permission on the channels you want it to respond in

## Usage

```bash
COVE_BASE_URL=https://your-cove-server.com \
COVE_BOT_TOKEN=your-bot-token \
COVE_GUILD_ID=your-guild-id \
CLAUDE_WORKING_DIR=/path/to/workspace \
  node dist/index.js
```

### Running as a systemd service

Create `~/.config/systemd/user/cove-claude-bridge.service`:

```ini
[Unit]
Description=Cove Claude Code Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/cove/packages/claude-bridge
ExecStart=/bin/bash -c 'COVE_BASE_URL=https://your-cove-server.com COVE_BOT_TOKEN=your-token COVE_GUILD_ID=your-guild-id CLAUDE_WORKING_DIR=/path/to/workspace node dist/index.js'
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now cove-claude-bridge
systemctl --user status cove-claude-bridge  # check it's running
```

## Updating

```bash
cd /path/to/cove
git pull
pnpm install
cd packages/claude-bridge
pnpm run build

# If using systemd:
systemctl --user restart cove-claude-bridge
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

## Security

The bridge spawns Claude Code with `--dangerously-skip-permissions`, which grants
it full shell and filesystem access on the host machine. This has important
security implications:

- **Guild members ≈ shell access.** Any user who can post in a bridged channel
  can execute arbitrary commands on the host via Claude. Treat guild membership
  as equivalent to SSH access.
- **Use a sandboxed account.** Run the bridge under a dedicated, least-privileged
  OS user. Do not run as root. Consider containers or VMs for additional isolation.
- **Restrict `COVE_GUILD_ID` to a trusted guild.** Only point the bridge at a
  guild whose members you fully trust. Do not use a public or open-invite guild.
- **Other bots can trigger execution.** The bridge filters out bot-authored
  messages to prevent echo loops, but if that check is removed or bypassed,
  any bot in the guild could trigger Claude commands. Ensure only trusted bots
  are present.
- **No prompt injection mitigation.** User messages are forwarded to Claude
  as-is. Malicious prompts could attempt to manipulate Claude's behavior.

## Limitations (MVP)

- No session persistence across messages (each message is a one-shot)
- No file/attachment handling
- Message content truncated at 2000 characters
- No thread/reply support
- No slash commands or project switching
- Tool calls and thinking events from Claude are silently ignored
- Only sanitized env vars (PATH, HOME, ANTHROPIC_API_KEY, etc.) are passed to child processes
