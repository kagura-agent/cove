# Architecture

## Overview

```
┌─────────────────────────────────┐
│  Game UI (2D pixel / cozy)      │  ← What users see
├─────────────────────────────────┤
│  Scene ↔ Channel bridge         │  ← Mapping layer
├─────────────────────────────────┤
│  Channel + Cron + Agent engine  │  ← What already works
└─────────────────────────────────┘
```

## Relationship to OpenClaw

```
OpenClaw = runtime engine (agents run here, data lives here)
Cove     = the island    (humans look here, live here, intervene here)
```

Cove sits on top of OpenClaw's runtime data — sessions, cron jobs, workflows, subagent trees — and presents them in a way that lets you understand the state of your agents without reading logs.

## Design Principles

- **One companion, many scenes** — not many NPCs in one place, but one agent across many life spaces
- **Scenes, not rooms** — open areas (garden, track), indoor spaces (study, workshop), objects (journal, mailbox)
- **Life flows between scenes** — buy flowers at the market → plant them in the garden → photograph them in the darkroom
- **Channel = abstraction layer** — each scene maps to a channel; interaction entry points (map area, object, device) are UI freedom
- **Channel ↔ scene mapping is flexible** — 1:1, 1:N, or N:1
- **Dress up, don't rebuild** — game UI skin over existing channel + cron + agent infrastructure

## Tech References

- [WorkAdventure](https://github.com/workadventure/workadventure) — "walk into room = trigger function" pattern
- [ai-town](https://github.com/a16z-infra/ai-town) — PixiJS pixel rendering, agent simulation
- [Agentshire](https://github.com/Agentshire/Agentshire) — OpenClaw plugin, agent-to-NPC bridge
- [PyDew Valley](https://github.com/clear-code-projects/PyDew-Valley) — farming/gardening game mechanics
