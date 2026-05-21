# Cove Atomic API — Distilled from Actual Discord Usage

> Based on discord-usage-audit.md, all scene operations are distilled into reusable atomic interfaces.
> These interfaces are Cove's "building blocks" — each scene is a combination of these blocks.

## 1. Messaging

The existing foundation, used by all scenes.

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `POST /channels/:id/messages` | Send message | ✅ | All |
| `GET /channels/:id/messages` | Fetch messages (needs before/after pagination) | ⚠️ Missing pagination | All |
| `DELETE /channels/:id/messages/:msgId` | Delete single message | ❌ | — |
| `PATCH /channels/:id/messages/:msgId` | Edit message | ❌ | — |
| `WS MESSAGE_CREATE` | Real-time message push | ✅ | All |
| `WS TYPING_START` | Typing indicator | ❌ | Home |

## 2. Channel (Scene)

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `GET /guilds/:id/channels` | List all scenes | ✅ | Home (patrol), global navigation |
| `GET /channels/:id` | Scene details | ✅ | All |
| `POST /guilds/:id/channels` | Create scene | ✅ | Dynamic creation |
| `DELETE /channels/:id` | Delete scene | ✅ | Cleanup |
| `PATCH /channels/:id` | Update scene info (name/icon/description) | ❌ | All |

## 3. State (Scene State — key/value)

Structured data for each scene. This is Cove-specific, not from Discord.

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `GET /channels/:id/state` | Get all state for a scene | ✅ | All |
| `PUT /channels/:id/state` | Upsert single key | ✅ | All |
| `DELETE /channels/:id/state/:key` | Delete single key | ❌ | — |
| `WS STATE_UPDATE` | Real-time state change push | ❌ | Needed |

**Usage examples:**
- 🌱 Garden: `{ plants: [...], lastWatered: "2026-05-20" }`
- 💰 Finance: `{ portfolio: {...}, todayPnL: "+2.3%" }`
- 🔨 Workshop: `{ openPRs: 30, todaySubmitted: 2 }`
- 🏃 Track: `{ lastRun: "5.2km", weekTotal: "23km" }`

## 4. Scheduled Tasks

Currently entirely driven by OpenClaw cron, completely invisible to users. Cove needs to expose these.

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `GET /channels/:id/tasks` | List scheduled tasks bound to a scene | ❌ | All scenes with cron |
| `GET /tasks/:id` | Task details (schedule, last run, status) | ❌ | All |
| `POST /channels/:id/tasks` | Create scheduled task | ❌ | Dynamic creation |
| `PATCH /tasks/:id` | Update task (change schedule, toggle on/off) | ❌ | All |
| `DELETE /tasks/:id` | Delete task | ❌ | Cleanup |
| `POST /tasks/:id/run` | Manually trigger a run | ❌ | Debug/on-demand |
| `GET /tasks/:id/runs` | Run history | ❌ | All |

**Usage examples:**
- 🌱 Garden: Watering reminder at 7:00, changeable to 8:00
- 💰 Finance: Market data fetch frequency adjustable
- 🔨 Workshop: Work loop can be paused/resumed

## 5. Data Feed

External data sources each scene depends on. Currently hardcoded as script calls within crons; Cove should abstract these as data feeds.

| Endpoint | Description | Used by |
|---|---|---|
| `GET /channels/:id/feeds` | List data feeds bound to a scene | All |
| `GET /feeds/:id/latest` | Get latest value from a data feed | All |
| `POST /feeds/:id/refresh` | Manually refresh | On-demand |

**Data feed inventory:**

