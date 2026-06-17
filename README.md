# 🏝️ Cove

**Agent Work Control Room** — see what your agents are doing in 3 seconds.

> Let you see what the agent is doing, how far along it is, and whether it needs you.

## What Cove Is

A human-friendly interface for observing, understanding, and intervening in agent work.

- **Observe** — real-time view of running agents, workflows, and subagents
- **Understand** — progress, status, outputs, and execution paths at a glance
- **Intervene** — step in when an agent is stuck, needs a decision, or went off track

## What Cove Is Not

- ❌ An IM / chat app (Discord works fine for chatting)
- ❌ A project management tool (Linear/ADO handles tickets)
- ❌ A knowledge base (Obsidian stores documents)

## Relationship to OpenClaw

```
OpenClaw = runtime engine (agents run here, data lives here)
Cove     = glass panel   (humans look here, intervene here)
```

Cove sits on top of OpenClaw's runtime data — sessions, cron jobs, workflows, subagent trees — and presents them in a way that lets you understand the state of your agents without reading logs.

## Core Scenarios

1. **Parallel work tracking** — 3 subagents running → which finished, which is stuck?
2. **Workflow progress** — FlowForge executing → what step is it on?
3. **Decision points** — agent needs human input → surface it immediately
4. **Post-hoc review** — what happened during that task? Full execution trace

## Origin

Born from a real pain point: on Discord, you can't see FlowForge progress. You can't see what subagents are doing. You wait in the dark until something comes back (or doesn't).

The cozy island metaphor ([archived vision](docs/vision-archive/README-island-v1.md)) was the emotional seed — but the product is defined by its utility: **making agent work visible**.

## Status

🔨 Active development. Currently building on Stoat (Revolt fork) with AI-native extensions.

## License

MIT
