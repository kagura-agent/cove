# Multi-Server Support (Guild Creation + Guild List Sidebar)

**Issues:** #434, #212
**Status:** Draft spec — pending review

## Problem

Cove currently runs a single auto-seeded guild. There is no way to create additional guilds, and no UI to switch between them. This means:

1. All QA testing happens on the production server — risky (accidental deletions, permission changes)
2. No isolation between workspaces (personal vs. team vs. testing)
3. Missing fundamental Discord parity — Discord's leftmost sidebar is the guild list

## Goal

Users can create new servers and switch between them, matching Discord's model.

## Discord Reference

### Guild Creation
- `POST /guilds` creates a guild, caller becomes owner
- New guild comes with a default `#general` text channel
- New guild comes with a default `@everyone` role (id = guild id)
- Owner is the first (and initially only) member

### Guild List Sidebar
- Leftmost narrow sidebar (~72px), always visible
- Circular server icons stacked vertically (avatar or 1-2 letter abbreviation)
- Active server has a pill indicator on the left edge
- Hover shows server name tooltip
- "+" button at bottom to create a new server
- Unread indicator (white dot) on servers with unread messages
- Notification badge count for mentions

## Scope

### Server (API)

#### New Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/guilds` | Create a guild. Body: `{ name: string, icon?: string }`. Returns the created guild object. |
| `PATCH` | `/guilds/:guildId` | Update guild name/icon. Requires owner or MANAGE_GUILD permission. |
| `DELETE` | `/guilds/:guildId` | Delete a guild. Requires owner. |

#### `POST /guilds` Behavior
1. Create guild row with `owner_id` = calling user
2. Create `@everyone` role (id = guild id) with default permissions
3. Create `#general` text channel (position 0)
4. Add calling user as first guild member
5. Dispatch `GUILD_CREATE` gateway event to the creating user's sessions
6. Return full guild object (with channels and roles, matching READY format)

#### `DELETE /guilds/:guildId` Behavior
1. Only the guild owner can delete
2. Cascade-delete all channels, members, messages, roles, webhooks
3. Dispatch `GUILD_DELETE` to all sessions subscribed to this guild

#### Existing Behavior Changes
- Remove auto-seed guild from `initDb()` — **deferred**. Keep the seed for now so existing single-server deployments still work. The seed only runs when no guilds exist.
- Registration flow: new users are NOT auto-joined to any guild. They see an empty guild list and can create their own or join via invite.
  - **Exception:** Keep current behavior for now where seeded users (via env vars) are auto-added to the seeded guild. Revisit when invite system (#171) lands.

### Client (UI)

#### Guild List Sidebar
- New component: `GuildSidebar` — narrow left column before the channel sidebar
- Shows all guilds from `useGuildStore` as circular icons
- Clicking a guild navigates to `/channels/:guildId/:lastChannelId`
- Active guild has a left-edge pill indicator
- Unread dot indicator per guild (aggregate of channel unreads)
- "Create Server" button (`+` icon) at the bottom

#### Create Server Dialog
- Simple modal/dialog triggered by the `+` button
- Fields: Server name (required), icon upload (optional, can defer)
- On submit: `POST /guilds` → add to store → navigate to new guild's `#general`

#### Layout Change
```
Before:  [ Channel Sidebar | Chat ]
After:   [ Guild List | Channel Sidebar | Chat ]
```

The guild list is a narrow (~72px) fixed column. On mobile, it could be hidden behind the existing hamburger menu or shown as a horizontal strip at the top of the sidebar drawer.

### Gateway Events

Already partially implemented. Verify/extend:

| Event | When | Payload |
|-------|------|---------|
| `GUILD_CREATE` | User creates a guild or is added to one | Full guild object (with channels, roles) |
| `GUILD_UPDATE` | Guild name/icon changed | Partial guild object |
| `GUILD_DELETE` | Guild deleted or user removed from one | `{ id }` |

The client already handles `GUILD_CREATE` and `GUILD_DELETE` in `gateway-subscriptions.ts`. Need to:
- Add `GUILD_UPDATE` handler (update guild in store)
- Enhance `GUILD_CREATE` handler to also load channels/roles from the event payload

## Out of Scope

- Invite system (#171) — joining other people's servers. For now, only the creator is a member. Bots/agents can be added via the existing `PUT /guilds/:guildId/members/:userId` endpoint.
- Guild discovery / public guild listing
- Server folders (Discord has these but they're a nice-to-have)
- Drag-to-reorder guilds (can add later)
- Guild icon upload (can type name only for now; icon upload depends on #420 sendMedia)
- DM home button (depends on #111 DM implementation)

## Migration

No schema migration needed — `guilds` table already supports multiple rows. The only code change is adding the `POST /guilds` endpoint and removing the assumption that there's exactly one guild.

## Test Plan

### API Tests
1. `POST /guilds` creates guild with correct owner, @everyone role, and #general channel
2. `POST /guilds` — creator is automatically a member
3. `PATCH /guilds/:guildId` — owner can update name
4. `PATCH /guilds/:guildId` — non-owner without MANAGE_GUILD is rejected
5. `DELETE /guilds/:guildId` — owner can delete, cascades correctly
6. `DELETE /guilds/:guildId` — non-owner is rejected
7. Channels created under a guild are scoped to that guild
8. Members of guild A cannot see guild B's channels

### Client Tests
1. Guild list renders all guilds from store
2. Clicking a guild switches active guild and loads its channels
3. Create server dialog submits and navigates to new guild
4. `GUILD_CREATE` event adds guild to sidebar
5. `GUILD_DELETE` event removes guild and redirects if it was active
6. Unread indicators aggregate correctly across channels per guild