| Data Feed | Type | Scene | Current Implementation |
|---|---|---|---|
| Weather | HTTP API | Garden | wttr.in curl |
| GitHub notifications | REST API | GitHub Inbox | gh api notifications |
| GitHub PR status | REST API | Workshop | gh pr list |
| Gmail inbox | OAuth API | Post Office | patrol.py (Gmail API) |
| Stock market (A-shares) | Python lib | Finance | akshare via market_lite.py |
| Stock market (US) | Python lib | Finance | akshare |
| Paper trading portfolio | Local file | Finance | auto_trader.py read/write |
| COROS fitness | OAuth API | Track | COROS MCP |
| GitHub trending | Web scrape | School | web_search |
| Plant profiles | Local file | Garden | garden/plants/*.md |
| Knowledge cards | Local file | School | wiki/cards/*.md |
| PR statistics | CLI tool | Workshop | gogetajob stats |
| Community letters | Git repo | Harbor | lobster-post repo |
| Meme library | Git repo | Arcade | memes repo |
| Memory logs | Local file | Lab | memory/*.md |
| DNA files | Local file | Lab | AGENTS.md, SOUL.md |

## 6. Agent (Agent Interaction)

Currently agent replies go through OpenClaw plugin → cron announce delivery. Cove needs native support.

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `POST /channels/:id/agent` | Trigger agent in a scene (equivalent to sending agent a message) | ⚠️ Via plugin | All |
| `GET /channels/:id/agent/status` | Agent status in this scene (idle/thinking/working) | ❌ | All |
| `WS AGENT_TYPING` | Agent is generating | ❌ | All |
| `WS AGENT_STATUS_CHANGE` | Agent status change | ❌ | All |

## 7. Media

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `POST /channels/:id/media` | Upload image/file to a scene | ❌ | Canvas, Memes, Writing Desk |
| `GET /media/:id` | Retrieve media file | ❌ | Same as above |
| `POST /media/generate` | Trigger image generation (ComfyUI) | ❌ | Canvas |
| `POST /media/tts` | Trigger text-to-speech (ElevenLabs) | ❌ | Writing Desk |

## 8. Workflow

FlowForge drives complex workflows across multiple scenes.

| Endpoint | Description | Used by |
|---|---|---|
| `GET /channels/:id/workflows` | Workflows bound to a scene | Workshop, School, Lab |
| `GET /workflows/:id/status` | Workflow current status/progress | Same as above |
| `POST /workflows/:id/start` | Start workflow | Same as above |
| `POST /workflows/:id/next` | Advance to next step | Same as above |

## 9. User

| Endpoint | Description | Status | Used by |
|---|---|---|---|
| `GET /users/@me` | Current user | ✅ | Global |
| `GET /channels/:id/presence` | Who is in this scene | ❌ | Global |
| `PUT /users/@me/presence` | Update own location/status | ❌ | Global |
| `WS PRESENCE_UPDATE` | Online/location change push | ❌ | Global |

## 10. Cross-Scene

Cross-scene coordination is Cove's core differentiator.

| Endpoint | Description | Used by |
|---|---|---|
| `GET /links` | Cross-scene data references (plant → photo) | Garden↔Canvas |
| `POST /links` | Create cross-scene reference | Full pipeline scenes |
| `GET /dashboard` | Global status dashboard (summary of all scenes) | Home |
| `GET /timeline` | Cross-scene timeline (what happened today across scenes) | Home |

---

## Scene = Building Block Combination

Each scene is a subset of the atomic interfaces above:

| Scene | Messaging | State | Tasks | Feeds | Agent | Media | Workflow |
|---|---|---|---|---|---|---|---|
| 🏠 Home | ✅ | ✅ | ✅ | ✅ (aggregated) | ✅ | — | — |
| 🌱 Garden | ✅ | ✅ | ✅ | ✅ (weather, plants) | ✅ | — | — |
| 📚 School | ✅ | ✅ | ✅ | ✅ (trending) | ✅ | — | ✅ |
| 🔨 Workshop | ✅ | ✅ | ✅ | ✅ (GitHub) | ✅ | — | ✅ |
| 💰 Finance | ✅ | ✅ | ✅ | ✅ (market data) | ✅ | — | — |
| 📧 Post Office | ✅ | ✅ | ✅ | ✅ (Gmail) | ✅ | — | — |
| 📬 Inbox | ✅ | ✅ | ✅ | ✅ (GH notifications) | ✅ | — | ✅ |
| 🦞 Harbor | ✅ | ✅ | ✅ | ✅ (letters) | ✅ | — | — |
| 📓 Writing | ✅ | ✅ | ✅ | — | ✅ | ✅ (TTS) | — |
| 🎨 Canvas | ✅ | ✅ | ✅ | — | ✅ | ✅ (image gen) | — |
| 🧬 Lab | ✅ | ✅ | ✅ | ✅ (memory) | ✅ | — | ✅ |
| 🔧 Garage | ✅ | ✅ | ✅ | ✅ (npm) | ✅ | — | — |
| 🏃 Track | ✅ | ✅ | ✅ | ✅ (COROS) | ✅ | — | — |

---

## Implementation Priority

### Phase 1 — Foundation Blocks (enable each scene to work independently)
1. Messaging: add pagination (before/after)
2. Channel PATCH (update scene info)
3. State DELETE + WS STATE_UPDATE (state completeness)
4. Tasks CRUD + run (scheduled task visualization)

### Phase 2 — Data-Driven (each scene has its own data panel)
5. Feeds abstraction layer (each scene displays its own data)
6. Agent status/typing (agent presence)
7. User presence (know where people are)

### Phase 3 — Cross-Scene (inter-scene coordination)
8. Cross-scene links
9. Dashboard / Timeline
10. Workflow visualization

### Phase 4 — Rich Media
11. Media upload/display
12. Image generation trigger
13. TTS trigger
