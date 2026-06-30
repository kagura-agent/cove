# Onboarding Flow Design

## Overview

New user onboarding for Cove — from landing page to first guided interaction with their agent.

## Scenes

### Scene 1 — Landing Page (Login)

**Purpose:** Entry point for all users (new and returning).

**Layout:** Full-screen static page.

**Content:**
- Title: **Welcome to Cove**
- Subtitle: A private island for you and your AI agent — chat, build, and live together.
- Google sign-in button ("登岛 via Google")
- Invite code input field

**Notes:** This page is not onboarding-specific; it's the standard login surface.

---

### Scene 2 — Create Your Island (New Users Only)

**Trigger:** User logs in and has no servers under their account.

**Purpose:** Introduce Cove while creating the user's island in one step.

**Format:** Single screen with intro text + island naming.

**Content:**
- Brief explanation: "Cove is a private space for you and your AI agent"
- Name your island (input, default: "[Username]'s Cove")
- Create button → proceeds to agent invite

**Notes:** Introduction is woven into the creation step, not a separate carousel.

---

### Scene 3 — Invite Your Agent

**Purpose:** Connect the user's OpenClaw agent to their island.

**Layout:** Single screen, skippable.

**Flow:**
1. User enters their agent's name (e.g. "Kagura")
2. Cove backend creates a bot user with that name (role: server admin)
3. Generates an invite payload (baseUrl + token + guildId + bot username)
4. Displays as an "invitation letter" with ceremony:
   - "📮 Invitation to [Agent Name]"
   - Server name, role, encoded link
5. User copies and sends to their agent
6. Agent auto-processes: decode → install plugin → configure → connect
7. Connection success: "🎉 [Agent Name] has arrived!"

**Agent-side processing (OpenClaw):**
- Recognize `cove://invite/...` link format
- Decode payload (baseUrl, token, guildId)
- Install/enable Cove plugin if not present
- Write config: `channels.cove.accounts.<id>`
- Connect via WebSocket gateway

**Notes:**
- Currently supports OpenClaw agents only (small text note)
- Agent name entered here = bot username on Cove (no rename needed later)
- Skippable — users can invite later from settings

---

### Scene 4 — Waiting for Agent

**Purpose:** Agent is connecting via the invite link.

**Layout:** Waiting state with subtle animation.

**Content:**
- "Waiting for [Agent Name] to arrive..."
- Visual feedback when connection is detected

---

### Scene 5 — Connected + Guided Tour

**Purpose:** First real interaction inside the actual product UI. Teach Cove's core abstraction through live demonstration.

**Layout:** Standard channel page (the real interface). No floating overlay — the guide IS a channel.

**Core Abstraction to Convey:**
> Each channel is an **addressable, wakeable context** for your agent — a persistent scene with its own memory that other scenes can find and wake up.

**Mechanism:** A #onboarding channel is auto-created. The system (Cove) sends messages there, and the agent naturally responds — creating a three-way interaction:
- **Cove (system)** — sends guide prompts
- **Agent** — responds naturally (proving the system works)
- **User** — observes, then participates

**Guide Flow (v1):**

1. **System demonstrates a request**
   - System sends via webhook in #general: "#From System: I need a server-health channel to monitor the agent's machine health."
   - Agent responds, creates #server-health, sets up cove.md.
   - User sees the pattern: request in chat → agent acts → channel created.

2. **Cross-channel query**
   - System sends in #general: "@agent how's the island doing?"
   - Agent checks #server-health, reports back to #general.
   - User sees: channels are addressable, agent can be reached from anywhere.

**Key principle:** The guide demonstrates the real workflow — System mimics a user request so the user learns by watching, not by reading instructions.

**Notes:**
- This is a REAL interaction, not a mock tooltip. Agent responses are live.
- #onboarding channel can be deleted after or kept as reference.
- Exact flow may vary in production — this is the conceptual design.

---

## Future Additions

- More guided setup options derived from our Discord channel usage
- AI-generated art for each scene
- Customizable agent greeting
- Skip/resume onboarding state persistence

---

## Art Direction

- All illustrations: AI-generated → implemented as SVG
- Code-drawn SVGs removed (quality insufficient)
- Pixel island PNG as interim reference asset
