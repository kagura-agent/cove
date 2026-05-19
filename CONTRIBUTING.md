# Contributing to Cove

## Project Management

**All work is managed through GitHub Issues and Pull Requests.**

### Workflow

1. **Issue first** — every feature, bug fix, or task starts as a GitHub Issue
2. **Branch** — create a feature branch from `main` (e.g. `feat/phase1-scaffold`, `fix/ws-reconnect`)
3. **Implement** — code on the branch, commit often
4. **PR** — open a Pull Request, link the related Issue(s)
5. **Review** — Luna reviews and approves
6. **Merge** — only after review approval

### Rules

- **Never push directly to `main`** — always go through a PR
- **One PR per feature/fix** — keep PRs focused and reviewable
- **PR description must explain what changed and why**
- **Tests must pass before requesting review**
- **Link Issues** — use `Closes #N` or `Fixes #N` in PR description

### Code Standards

- **TypeScript strict mode** — no `any` unless absolutely necessary
- **Code implementation via Claude Code** — subagents delegate coding to `claude --print --permission-mode bypassPermissions`
- **Tests required** — new features need tests, bug fixes need regression tests
- **Verify before claiming done** — `pnpm build` + `pnpm test` must pass

## Architecture

### Tech Stack

- **Full-stack TypeScript** (monorepo, pnpm workspaces)
- **Frontend**: Phaser 3 + Vite (pixel art game UI)
- **Backend**: Hono + SQLite (lightweight API + WebSocket)
- **Shared types**: `packages/shared` — used by both server and client

### Core Concept

Cove's backend is an **OpenClaw channel adapter** — it sits between the game UI and OpenClaw Gateway, just like the Discord or Zulip adapters:

```
Phaser Game UI ←→ Cove Backend ←→ OpenClaw Gateway
                (channel adapter)
```

- **Facing up (UI)**: HTTP API + WebSocket for scene data, messages, real-time updates
- **Facing down (OpenClaw)**: Registers as a channel provider; agent doesn't care if messages come from Discord or Cove

### Key Principle

The agent layer stays untouched. Cron, delivery, allowlist — all reused from OpenClaw. Cove only adds the game UI skin and the channel bridge.

## Phases

- **Phase 1**: Monorepo scaffolding + backend skeleton
- **Phase 2**: Phaser game map (pixel art island, character movement, scene interaction)
- **Phase 3**: Frontend ↔ Backend integration (walk into garden → see real messages)
- **Phase 4**: Life flows between scenes (buy flowers → plant → photograph)
