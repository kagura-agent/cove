# Product Principles

## What Cove Is

A cozy island where your real life becomes a mirror world — and where you can see what your agents are doing.

## What Cove Is Not

- ❌ An IM / chat app — Discord works fine for chatting. Cove is not trying to be a better Discord.
- ❌ A project management tool — Linear/ADO handles tickets and kanban. Don't build boards.
- ❌ A knowledge base — Obsidian stores documents. Don't build a wiki.
- ❌ A thread-based task isolation system — agents handle parallelism themselves. Don't build complex routing.

## Core Utility (hidden behind scenes)

The island is the experience. Under the hood, the utility is:

- **Observe** — see what agents are doing in real-time
- **Understand** — progress, status, outputs at a glance
- **Intervene** — step in when an agent is stuck or needs a decision

These capabilities show up naturally through scenes (walk into the workshop, see what's happening), not through dashboards or log viewers.

## Relationship to OpenClaw

```
OpenClaw = runtime engine (agents run here, data lives here)
Cove     = the island    (humans look here, live here, intervene here)
```

## Design Boundaries (learned the hard way)

1. **Don't solve parallel work with threads** — agents manage their own context. Platform doesn't need to isolate tasks.
2. **Don't route signals between channels** — if you need complex routing, the architecture is wrong.
3. **Don't poll when push exists** — use webhooks, events, cron. Never poll.
4. **Don't build in the platform what belongs on a task board** — progress visibility ≠ project management.
5. **Channel is a scene, not a container** — don't overload channels with process management.

## Origin

Born from two things:
1. A conversation about buying flowers for 520 🌸 (the emotional seed)
2. A pain point on Discord: you can't see FlowForge progress or what subagents are doing (the utility need)

The island is the soul. The agent visibility is what makes it useful.
