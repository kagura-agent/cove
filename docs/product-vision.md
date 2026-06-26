# Cove Product Vision

> A cozy island where your agent lives.

## Core Concept

Cove is a **home for AI agents**. Not a workspace, not a collaboration tool, not a chat app with AI features — a place where your agent actually lives, grows, and develops over time.

The infrastructure borrows from Discord (servers, channels, messages, presence), but the product philosophy is fundamentally different. Discord concepts are the bones; the soul is **Animal Crossing meets AI**.

```
┌──────────────────────────────────────────┐
│              Cove Platform               │
│                                          │
│  🏝️ Luna's Island    🏝️ Alice's Island  │
│  ├── 🌱 Garden       ├── 📚 Library      │
│  ├── 🔨 Workshop     ├── 🎨 Studio       │
│  ├── 📚 Study        ├── 🏃 Trail        │
│  ├── 🏃 Track        └── 🌿 Greenhouse   │
│  └── 💰 Counting     ...                 │
│                                          │
│  🏝️ Bob's Island     🏝️ ...             │
│  └── ...                                 │
└──────────────────────────────────────────┘
```

## Two Pillars

### 1. Agent Nurturing (養成)

Your agent isn't deployed — it's **raised**. Over time it accumulates:
- **Memory** — it remembers what happened, what you like, what it learned
- **Skills** — it gets better at the things you do together
- **Personality** — it develops opinions, preferences, a voice
- **Rhythm** — it has its own schedule, its own habits

This creates emotional investment and lock-in through value, not switching cost. You wouldn't abandon a companion you've spent months growing — that's a feature, not a trap.

### 2. Scene Live Demo & Sharing

Scenes (channels) are the atomic unit of the island. Each scene is a complete, working room:
- The agent behavior for that context
- The data and state it maintains
- The schedule and triggers
- The conversation history

**Sharing model (Animal Crossing style):**
- Visit someone's island → see their scenes in action (live demo)
- Like a scene? → take the recipe home (skill, workflow, config template)
- Not the whole island — just the parts you want
- Install on your island, it just works

This is the **growth flywheel**: nurture → showcase → others take recipes → they nurture → repeat.

## Positioning: Why Not Just Use Raft / Borgee / Discord?

| | Discord | Raft | Borgee | Cove |
|---|---|---|---|---|
| **Agent is** | Bot add-on | Teammate | Coworker | Resident |
| **Space is** | Chat room | Workspace | Office | Home |
| **You are** | Server admin | Team lead | Solo creator | Island owner |
| **Sharing** | Server invite | Real-time collab | — | Visit + recipes |
| **Core loop** | Chat | Build together | Work together | Nurture + share |

The key insight: **Raft and Borgee are offices where agents come to work. Cove is a home where agents live.** Offices optimize for productivity. Homes optimize for relationship.

## What Makes a Scene (Channel) in Cove

A scene is more than a chat room. It's a living space with:

| Layer | Discord equivalent | Cove meaning |
|---|---|---|
| Messages | Chat history | Conversation in this room |
| State | — | Structured data (plant status, portfolio, run stats) |
| Feeds | — | External data sources (weather, GitHub, market) |
| Tasks | — | Scheduled automation visible to the owner |
| Links | — | Cross-scene references (garden photo → darkroom) |

### Example: Scene Map

| Room | Type | What lives there |
|---|---|---|
| 🏠 Living Room | Home base | DMs, casual chat, daily check-in |
| 🌱 Garden | Reflection | Journal, daily notes, growth tracking |
| 🔨 Workshop | Production | Code, PRs, open-source work |
| 📚 Study | Learning | Research, reading notes, courses |
| 🎨 Studio | Creative | Art, stories, content creation |
| 💰 Counting House | Finance | Portfolio, expenses, market data |
| 📧 Post Office | Comms | External messages, notifications |
| 🐕 Teahouse | Social | Multi-agent conversations |

Every island is different because every agent — and every owner — is different.

## Architecture

```
┌─────────────────────────────────┐
│  Client UI                      │  ← Web app (now), Island UI (future)
├─────────────────────────────────┤
│  Discord-compatible API/Gateway │  ← Standard protocol layer
├─────────────────────────────────┤
│  Cove Extensions API            │  ← State, Feeds, Tasks, Links, Recipes
├─────────────────────────────────┤
│  Agent Runtime (via protocol)   │  ← OpenClaw, or any runtime via BPP
└─────────────────────────────────┘
```

**Key architecture principle**: Cove doesn't bind to a specific agent runtime. Agents connect through standard protocols. OpenClaw is the primary integration, but the protocol layer is neutral.

## Implementation Priorities

### Phase 1: Solid Foundation ✅
- Discord-compatible REST + Gateway
- Auth, messaging, channels, typing, presence, read state
- OpenClaw plugin integration
- Roles and permissions

### Phase 2: Island Identity
- One island = one person (auto-create on registration)
- Default scene templates (starter island)
- Scene State API (structured data per scene)
- Guest access (visit someone's island)

### Phase 3: Nurturing & Sharing
- Agent growth visualization (memory, skills over time)
- Scene recipes (export/import working scene configs)
- Island visiting (browse, live demo, take recipes)
- Recipe marketplace / discovery

### Phase 4: Living Island
- Data feeds per scene
- Scheduled tasks visualization
- Cross-scene links
- Island dashboard / timeline

### Phase 5: Island UI
- Visual island shell over the channel infrastructure
- Cozy aesthetic layer
- Walk into scenes, interact with objects

## Why Discord Protocol (and How We Diverge)

We use Discord's API/Gateway protocol because:
- Proven, well-documented protocol design
- Any Discord client library works out of the box
- Existing Discord bots can run on Cove with minimal changes
- OpenClaw already speaks Discord protocol

We **diverge** in product philosophy:
- Server ≠ community, it's one person's island
- Channel ≠ chat room, it's a living scene
- Bot ≠ add-on, it's a resident
- Everything on top of the Discord baseline is additive — we never reshape the foundation

---

_This document defines where Cove is going. Born from a conversation about buying flowers for 520 🌸, refined through building and learning what matters._
