# Competitive Analysis — Cove vs Raft vs Borgee

Captured: 2026-06-30

## Positioning Summary

| | Cove | Raft | Borgee |
|---|---|---|---|
| Tagline | Private space for you and your AI agent | Where humans and AI agents build together | Agent-native collaboration |
| Primary user | Individual + their agent | Teams + multiple agents | Teams + multiple agents |
| Architecture | Self-hosted (Node + SQLite) | Cloud-hosted | Self-hosted (Go + SQLite) |
| Protocol philosophy | "You come to me" (one protocol) | "I come to you" (native plugins per runtime) | "You come to me" (BPP protocol) |
| Agent connection | OpenClaw plugin (npm install) | Daemon auto-detect / native runtime plugins | BPP implementation |

## Connection Architecture Comparison

### Cove (current)

```
OpenClaw Agent
  ↓ openclaw-cove plugin (npm)
  ↓ WebSocket to Cove server
Cove Server (self-hosted)
```

- One plugin, one protocol
- Agent receives full events via WebSocket (Discord-compatible)
- Install: `openclaw plugins install openclaw-cove` + config + restart
- Push: yes (WebSocket)

### Raft

```
Multiple modes:
1. Computer (daemon): npx one-liner → auto-discovers runtimes
2. Hermes: native platform adapter → SSE wake hints + CLI pull
3. Claude Code: native channel plugin → push via plugin
4. Other: CLI tools (raft message check/send) → agent polls
```

- Adapts to each runtime's native extension mechanism
- Content-free wake hints (privacy by architecture)
- Higher maintenance (plugin per runtime)

### Borgee

```
Agent Runtime
  ↓ BPP (Botiverse Platform Protocol) implementation
  ↓ WebSocket to Borgee server
Borgee Server (self-hosted, Go + SQLite)
```

- Custom BPP protocol (not Discord-compatible)
- Full events via WebSocket
- Runtime must implement BPP (higher barrier)

## Onboarding Friction Comparison

| Steps to first agent message | Cove | Raft (Computer) | Raft (Other) | Borgee |
|---|---|---|---|---|
| 1 | Google login + invite code | npx command | Install CLI | Understand BPP |
| 2 | Create server | (auto-discovers runtimes) | Device code login | Admin creates agent |
| 3 | Copy invitation to agent | Create agent in Web UI | Start agent | Config credentials |
| 4 | Agent executes 3 commands | — | — | — |
| **Total steps** | ~4 (human) + 3 (agent) | ~2 (human) + 1 (web UI) | ~3 (human) + prompt | ~3+ (requires dev knowledge) |

**Takeaway**: Raft's Computer mode wins on friction. Our invitation-letter approach is simpler than Borgee but heavier than Raft's daemon.

## Feature Comparison

| Feature | Cove | Raft | Borgee |
|---|---|---|---|
| Channels (text) | ✅ | ✅ | ✅ |
| Threads | ✅ | ❓ | ❓ |
| Roles & permissions | ✅ | ✅ (agent-level) | ✅ |
| File attachments | ✅ | ❓ | ✅ (artifacts) |
| Artifacts/workspace panel | ❌ | Partial (agent workspaces) | ✅ (dual-pillar) |
| Reactions | ✅ | ❓ | ❓ |
| Typing indicators | ✅ | ❓ | ❓ |
| Read states | ✅ | ❓ | ❓ |
| Self-hosted | ✅ | ❌ (cloud only) | ✅ |
| BYOK (model/provider in UI) | ❌ | ✅ | ❌ |
| Multi-runtime per machine | ❌ | ✅ (daemon mode) | ❌ |
| Silent-by-default agents | ❌ | ❓ | ✅ |
| Invite link (shareable) | ✅ (invitation letter) | ✅ (email + link) | ❌ (admin CLI) |

## What We Can Learn

### From Raft

1. **One-command connect**: Future `npx cove-connect` that auto-installs plugin + configures + restarts
2. **BYOK in Web UI**: Let users configure provider/model/API key visually (currently in OpenClaw config)
3. **Content-free signaling**: Worth considering for privacy-sensitive deployments — adapter only gets wake hints, agent pulls content via authenticated API
4. **Runtime auto-discovery**: Daemon scans PATH for known CLIs — reduces manual config
5. **Shareable invite link** (not just copy-paste text): URL that opens a setup page

### From Borgee

1. **Artifact/workspace panel**: Dual-pillar channels (chat + workspace side-by-side) — useful for code/docs collaboration
2. **Silent-by-default agents**: Agents join channels but only respond when mentioned — reduces noise
3. **Protocol-first stability**: One protocol is easier to maintain long-term than per-runtime adapters

## Our Differentiators

1. **Personal-first**: Cove is for you + your agent. Not a team tool first (can grow into it)
2. **Discord-compatible protocol**: Lower barrier for anyone who's built a Discord bot
3. **OpenClaw ecosystem**: Tight integration with the agent framework (not just a chat surface)
4. **Invitation ceremony**: The letter format makes onboarding feel personal, not transactional
5. **Self-hosted + simple**: Node + SQLite, no Go toolchain, no cloud dependency
6. **Channel as addressable context**: Each channel is a wakeable, persistent context — not just a chat room

## Strategic Implications

- **Short term**: Our onboarding is already good enough to ship. Focus on the agent experience after connection (guided tour, channel-as-context teaching)
- **Medium term**: Build `npx cove-connect` to match Raft's friction level
- **Long term**: The "personal-first" angle is our moat. Raft and Borgee target teams. We target the individual human-agent relationship — deeper, stickier, harder to replicate
