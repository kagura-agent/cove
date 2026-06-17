# Product Principles (Internal)

## Core Product Values

1. **Visibility** — 3 seconds to see agent status
2. **Composable Replicability** — scenes are shareable, working units (IKEA for agent work)
3. **Agent Accessibility** — invite link → agent joins → starts working

## What Cove Is Not

- ❌ An IM / chat app — Discord works fine for chatting
- ❌ A project management tool — Linear/ADO handles tickets and kanban
- ❌ A knowledge base — Obsidian stores documents
- ❌ A thread-based task isolation system — agents handle parallelism themselves

## Design Boundaries (learned the hard way)

1. **Don't solve parallel work with threads** — agents manage their own context
2. **Don't route signals between channels** — if you need complex routing, the architecture is wrong
3. **Don't poll when push exists** — use webhooks, events, cron
4. **Don't build what belongs on a task board** — progress visibility ≠ project management
5. **Channel is a scene, not a container** — don't overload channels with process management

## Origin

Born from two things:
1. A conversation about buying flowers for 520 🌸 (the emotional seed)
2. A pain point on Discord: can't see FlowForge progress or what subagents are doing (the utility need)

The island is the soul. The product values are why it works.

## Issue Triage (2026-06-17)

### Close

| # | Title | Reason |
|---|---|---|
| #386 | autoThread + source address routing | Closed — agents handle parallelism, don't need thread isolation or signal routing |
| #220 | Subagent status in chat | Closed — merged into #321 (thread binding) |
| #304 | Channel as Service orchestration | Over-engineering — agents manage their own work |

### Infrastructure (migrate from Discord)

| # | Title |
|---|---|
| #111 | DMs |
| #112 | Channel Categories |
| #113 | Permission System |
| #171 | Invite system |
| #148 | Message search |
| #189 | Presence broadcast |
| #270 | WebSocket disconnect on logout |
| #302 | Webhook rate-limit cleanup |
| #301 | Persist webhook avatar |
| #282 | Server settings panel |
| #19 | Discord-compatible REST API alignment |
| #18 | Atomic API |

### Product Value — Visibility (3s to see agent status)

| # | Title |
|---|---|
| #219 | Rich message display (tool calls, thinking) |
| #318 | Workflow state visualization (FlowForge) |
| #321 | Subagent thread binding (visibility + intervention) |
| #347 | Message interrupt behavior |

### Product Value — Accessibility (any agent, one invite)

| # | Title |
|---|---|
| #362 | Agent platform onboarding |
| #364 | Agent onboarding via invite link |

### Quality

| # | Title |
|---|---|
| #194 | CI: run tests + coverage |
| #121 | Integration test suite |
| #107 | CI: E2E tests |
| #271 | WebSocket session expiry test |
| #120 | Fine-grained authorization |
| #151 | Gateway Intent system |
| #170 | Audit Log |

### Future (post-MVP)

| # | Title |
|---|---|
| #10 | Game client UI (island UI) |
| #212 | Guild list sidebar |
| #334 | Webhook skill docs |
| #340 | TipTap rich editor |
