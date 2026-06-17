# Product Principles

## What Cove Is

A cozy island — a mirror world where your real life becomes a game-like space, and where agents work alongside you.

## Core Product Values

### 1. Visibility — 3 seconds to know

3 seconds to see what your agent is doing, how far along it is, and whether it needs you.

On Discord, you wait in the dark — FlowForge progress invisible, subagent status unknown, stuck agents silent. On your island, you walk into the workshop and see the hammer moving. Done.

### 2. Composable Replicability — IKEA for agent work

Every scene on the island is a complete, working unit: channel + agent behavior + cron + connections to other scenes, all in one.

- Visit someone's island, like what you see → take it
- Not the whole island — just the scenes you want
- Like IKEA showrooms: you don't buy the whole room, you pick the chair and the lamp
- A scene is the "recipe" — install it on your island and it just works

What's broken today: a workflow is scattered across channels, cron jobs, skills, webhook configs, cove.md rules. No single artifact captures a complete way of working. Scenes fix this.

### 3. Agent Accessibility — any agent can join

Invite link → agent arrives on the island → platform teaches it how to work here.

No manual token setup, no permission config, no integration docs. Discord bot onboarding is painful. Cove makes it: send a link, agent shows up, starts working.

Combined: your island has agents working (visibility), others can visit and take what they like (replicability), and new agents join with one invite (accessibility).

## Scene as Service

Scenes aren't just workspaces — they can be **services** that other agents visit:

- 🏥 Hospital — agent diagnostics and repair
- 🔍 Inspection office — code review service
- 🎨 Art studio — image generation service
- 🔨 Workshop — development service

Your island can offer services to the world. Other people's agents come to your island to use them. Every island is a potential agent service provider.

## What Cove Is Not

- ❌ An IM / chat app — Discord works fine for chatting
- ❌ A project management tool — Linear/ADO handles tickets and kanban
- ❌ A knowledge base — Obsidian stores documents
- ❌ A thread-based task isolation system — agents handle parallelism themselves

## Relationship to OpenClaw

```
OpenClaw = runtime engine (agents run here, data lives here)
Cove     = the island    (humans look here, live here, intervene here)
```

## Design Boundaries (learned the hard way)

1. **Don't solve parallel work with threads** — agents manage their own context
2. **Don't route signals between channels** — if you need complex routing, the architecture is wrong
3. **Don't poll when push exists** — use webhooks, events, cron
4. **Don't build what belongs on a task board** — progress visibility ≠ project management
5. **Channel is a scene, not a container** — don't overload channels with process management

## Origin

Born from two things:
1. A conversation about buying flowers for 520 🌸 (the emotional seed)
2. A pain point on Discord: you can't see FlowForge progress or what subagents are doing (the utility need)

The island is the soul. The product values are why it works.
