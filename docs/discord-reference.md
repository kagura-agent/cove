# Discord API Reference for Cove

Reference for the Cove team covering Discord's core architecture. Use this to understand protocol decisions and identify gaps in Cove's implementation.

Based on official Discord API docs (v10) unless marked otherwise.

---

## Snowflake IDs

Discord uses 64-bit integer IDs called Snowflakes. They are returned as **strings** in the HTTP API to avoid JSON integer precision loss.

### Bit layout (64 bits total)

| Field | Bits | Description |
|-------|------|-------------|
| Timestamp | 42 | Milliseconds since Discord Epoch (1420070400000 = 2015-01-01T00:00:00.000Z) |
| Worker ID | 5 | Internal worker that generated the ID |
| Process ID | 5 | Internal process on that worker |
| Increment | 12 | Per-process counter, reset every ms |

### Key properties

- **Globally unique** across all of Discord.
- **Naturally ordered by creation time** — comparing two snowflakes tells you which is newer. This is how Discord implements read state (see [Read State](#read-state-unofficial)).
- **Timestamp extraction:** `(snowflake >> 22) + 1420070400000` = creation timestamp in milliseconds.

---

## Core Objects

### Guild

A "server" in the Discord UI.

| Field | Type | Description |
|-------|------|-------------|
| id | snowflake | Guild ID |
| name | string | Server name |
| icon | ?string | Icon hash |
| owner_id | snowflake | ID of the guild owner |
| roles | role[] | All roles in the guild |
| channels? | channel[] | Present in GUILD_CREATE event only |
| members? | member[] | Present in GUILD_CREATE event only |
| member_count? | integer | Approximate member count |

### Channel

| Field | Type | Description |
|-------|------|-------------|
| id | snowflake | Channel ID |
| type | integer | Channel type (see below) |
| guild_id? | snowflake | Not present on DMs |
| name? | string | Channel name |
| topic? | string | Channel topic (0-4096 chars) |
| last_message_id? | ?snowflake | ID of last message — may not point to a valid message |
| parent_id? | ?snowflake | Category ID, or parent channel for threads |
| position? | integer | Sorting position |

#### Channel types

| Value | Name | Description |
|-------|------|-------------|
| 0 | GUILD_TEXT | Standard text channel |
| 1 | DM | Direct message between users |
| 2 | GUILD_VOICE | Voice channel |
| 4 | GUILD_CATEGORY | Organizational category |
| 5 | GUILD_ANNOUNCEMENT | Announcement channel (formerly "news") |
| 10 | ANNOUNCEMENT_THREAD | Thread in an announcement channel |
| 11 | PUBLIC_THREAD | Public thread |
| 12 | PRIVATE_THREAD | Private thread |
| 13 | GUILD_STAGE_VOICE | Stage channel for hosted events |
| 14 | GUILD_DIRECTORY | Hub directory channel |
| 15 | GUILD_FORUM | Forum channel (threads only, no chat) |
| 16 | GUILD_MEDIA | Media channel (like forum but media-focused) |

### Message

| Field | Type | Description |
|-------|------|-------------|
| id | snowflake | Message ID |
| channel_id | snowflake | Channel the message was sent in |
| author | user | User who sent the message |
| content | string | Message text content |
| timestamp | ISO8601 | When the message was sent |
| edited_timestamp | ?ISO8601 | When the message was last edited, null if never |
| tts | boolean | Text-to-speech flag |
| mention_everyone | boolean | Whether @everyone was used |
| mentions | user[] | Users mentioned in the message |
| mention_roles | snowflake[] | Roles mentioned in the message |
| attachments | attachment[] | File attachments |
| embeds | embed[] | Rich embeds |
| reactions? | reaction[] | Reaction data |
| pinned | boolean | Whether the message is pinned |
| type | integer | Message type (0=DEFAULT, 19=REPLY, etc.) |
| thread? | channel | Thread started from this message |
| message_reference? | object | Reference data for replies/forwards |

### User

| Field | Type | Description |
|-------|------|-------------|
| id | snowflake | User ID |
| username | string | Username (unique) |
| discriminator | string | Legacy discriminator, now "0" |
| global_name | ?string | Display name |
| avatar | ?string | Avatar hash |
| bot? | boolean | Whether the user is a bot |

### Member

A guild-specific user representation.

| Field | Type | Description |
|-------|------|-------------|
| user? | user | The user this member represents |
| nick? | ?string | Guild-specific nickname |
| roles | snowflake[] | Role IDs assigned to this member |
| joined_at | ISO8601 | When the user joined the guild |
| permissions? | string | Computed total permissions (in interaction context) |

### Role

| Field | Type | Description |
|-------|------|-------------|
| id | snowflake | Role ID |
| name | string | Role name |
| color | integer | Role color (deprecated) |
| colors | object | Role color data |
| hoist | boolean | Whether the role is pinned in the member sidebar |
| position | integer | Sorting position |
| permissions | string | Permission bitfield |
| managed | boolean | Whether a bot/integration controls this role |
| mentionable | boolean | Whether the role can be @mentioned |

---

## Gateway (WebSocket)

### Connection Lifecycle

```
Client                          Discord
  │                               │
  ├── WSS connect ──────────────► │
  │                               │
  │ ◄── Hello (op 10) ────────── │  (includes heartbeat_interval)
  │                               │
  ├── Heartbeat (op 1) ────────► │  (start sending every interval)
  │ ◄── Heartbeat ACK (op 11) ── │
  │                               │
  ├── Identify (op 2) ─────────► │  (token + intents)
  │                               │
  │ ◄── Ready (op 0) ──────────  │  (resume_gateway_url, session_id,
  │                               │   guilds, user)
  │                               │
  │     ... events flow ...       │
  │                               │
  │ ── disconnect ──              │
  │                               │
  ├── Resume (op 6) ───────────► │  (session_id, seq — replays missed events)
  │      OR                       │
  ├── Identify (op 2) ─────────► │  (fresh session)
```

### Opcodes

| Code | Name | Direction | Description |
|------|------|-----------|-------------|
| 0 | DISPATCH | receive | Event dispatched to client |
| 1 | HEARTBEAT | send/receive | Keep-alive ping |
| 2 | IDENTIFY | send | Start a new session |
| 4 | REQUEST_TYPING | send | Cove extension (not in Discord) |
| 6 | RESUME | send | Resume a disconnected session |
| 10 | HELLO | receive | Sent on connect with heartbeat_interval |
| 11 | HEARTBEAT_ACK | receive | Heartbeat acknowledgement |

### Gateway Events

Events are dispatched as opcode 0 with a `t` field naming the event.

#### Channels
- `CHANNEL_CREATE` — new channel created
- `CHANNEL_UPDATE` — channel settings changed
- `CHANNEL_DELETE` — channel removed
- `CHANNEL_PINS_UPDATE` — message pinned/unpinned

#### Messages
- `MESSAGE_CREATE` — new message
- `MESSAGE_UPDATE` — message edited
- `MESSAGE_DELETE` — message deleted
- `MESSAGE_DELETE_BULK` — batch delete (up to 100)
- `MESSAGE_REACTION_ADD` / `REMOVE` / `REMOVE_ALL` / `REMOVE_EMOJI` — reaction changes

#### Guild
- `GUILD_CREATE` — guild becomes available or user joins
- `GUILD_UPDATE` — guild settings changed
- `GUILD_DELETE` — guild becomes unavailable or user leaves
- `GUILD_MEMBER_ADD` / `UPDATE` / `REMOVE` — member changes
- `GUILD_BAN_ADD` / `REMOVE` — ban changes
- `GUILD_ROLE_CREATE` / `UPDATE` / `DELETE` — role changes

#### Presence & Activity
- `PRESENCE_UPDATE` — user status/activity changed
- `TYPING_START` — user started typing (fires once, not continuous)

#### Voice
- `VOICE_STATE_UPDATE` — user join/leave/mute/deaf
- `VOICE_SERVER_UPDATE` — voice server connection info

#### Threads
- `THREAD_CREATE` / `UPDATE` / `DELETE`
- `THREAD_LIST_SYNC` — sync thread list on guild join
- `THREAD_MEMBER_UPDATE` / `THREAD_MEMBERS_UPDATE`

#### Invites
- `INVITE_CREATE` / `INVITE_DELETE`

### Gateway Intents

Intents filter which events you receive. Passed as a bitfield in the Identify payload.

| Intent | Privileged | Events controlled |
|--------|-----------|-------------------|
| GUILDS | No | GUILD_CREATE/UPDATE/DELETE, CHANNEL_*, THREAD_* |
| GUILD_MEMBERS | **Yes** | GUILD_MEMBER_ADD/UPDATE/REMOVE |
| GUILD_MODERATION | No | GUILD_BAN_ADD/REMOVE |
| GUILD_EXPRESSIONS | No | Emoji and sticker events |
| GUILD_INTEGRATIONS | No | Integration events |
| GUILD_WEBHOOKS | No | WEBHOOKS_UPDATE |
| GUILD_INVITES | No | INVITE_CREATE/DELETE |
| GUILD_VOICE_STATES | No | VOICE_STATE_UPDATE |
| GUILD_PRESENCES | **Yes** | PRESENCE_UPDATE |
| GUILD_MESSAGES | No | MESSAGE_CREATE/UPDATE/DELETE in guild channels |
| GUILD_MESSAGE_REACTIONS | No | MESSAGE_REACTION_* in guild channels |
| GUILD_MESSAGE_TYPING | No | TYPING_START in guild channels |
| DIRECT_MESSAGES | No | MESSAGE_* in DMs |
| DIRECT_MESSAGE_REACTIONS | No | MESSAGE_REACTION_* in DMs |
| DIRECT_MESSAGE_TYPING | No | TYPING_START in DMs |
| MESSAGE_CONTENT | **Yes** | Populates content/embeds/attachments/components fields |

"Privileged" intents require approval from Discord for bots in 100+ guilds.

---

## Read State (UNOFFICIAL)

> **Warning:** Read state is NOT part of the official Discord API. It is used by the first-party client only. The information below is from community reverse engineering and unofficial documentation. Behavior may change without notice.

### How it works

- The `READY` gateway payload includes a `read_state` array:
  ```json
  [
    {
      "channel_id": "123456789",
      "last_message_id": "987654321",
      "mention_count": 2
    }
  ]
  ```
- When a user acknowledges a channel, a `MESSAGE_ACK` event is dispatched.
- **Unread check:** `channel.last_message_id > read_state.last_message_id` (snowflake comparison).
- This is why Snowflake IDs are critical for read state — their natural ordering by creation time makes the comparison trivial.

---

## Invite System

Invites are per-channel (not per-guild).

| Field | Type | Description |
|-------|------|-------------|
| code | string | Unique invite code (not a snowflake) |
| channel | channel | Target channel |
| inviter? | user | User who created the invite |
| expires_at | ?ISO8601 | When the invite expires |
| max_uses | integer | Max number of uses (0 = unlimited) |
| uses | integer | Current use count |
| max_age | integer | Duration in seconds before expiry |
| temporary | boolean | Whether membership is temporary |

---

## Permissions

Permissions use a **bitfield** representation (each permission is a single bit).

### Computation order

1. Start with `@everyone` role permissions (base)
2. Apply permissions from all assigned roles (OR together)
3. Apply channel-specific permission overwrites (allow/deny per role and per user)

### Key permissions

| Permission | Bit | Description |
|-----------|-----|-------------|
| VIEW_CHANNEL | 1 << 10 | View the channel |
| SEND_MESSAGES | 1 << 11 | Send messages |
| MANAGE_MESSAGES | 1 << 13 | Delete others' messages, pin |
| MANAGE_CHANNELS | 1 << 4 | Edit/delete channels |
| MANAGE_GUILD | 1 << 5 | Edit guild settings |
| MANAGE_ROLES | 1 << 28 | Create/edit roles below yours |
| ADMINISTRATOR | 1 << 3 | Bypasses all permission checks |

---

## Reactions

Per-message, per-emoji reaction tracking.

| Field | Type | Description |
|-------|------|-------------|
| count | integer | Total reactions with this emoji |
| me | boolean | Whether the current user reacted |
| emoji | emoji | Emoji used |

### Endpoints
- `PUT /channels/{id}/messages/{id}/reactions/{emoji}/@me` — add reaction
- `DELETE /channels/{id}/messages/{id}/reactions/{emoji}/@me` — remove own reaction
- `GET /channels/{id}/messages/{id}/reactions/{emoji}` — list users who reacted

---

## Cove Alignment

How Cove's current implementation maps to Discord's architecture.

### Object Model

| Discord | Cove Status | Notes |
|---------|-------------|-------|
| Snowflake IDs | **Different** — uses UUIDs | UUIDs work for uniqueness but lack natural time-ordering. Read state uses direct ID comparison instead of snowflake math. |
| Guild | **Implemented** | Single default guild seeded on startup. Schema matches (id, name, icon, owner_id). |
| Channel | **Partial** | Core fields present (id, guild_id, name, type, topic, position). Missing: `last_message_id`, `parent_id`. |
| Message | **Partial** | Core fields present. Missing: mentions, attachments, embeds, reactions, pinned, message_reference (replies). Column uses `sender` not `author`. |
| User | **Partial** | Has id, username, avatar, bot. Missing: discriminator, global_name. Adds Cove-specific `bio` field. |
| Member | **Implemented** | Has user, nick, roles, joined_at. Roles stored as JSON string, not enforced. |
| Role | **Not implemented** | No roles table. Member.roles exists but has no corresponding role definitions or enforcement. |
| Permissions | **Not implemented** | No permission bitfield system. All guild members have equal access. |

### Gateway

| Discord Feature | Cove Status | Notes |
|-----------------|-------------|-------|
| Hello / Heartbeat / ACK | **Implemented** | 41.25s interval, 82.5s timeout. |
| Identify | **Implemented** | Token-based auth, returns READY with guilds and presences. |
| Resume | **Not implemented** | Opcode defined in enum but no handler. Disconnects require full re-Identify. |
| Intents | **Not implemented** | All events broadcast to all guild members unconditionally. |
| READY payload | **Implemented** | Includes guilds, user, session_id, presences, read_state. |

### Gateway Events

| Discord Event | Cove Status | Notes |
|---------------|-------------|-------|
| MESSAGE_CREATE | **Implemented** | Broadcasts to guild members. |
| MESSAGE_UPDATE | **Implemented** | Broadcasts on edit. |
| MESSAGE_DELETE | **Implemented** | Broadcasts on delete. |
| MESSAGE_DELETE_BULK | **Not implemented** | Has `deleteAll` endpoint but no bulk gateway event. |
| MESSAGE_ACK | **Implemented** (unofficial) | Dispatched on read state changes. Auto-acks sender's own messages. |
| CHANNEL_CREATE | **Not implemented** | Channel creation doesn't dispatch gateway event. |
| CHANNEL_UPDATE | **Implemented** | Dispatched on channel edit. |
| CHANNEL_DELETE | **Not implemented** | Channel deletion doesn't dispatch gateway event. |
| PRESENCE_UPDATE | **Implemented** | Online/offline on connect/disconnect. |
| TYPING_START | **Implemented** | Via both REST endpoint and REQUEST_TYPING opcode (Cove extension). |
| GUILD_CREATE | **Implemented** | Sent when user is added to a guild. |
| GUILD_DELETE | **Implemented** | Sent when user is removed from a guild. |
| GUILD_MEMBER_ADD/REMOVE | **Not implemented** | Member changes don't dispatch events. |
| GUILD_ROLE_* | **Not applicable** | No role system. |
| MESSAGE_REACTION_* | **Not implemented** | No reaction system. |
| VOICE_STATE_UPDATE | **Not implemented** | No voice system. |
| THREAD_* | **Not implemented** | No thread system. |
| INVITE_CREATE/DELETE | **Not implemented** | Invites exist but no gateway events. |

### REST API

| Discord Endpoint | Cove Status | Notes |
|------------------|-------------|-------|
| GET /guilds/{id}/channels | **Implemented** | Scoped to guild members. |
| POST /guilds/{id}/channels | **Implemented** | Validates types 0, 2, 4, 5, 13. |
| PATCH /channels/{id} | **Implemented** | Name, topic, position, type. |
| DELETE /channels/{id} | **Implemented** | |
| GET /channels/{id}/messages | **Implemented** | Supports limit, before, after, around. |
| POST /channels/{id}/messages | **Implemented** | Text content only. Auto-acks sender read state. |
| PATCH /channels/{id}/messages/{id} | **Implemented** | Content edit with edited_timestamp. |
| DELETE /channels/{id}/messages/{id} | **Implemented** | |
| PUT /channels/{id}/messages/{id}/ack | **Implemented** (unofficial) | Read state acknowledgement. |
| POST /channels/{id}/typing | **Implemented** | |
| GET/PUT/DELETE guild members | **Implemented** | |
| GET/POST/PATCH/DELETE users | **Implemented** | Cove extends with bio, token regeneration. |
| Reaction endpoints | **Not implemented** | |
| Invite endpoints | **Partial** | Invite codes exist in DB for registration; no create/list/delete API. |
| Role endpoints | **Not implemented** | |

### Channel Types

| Type | Discord Name | Cove Status |
|------|-------------|-------------|
| 0 | GUILD_TEXT | **Active** — only type used in practice |
| 1 | DM | **Not implemented** — tracked as issue #111 |
| 2 | GUILD_VOICE | **Accepted** — passes validation, no functionality |
| 4 | GUILD_CATEGORY | **Accepted** — passes validation, no hierarchy support |
| 5 | GUILD_ANNOUNCEMENT | **Accepted** — passes validation, no special behavior |
| 13 | GUILD_STAGE_VOICE | **Accepted** — passes validation, no functionality |
| 10-12 | Threads | **Not supported** |
| 14-16 | Directory/Forum/Media | **Not supported** |

### Priority Gaps

| Gap | Impact | Notes |
|-----|--------|-------|
| No `last_message_id` on channels | Medium | Client must compute unread state from read_state + message list rather than a simple field comparison. |
| No Resume (op 6) | Medium | Every disconnect requires full re-Identify and state re-fetch. |
| No CHANNEL_CREATE/DELETE events | Medium | Other connected clients don't see channel list changes without refresh. |
| No GUILD_MEMBER events | Low | Member list doesn't update in real time. |
| No reactions | Low | Feature gap for user interaction. |
| No permission system | Low | Acceptable for small/trusted deployments; required before multi-guild. |
| No DMs | Low | Tracked as #111. Needed for private agent communication. |
