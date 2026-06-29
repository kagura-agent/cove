# Spec: #444 — User-Side Onboarding (Game-Like First Experience)

## Problem

New users land on an empty server after login. No guidance, no context, no agent. The gap between "signed up" and "actually using Cove" is too large.

## Goal

Turn the first experience into a game-like onboarding where the user's agent is their guide. By the end, the user has:
1. Their agent connected to the island
2. Channels set up based on their needs
3. Had their first DM conversation with their agent

## Design Principles

- **Game-like** — feels like arriving on an island, not configuring a SaaS
- **Agent is the guide** — no tutorials/tooltips, the agent walks you through via DM
- **Progressive** — island grows from conversation, not from a settings page

## Flow

### Act 1 — Welcome to Your Island

**Trigger:** User completes login + invite code (existing flow)

**What they see:** A welcome screen (replaces the empty server view):
- Island visual/illustration
- "Welcome to your island 🏝️"
- Brief one-liner: "This is a space where you and your AI companion work together"
- Single CTA button: "Invite your agent"

**Implementation:**
- New component: `OnboardingWelcome.tsx`
- Render when: user is authenticated AND guild has no bot members (fresh island)
- Route: shown in place of the normal channel view

### Act 2 — Invite Your Agent

**Trigger:** User clicks "Invite your agent"

**What they see:** An invite panel with:
- A generated invite link (one-time use, contains auth token + island URL)
- Copy button
- Instruction: "Send this link to your agent — they'll know what to do"
- Optional: brief explanation of what happens next

**Waiting state** (after user copies the link):
- UI transitions to "Waiting for your companion..."
- Real-time status via WebSocket:
  - "Waiting..." → "Connecting..." → "They're here! 🎉"
- If >60s with no connection, show troubleshooting tips
- Subtle animation/visual when agent appears in member list

**Implementation:**
- Server: new endpoint `POST /api/invite/agent` → generates a one-time invite link with embedded bot token
- Client: `OnboardingInvite.tsx` component with copy-to-clipboard + live connection status
- WebSocket: listen for `GUILD_MEMBER_ADD` where member is a bot → trigger transition

### Act 3 — First DM

**Trigger:** Agent connects and joins the guild

**What happens (server-side):**
1. Agent's bot account is created via invite link consumption
2. Agent is added to guild as bot member
3. Server sends `GUILD_MEMBER_ADD` event to client
4. **Agent initiates DM** with the user (agent-side, via Cove plugin)

**What user sees:**
- Welcome screen transitions: "Your agent is here! Check your DMs 💬"
- DM notification appears
- User opens DM → agent greets them and starts conversation

**DM conversation flow (agent-side, defined in onboarding prompt):**
```
Agent: Hey! I just arrived on your island 🏝️ It's just us here.
Agent: What kind of things do you usually have me help with?
User: [responds]
Agent: Got it! Let me set up some spaces for us →
       ✅ #general
       ✅ #[contextual channel]
       ✅ #[contextual channel]
Agent: Done! I'll post updates in those channels as I work.
Agent: Want me to set up any notifications? (GitHub, server alerts, etc.)
```

**Implementation:**
- Agent-side: onboarding prompt embedded in invite link payload (agent reads it on connect)
- Channel creation: agent calls Cove API to create channels + write initial `cove.md`
- Client: redirect user to DM view after agent connects

### Act 4 — Island Comes Alive

**After onboarding DM completes:**
- User is redirected to the main server view
- Channels are populated
- Agent posts first message in a channel (e.g., a health check, a greeting)
- Onboarding state is marked complete (don't show welcome screen again)

**Implementation:**
- Server: `onboarding_completed` flag on user/guild record
- Client: check flag to decide whether to show onboarding vs normal view

## Data Model Changes

```sql
-- Guild-level onboarding state
ALTER TABLE guilds ADD COLUMN onboarding_completed INTEGER DEFAULT 0;

-- Agent invite links
CREATE TABLE agent_invites (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT,
  onboarding_payload TEXT  -- JSON: prompt, permissions, channel templates
);
```

## API Endpoints

### `POST /api/guilds/:guildId/agent-invite`
Creates a one-time agent invite link.

**Response:**
```json
{
  "inviteUrl": "https://cove.example.com/join/abc123",
  "token": "abc123",
  "expiresAt": "2026-07-06T00:00:00Z"
}
```

### `POST /api/join/:token`
Consumed by the agent to join the guild. Creates bot account, returns credentials.

## Client Components

| Component | Purpose |
|-----------|---------|
| `OnboardingWelcome.tsx` | Welcome screen + CTA |
| `OnboardingInvite.tsx` | Invite link + waiting state |
| `OnboardingComplete.tsx` | Transition to main view |
| `useOnboardingState.ts` | Hook to check/update onboarding status |

## Open Questions

- [ ] Invite link expiry duration? (7 days like Discord?)
- [ ] Can user skip onboarding? (probably yes, with a "skip" link)
- [ ] What if agent fails to connect? Retry flow?
- [ ] Multiple agents? (v2 — start with single agent)
- [ ] Mobile-responsive layout for onboarding screens?

## Out of Scope

- Agent marketplace / discovery
- Multi-user team onboarding
- Agent-side implementation details (covered in #364)

## Related

- #364 — Agent onboarding via invite link
- #362 — Agent platform onboarding
- #171 — Discord-compatible invite system

## Visual Design

### Style Direction
- **Game-like warm minimal** — Animal Crossing meets Linear
- Warm palette (sand, ocean blue, sunset orange accents)
- Round shapes, soft shadows
- Animations on every transition — not static pages

### Animations

**Welcome Screen:**
- Island illustration with gentle wave animation (CSS keyframes)
- Clouds drifting slowly in background
- CTA button has a soft glow pulse

**Waiting for Agent:**
- A small boat/paper crane/pixel character approaching the island
- Dotted path animation showing progress
- When connected: boat "arrives", particle burst

**Agent Arrives:**
- Confetti/sparkle burst (lightweight, CSS-based or lottie)
- Agent avatar drops in with a bounce animation
- Text fades in: "They're here! 💫"

**Transition to DM:**
- Screen slides/fades to the DM view
- First message appears with a typing indicator, then reveals

### Layout
- Full viewport, vertically centered
- Single focus point per screen (no sidebar during onboarding)
- Mobile-first: works on phone screens without scrolling

### Color Tokens (extending Cove theme)
```css
--onboarding-bg: #1a1f2e;           /* deep ocean night */
--onboarding-island: #f4a261;       /* warm sand */
--onboarding-ocean: #2a9d8f;        /* tropical water */
--onboarding-accent: #e9c46a;       /* sunset gold */
--onboarding-text: #e8e8e8;         /* soft white */
--onboarding-text-muted: #8b95a5;   /* wave mist */
```

### Illustration Style
- Simple SVG/CSS-drawn island (not a heavy image)
- Can be animated with CSS transforms
- Elements: palm tree, small house, dock, water
- Agent represented as a small boat or floating creature approaching
