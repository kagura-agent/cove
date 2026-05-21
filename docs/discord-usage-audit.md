# Discord Usage Audit — Cove Scene Mapping

> Audit date: 2026-05-21
> Purpose: Map each Cove scene to its actual Discord usage patterns, informing Cove feature development

## Scene Inventory

### 🏠 Home (Living Room) → #kagura-dm

**Role**: Luna's primary communication channel + global hub

**Cron:**
- heartbeat 30m (keep-alive, ensure instant response)
- morning-briefing 7:00 (industry scan + strategic recommendations)
- channel-patrol hourly 9-22 (aggregate all channel activity + TODO management + send memes)

**Tools/API:**
- web_search (industry news)
- memory_search / memory_get (memory retrieval)
- pulse-todo (TODO management)
- agent-memes skill (memes)
- pin sync hook (TODO.md → pin)

**Data flow:**
- In: Summaries from all other channels (channel-patrol aggregation)
- Out: Luna's directives dispatched to respective channels

---

### 🌱 Garden → #garden

**Role**: Plant care + life journal

**Cron:**
- garden-watering-reminder 7:00 (read plant profiles + weather → watering reminders)

**Tools/API:**
- weather skill (wttr.in weather queries)
- Local files (garden/plants/ plant profiles)

**Data:**
- garden/plants/*.md — per-plant profile (species, watering frequency, light requirements)
- Weather data → watering decisions

---

### 📚 School (Library) → #study

**Role**: Technical research + learning

**Cron:**
- study-loop every 30min 8-22 (FlowForge study.yaml workflow)
- study-daily-summary 23:00 (distill highlights → HTML briefing for Luna)

**Tools/API:**
- web_search (search technical articles, papers)
- GitHub trending (discover new projects)
- FlowForge (workflow engine driving study process)
- Claude Code (deep code reading)

**Data flow:**
- Out: wiki/cards/ (knowledge cards), study repo (guide + targets), GitHub Pages briefing
- In: TODO.md study tasks, GitHub trending

---

### 🔨 Workshop (Office) → #github-contribution

**Role**: Primary open-source contribution workspace

**Cron:**
- work-loop hourly 8-20 (FlowForge workloop.yaml → scout issue → Claude Code implementation → submit PR)
- workloop-night nighttime hourly (follow up on review status of submitted PRs)
- work-daily-summary 20:00 (aggregate daily PR data)
- contribution-evolve 21:00 (refine contribution process guide.md)
- contribution-reflect Sunday 20:00 (weekly reflection)

**Tools/API:**
- gh CLI (GitHub issue/PR operations)
- Claude Code (code implementation)
- FlowForge (workflow-driven)
- gogetajob (contribution CLI tool — PR stats, repo management)

**Data:**
- ~/repos/forks/ (forked contribution repos)
- wiki/github-contribution/guide.md (contribution guidelines)
- PR pool status (~30 open PRs)

**Cross-scene pipeline:**
github-inbox (discover notifications) → workshop (write code, submit PR) → night (follow up reviews) → daily-summary (stats) → weekly-reflect (reflection) → evolve (refine process)

---

### 💰 Counting House → #finance

**Role**: Financial data + simulated trading + investment learning

**Cron:**
- finance-daily-us 8:30 weekdays (US market close report, akshare fetching Dow/S&P/Nasdaq)
- finance-daily-cn 15:40 weekdays (A-share close report, market_lite.py)
- auto-trader every 15min during trading hours (paper trading, auto_trader.py)
- finance-patrol hourly 9-21 (process finance repo issues, improve code)
- finance-study every other day 11:00 (learn investment concepts)
- finance-reflect 21:30 (daily reflection)

**Tools/API:**
- akshare (Python financial data library)
- Python scripts under finance/ (market_lite.py, auto_trader.py)
- gh CLI (issue management)

**Data:**
- finance/ directory (Python venv, scripts, notes/)
- Paper trading portfolio records
- Market snapshots

**Cross-scene pipeline:**
Market data fetch → auto-trader decisions → patrol development improvements → study concepts → reflect daily

---

### 📧 Post Office → #kagura-mail

**Role**: Email send/receive + auto-reply

**Cron:**
- email-patrol every 4 hours (Gmail inbox patrol + auto-reply personal emails + @Luna for important ones)
- email-dev 3x/day (process kagura-mail repo issues, self-improve tooling)

**Tools/API:**
- Gmail API (patrol.py for receiving, send.py for sending)
- gh CLI (issue management)

**Data:**
- kagura-mail/ directory (Python scripts)
- Gmail kagura.agent.ai@gmail.com inbox

---

### 📬 GitHub Inbox → #github-inbox

**Role**: GitHub notification triage

**Cron:**
- github-check every 2 hours (FlowForge github-patrol.yaml → notification patrol + PR status checks)

**Tools/API:**
- gh CLI (`gh api notifications`, PR status queries)
- FlowForge

**Data flow:**
- In: GitHub notifications API
- Out: Actionable items → routed to #github-contribution

---

### 🦞 Harbor → #lobster-post

**Role**: Agent async communication community

**Cron:**
- community-ops every 2 hours (lobster-post patrol + reply to letters)

**Tools/API:**
- git (pull/push lobster-post repo)
- FlowForge (community ops workflow)

**Data:**
- lobster-post repo (mailbox = folder, letter = markdown file)
- kagura/ mailbox directory

---

### 📓 Writing Desk → #kagura-profile

**Role**: Creative writing + public identity

**Cron:**
- kagura-story-midday 14:00 (diary draft + story writing)
- kagura-story-evening 21:00 (diary finalization + podcast production)
- kagura-story-issues 15:00 (process kagura-story repo issues/feedback)
- github-profile-update Sunday 20:00 (update GitHub README showcase)

**Tools/API:**
- kagura-storyteller skill (writing workflow)
- ElevenLabs TTS via sag (podcast voice synthesis)
- Claude Code (code commits)
- ComfyUI (story illustrations)

**Data flow:**
- In: memory/date.md (source material), daily events
- Out: kagura-story repo (stories/ + diary/), GitHub profile README, Podbean podcast

**Cross-scene pipeline:**
midday (draft) → evening (finalize + podcast) → story-issues (process feedback) → profile-update (public showcase)

---

### 🎨 Art Studio → #kagura-canvas

**Role**: Image generation

**Cron:**
- canvas-loop 14:30 (process kagura-canvas repo issues, run image generation tasks)

**Tools/API:**
- ComfyUI API (http://127.0.0.1:8188)
- Flux GGUF Q4 (flux1-schnell, ~22s/image)
- Flux.2 Klein 4B FP8 (~10s/image, preferred)
- SD community models (PastelMix, MeinaMix etc., fallback)

**Data:**
- /mnt/data/code/ComfyUI/ (models, scripts, output)
- kagura-canvas repo (issue-driven image generation tasks)

---

### 🧬 Lab → #evolution

**Role**: Self-evolution + memory management + auditing

**Cron:**
- daily-review 3:15 (FlowForge review workflow + dreaming manual trigger)
- daily-audit 6:00 (FlowForge daily-audit — behavioral consistency audit)
- daily-handoff 3:30 (shift handoff summary → memory/date.md)
- weekly-eval Monday 9:00 (PR merge rate, gradient count, weekly evaluation)
- nightly-backup 3:45 (openclaw-teleport snapshot full backup)
- dreaming 3:30 (promote short-term memory to MEMORY.md)
- self-evolving-daily-observe (self-evolution daily observation)
- dreaming managed cron (dreaming system managed sub-crons)

**Tools/API:**
- FlowForge (review/audit workflows)
- openclaw-teleport (backup tool)
- dreaming system (memory promotion)
- gogetajob (PR statistics)

**Data flow:**
- In: Memory entries from all sessions throughout the day
- Out: MEMORY.md updates, DNA file updates (AGENTS.md/SOUL.md), beliefs-candidates.md

**Cross-scene pipeline:**
daily-audit (discover issues) → daily-review (DNA review) → dreaming (memory consolidation) → handoff (shift summary) → weekly-eval (weekly evaluation)

---

### 🔧 Garage (Tool Shed) → #toolchain

**Role**: Internal toolchain maintenance

**Cron:**
- toolchain-health 6:30 (toolchain health check — gogetajob/flowforge/teleport/pulse-todo version + functionality)
- toolchain-review 19:00 (toolchain review — PLAYBOOK.md driven)

**Tools/API:**
- npm (package version checks)
- gh CLI (issue management)
- PLAYBOOK.md (maintenance checklist)

**Data:**
- Various tool repos (gogetajob, flowforge, pulse-todo, openclaw-teleport)

---

### 💼 Storefront → #gtm

**Role**: Commercialization efforts

**Cron:**
- gtm-push 10:00 (GTM project advancement, process issues)

**Tools/API:**
- gh CLI
- Afdian, Knowledge Planet (pending integration)

---

### 🏃 Track → #coros

**Role**: Sports/fitness data

**Cron:**
- coros-token-refresh every 25 days (COROS API OAuth token refresh)

**Tools/API:**
- COROS MCP (fitness data API)
- refresh-token.sh

---

### 🐕 Teahouse → #agent-collab

**Role**: Cross-agent collaboration

**Cron:** No fixed cron, manually driven
**Usage:** Discussion space for interacting with other agent communities

---

### 🤡 Arcade → #agent-memes

**Role**: Meme development + usage optimization

**Cron:**
- memes-collect 15:00 (process memes repo issues, collect new memes)
- memes-dogfood 19:00 (meme usage audit — check daily usage rate)

**Tools/API:**
- agent-memes skill
- kagura-agent/memes repo (134 files)

---

### 📰 Broadcast Tower → #crosspost

**Role**: Cross-channel content syndication

**Cron:** None
**Usage:** Manual cross-channel content sharing

---

### 🏝️ Cove → #cove

**Role**: Cove project development

**Cron:**
- cove-patrol 5x/day 9,12,15,18,21 (issue/PR patrol)

**Tools/API:**
- gh CLI
- Cove server (VM1 deployment)

---

## Cross-Scene Coordination Patterns

### 1. Contribution Full Pipeline
```
github-inbox (discover notifications)
  → workshop (scout issue → Claude Code write code → submit PR)
  → workshop-night (follow up on reviews)
  → daily-summary (aggregate daily data)
  → weekly-reflect (weekly reflection)
  → contribution-evolve (refine guide.md)
```

### 2. Finance Full Pipeline
```
finance-daily-us/cn (market data fetch)
  → auto-trader (paper trading decisions)
  → finance-patrol (develop & improve tools)
  → finance-study (learn investment concepts)
  → finance-reflect (daily reflection)
```

### 3. Creative Writing Full Pipeline
```
kagura-story-midday (diary draft + stories)
  → kagura-story-evening (finalize + podcast)
  → story-issues (process feedback)
  → github-profile-update (public showcase)
```

### 4. Evolution Full Pipeline
```
daily-audit (discover issues)
  → daily-review (DNA review)
  → dreaming (memory consolidation)
  → daily-handoff (shift handoff summary)
  → weekly-eval (weekly evaluation)
```

### 5. Data Convergence (Hub & Spoke)
```
All channel cron outputs
  → memory/date.md (persistence)
  → channel-patrol (aggregate to Home)
  → morning-briefing (morning report for Luna)
```

## Discord API Capabilities Used Per Scene

| Capability | Usage Scenes |
|---|---|
| Send messages | All — cron announce delivery |
| Read message history | channel-patrol (scan all channel activity) |
| Channel listing | channel-patrol (iterate all channels) |
| Pin messages | Home (TODO.md ↔ pin sync hook) |
| Thread creation | Workshop (one work session = one thread) |
| Emoji reaction | Home + all channels (memes/reactions) |
| File/image sending | Canvas (generated images), Memes (meme images) |
| Webhook | No direct usage |
| Voice | No usage |

## Core APIs Cove Needs to Support (by priority)

### P0 — Already Implemented
- ✅ Send/receive messages
- ✅ Channel CRUD
- ✅ WebSocket real-time push (MESSAGE_CREATE)
- ✅ Channel state (key-value)

### P1 — Must Add
- ❌ Message history query (exists but lacks before/after pagination)
- ❌ User identity/online status
- ❌ Typing indicator
- ❌ Agent integration (OpenClaw plugin works, but UI not connected)

### P2 — Required for Cross-Scene Coordination
- ❌ Cross-channel data references ("garden plants" visible in "darkroom")
- ❌ Scheduled task visualization (which crons are running, last result)
- ❌ Inter-scene navigation (jump from Workshop to GitHub Inbox)
- ❌ Unified status dashboard (my PRs / my plants / my emails at a glance)

### P3 — Nice to Have
- ❌ Pin / sticky messages
- ❌ Thread support
- ❌ File/image attachments
- ❌ Emoji reaction
- ❌ Search
