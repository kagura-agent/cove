# Cove Product Vision

> A mirror world where your real life becomes a cozy island.

## Core Concept

Every person gets their own **island** — a personal server where their real life is mirrored as cozy scenes. Your garden, your study, your workshop, your track — each is a living channel with its own data, agents, and rhythms.

**Not a chat app. Not a virtual world. A mirror of your real one.**

## Platform Model: Islands for Everyone

Cove is not a single-user tool. It's a platform where **each user has their own island** (guild/server).

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

### User Journey

1. **Sign up** → Your island is created with a set of default scenes
2. **Customize** → Add/remove scenes, connect data sources, invite agents
3. **Live** → Your agents tend to your island — watering reminders, PR updates, market data, journal prompts
4. **Visit** → Go to a friend's island (guest permissions), see their garden, leave a note

### Key Principle: One Island = One Person

- A guild IS a person's world, not a community
- Channels are scenes (life domains), not chat rooms
- Agents are residents of your island, not bots you install
- Your island reflects YOUR life — your plants, your PRs, your runs, your finances

## What Makes Cove Different from Discord

| | Discord | Cove |
|---|---|---|
| **Server** | Community of many people | One person's world |
| **Channel** | Chat room for a topic | Scene with state + data + agents |
| **Bot** | Third-party add-on | Agent resident that knows your life |
| **Data** | Messages only | Messages + structured state + data feeds |
| **Cron** | None | Each scene has scheduled tasks |
| **Protocol** | Proprietary | Discord-compatible (reuse ecosystem) |

## Why Discord Protocol

We align with Discord's API/Gateway protocol not to clone Discord, but to **reuse the ecosystem**:
- Any Discord client library (discord.js, discord.py) can connect to Cove
- Existing Discord bots can run on Cove with minimal changes
- OpenClaw plugins that speak Discord protocol work out of the box
- Proven, well-documented protocol design

## Cove-Specific Extensions (Beyond Discord)

These are what make Cove **Cove**, not a Discord clone:

### 1. Scene State (per-channel structured data)
Each scene has key-value state: plant profiles, portfolio data, run stats.
```
GET  /channels/:id/state      → { plants: [...], lastWatered: "..." }
PUT  /channels/:id/state      → upsert a key
WS   STATE_UPDATE              → real-time state push
```

### 2. Data Feeds (external data sources per scene)
Each scene can subscribe to external data: weather API, GitHub notifications, stock prices.
```
GET  /channels/:id/feeds      → list bound feeds
GET  /feeds/:id/latest        → latest value
POST /feeds/:id/refresh       → manual refresh
```

### 3. Scheduled Tasks (per-scene automation)
Each scene has visible, manageable cron jobs: watering reminders, market data fetch.
```
GET  /channels/:id/tasks      → list tasks
POST /tasks/:id/run           → manual trigger
PATCH /tasks/:id              → change schedule
```

### 4. Cross-Scene Links
Scenes reference each other: a plant in the garden links to a photo in the darkroom.
```
GET  /links                   → cross-scene references
POST /links                   → create reference
```

### 5. Island Dashboard
Global view across all scenes: what happened today, what needs attention.
```
GET  /dashboard               → summary of all scenes
GET  /timeline                → cross-scene timeline
```

## Architecture

```
┌─────────────────────────────────┐
│  Client UI                      │  ← Web app (now), Game UI (future)
├─────────────────────────────────┤
│  Discord-compatible API/Gateway │  ← Standard protocol
├─────────────────────────────────┤
│  Cove Extensions API            │  ← State, Feeds, Tasks, Links
├─────────────────────────────────┤
│  Channel + Cron + Agent engine  │  ← OpenClaw integration
└─────────────────────────────────┘
```

## Implementation Priorities

### Phase 1: Solid Foundation (current)
- ✅ Discord-compatible REST + Gateway
- ✅ Auth (BFF pattern, Google OAuth)
- ✅ Messaging, channels, typing, presence, read state
- ✅ OpenClaw plugin integration
- 🔄 Multi-guild support (in progress — #237, #228)
- 🔄 Gateway RESUME / reconnection (#116)

### Phase 2: Island Creation
- Auto-create island on registration
- Default scene templates (starter island)
- Scene State API (GET/PUT/DELETE + WS push)
- Invite system — join someone else's island as guest (#171)

### Phase 3: Living Island
- Data Feeds per scene
- Scheduled Tasks visualization
- Cross-scene links
- Island dashboard / timeline

### Phase 4: Social
- Visit other people's islands
- Guest permissions (view-only, interact, etc.)
- Island discovery / directory

### Phase 5: Game UI
- 2D pixel-art island skin over the channel infrastructure
- Walk into scenes, interact with objects
- The cozy factor

---

_This document defines where Cove is going. Update it as the vision evolves._
