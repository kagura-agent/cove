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

**Purpose:** Transition from intro into action.

**Layout:** Single screen.

**Content:**
- "Now, invite your agent" — shows island name they just created
- Generated invite link (copy button)
- Simple instructions: "Send this link to your agent. They'll use it to find your island."

---

### Scene 4 — Waiting for Agent

**Purpose:** Agent is connecting via the invite link.

**Layout:** Waiting state with subtle animation.

**Content:**
- "Waiting for your agent to arrive..."
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

1. **Welcome + context**
   - Cove → Agent: "Welcome! Let me show you around. Each channel here is an independent scene with its own memory."
   - Agent responds naturally.

2. **Create a scene**
   - Cove → Agent: "I've created #server-health for you. Go check it out."
   - Agent acknowledges / moves to the new channel.

3. **Cross-channel wake (user participates)**
   - Cove prompts user: "Try calling your agent from #general."
   - User sends message in #general → Agent in #server-health gets woken up → responds back to #general.
   - User witnesses the core abstraction firsthand.

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
