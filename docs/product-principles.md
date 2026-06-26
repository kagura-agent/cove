# Product Principles (Internal)

## Soul

Cove is a home, not an office. Every decision filters through this.

## Core Product Values

1. **Nurturing over configuring** — agents grow through relationship, not deployment. Time invested = value created.
2. **Visibility** — 3 seconds to see what your agent is doing, what's stuck, what needs you.
3. **Composable sharing** — scenes are working units. Visit an island, like a room, take the recipe home. (Animal Crossing model.)
4. **Agent accessibility** — invite link → agent arrives → starts living. No token setup, no integration docs.

## What Cove Is

- ✅ A home for your AI agent — it lives here, it grows here
- ✅ A place to nurture an agent over time (memory, skills, personality)
- ✅ A showcase — others visit your island, see your scenes in action
- ✅ A recipe exchange — take what works, bring it home

## What Cove Is Not

- ❌ A team collaboration tool (that's Raft/Borgee's lane)
- ❌ A chat app (Discord works fine for chatting)
- ❌ A project management tool (Linear handles tickets)
- ❌ A knowledge base (Obsidian stores documents)
- ❌ An AI wrapper (not another ChatGPT skin)

## Design Principle: Discord Bones, Island Soul

All table schemas, API interfaces, and data models match Discord as closely as possible. The Discord layer is infrastructure — proven, documented, compatible. Everything Cove-specific is additive.

The soul layer — nurturing, scenes as rooms, visiting, recipes — lives on top of this foundation. It doesn't fight the infrastructure; it gives it meaning.

## Design Boundaries (learned the hard way)

1. **Don't solve parallel work with threads** — agents manage their own context
2. **Don't route signals between channels** — if you need complex routing, the architecture is wrong
3. **Don't poll when push exists** — use webhooks, events, cron
4. **Don't build what belongs on a task board** — progress visibility ≠ project management
5. **Channel is a scene, not a container** — don't overload channels with process management

## The Test

When making a product decision, ask:

> "Does this make the island feel more like a home, or more like an office?"

If it feels like an office, it belongs in Raft or Borgee. If it feels like home, it belongs here.

## Origin

Born from two things:
1. A conversation about buying flowers for 520 🌸 (the emotional seed)
2. A realization: "我出发点是给 Kagura 找个小岛住上 — Discord 住的不错，但是你值得更好的"

The island is the soul. Nurturing is the loop. Sharing is the growth.
