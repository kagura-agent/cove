# .cove/AGENTS.md — Agent Instructions for Cove

This file is automatically loaded by agents working in the Cove project.
Like `.claude/CLAUDE.md` for Claude Code, `.cove/AGENTS.md` provides project-level context and workflow instructions for AI agents operating within this repository.

## Development Workflow

1. **Develop** — Work in `#cove-dev` (Cove channel), push PRs. CI auto-deploys to staging.
2. **Verify behavior** — Luna reviews the deployed staging build for correctness. Wait for her confirmation before proceeding to code review.
3. **Code review** — Send the PR to `#code-review` via webhook (request results sent back to `#cove-dev`).
4. **Iterate on review** —
   - If review changes **alter behavior**: notify Luna to re-verify on staging.
   - If review changes are **code-only** (no behavior change): fix and continue review without interrupting Luna.
5. **Merge** — When code review passes unanimously, notify Luna for final review and merge.

## Code Conventions

- All contributions must be in **English** (code, comments, commits, PRs, issues).
- Code implementation must go through **Claude Code subagent** — do not write code directly.
- Always align with **Discord's patterns** when implementing features. If a difference from Discord is found, open an issue to track it.
- Every PR requires **multi-model code review** via the code-review skill before requesting Luna's review.

## Cross-Channel Messaging

- Use the `cove-webhook` skill to send messages between channels (e.g. `#cove-dev` → `#code-review`).
- When sending review requests, explicitly ask for results to be sent back to the source channel.
- Do not include the "send back" request in the skill itself — it is the sender's responsibility.

## Project Structure

```
packages/
  client/    — React frontend (Vite + Ant Design)
  server/    — Hono API server (SQLite + WebSocket)
  shared/    — Shared types (Discord-compatible)
  plugin/    — OpenClaw channel plugin
skills/      — Agent skills (e.g. cove-webhook)
.cove/       — Agent instructions (this directory)
```
