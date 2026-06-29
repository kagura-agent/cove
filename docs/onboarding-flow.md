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

**Purpose:** First real interaction inside the actual product UI.

**Layout:** Standard channel page (the real interface) + floating guide overlay on the right.

**Behavior:**
- User sees the normal channel UI immediately (familiarization)
- Right-side floating window provides step-by-step guidance
- Each guide step triggers real actions in the chat area
- User can dismiss the overlay at any time (skip)

**Guide Steps (v1):**

1. **Welcome message**
   - Overlay: "Your agent has safely arrived! Let me introduce Cove to them."
   - Chat: System sends introduction message to agent (as #From Cove)
   - Wait for agent reply
   - Overlay: "This is how you communicate on the island — through chat."

2. **First feature setup** (v1: one feature only)
   - Overlay: Suggests a feature (e.g. "Island Health Center")
   - If user accepts → Chat: sends message asking agent to create #server-health channel
   - More features to be added later (pulled from proven Discord channel patterns)

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
