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


