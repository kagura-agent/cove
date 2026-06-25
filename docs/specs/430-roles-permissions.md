# Spec: Server-Level Roles and Permissions (#430)

> Discord parity: implement the full role-based permission system matching Discord's model exactly.

## Problem

Currently, bot channel access is managed per-channel via `channel_permission_overwrites`. Every new channel requires manual `VIEW_CHANNEL` grants per bot. There is no concept of server-level roles, no permission computation algorithm, and no enforcement middleware. The `guild_members.roles` column stores an array of role IDs but there is no `roles` table to define them.

## Design Principle

**Match Discord exactly.** Same data model, same computation algorithm, same API shape. No simplifications, no deviations. Additional Cove features (if any) are additive extensions, never replacements.

---

## 1. Data Model

### 1.1 Role Object

```typescript
interface Role {
  id: string;              // Snowflake
  name: string;            // Role name
  color: number;           // Integer color (0 = no color)
  hoist: boolean;          // Show separately in member list
  position: number;        // Role position (0 = lowest)
  permissions: string;     // Permission bitfield as string (bigint)
  managed: boolean;        // Bot-managed role (auto-created for bots)
  mentionable: boolean;    // Can be mentioned by anyone
}
```

### 1.2 @everyone Role

- Every guild has exactly one `@everyone` role
- Its `id` equals the `guild_id`
- It is implicitly assigned to every member (not stored in `guild_members.roles`)
- Position is always 0 (lowest)
- Created automatically when a guild is created

### 1.3 Database: `roles` Table

```sql
CREATE TABLE IF NOT EXISTS roles (
  id           TEXT PRIMARY KEY,
  guild_id     TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        INTEGER NOT NULL DEFAULT 0,
  hoist        INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0,
  permissions  TEXT NOT NULL DEFAULT '0',
  managed      INTEGER NOT NULL DEFAULT 0,
  mentionable  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_roles_guild ON roles(guild_id);
```

### 1.4 Existing Tables (No Schema Changes Needed)

- `guild_members.roles` — JSON array of role IDs (already exists)
- `channel_permission_overwrites` — already has `target_type` 0 (role) / 1 (member) (already exists)

---

## 2. Permission Bits

Full Discord-compatible bitfield. All bits stored as string-encoded bigints.

| Permission | Bit | Value | Description |
|---|---|---|---|
| CREATE_INSTANT_INVITE | 0 | `1 << 0` | Create channel invites |
| KICK_MEMBERS | 1 | `1 << 1` | Kick members |
| BAN_MEMBERS | 2 | `1 << 2` | Ban members |
| ADMINISTRATOR | 3 | `1 << 3` | **Bypasses all permission checks** |
| MANAGE_CHANNELS | 4 | `1 << 4` | Edit/delete channels |
| MANAGE_GUILD | 5 | `1 << 5` | Edit server settings |
| ADD_REACTIONS | 6 | `1 << 6` | Add reactions to messages |
| VIEW_AUDIT_LOG | 7 | `1 << 7` | View audit log |
| VIEW_CHANNEL | 10 | `1 << 10` | View channel (read messages) |
| SEND_MESSAGES | 11 | `1 << 11` | Send messages |
| SEND_TTS_MESSAGES | 12 | `1 << 12` | Send TTS (reserved) |
| MANAGE_MESSAGES | 13 | `1 << 13` | Delete/pin other's messages |
| EMBED_LINKS | 14 | `1 << 14` | Embed links |
| ATTACH_FILES | 15 | `1 << 15` | Attach files |
| READ_MESSAGE_HISTORY | 16 | `1 << 16` | Read message history |
| MENTION_EVERYONE | 17 | `1 << 17` | Mention @everyone |
| USE_EXTERNAL_EMOJIS | 18 | `1 << 18` | Use external emojis |
| CONNECT | 20 | `1 << 20` | Connect to voice (reserved) |
| SPEAK | 21 | `1 << 21` | Speak in voice (reserved) |
| MUTE_MEMBERS | 22 | `1 << 22` | Mute members (reserved) |
| DEAFEN_MEMBERS | 23 | `1 << 23` | Deafen members (reserved) |
| MOVE_MEMBERS | 24 | `1 << 24` | Move members (reserved) |
| MANAGE_NICKNAMES | 27 | `1 << 27` | Manage nicknames |
| MANAGE_ROLES | 28 | `1 << 28` | Manage roles below own highest |
| MANAGE_WEBHOOKS | 29 | `1 << 29` | Manage channel webhooks |
| MANAGE_THREADS | 34 | `1 << 34` | Manage threads |
| CREATE_PUBLIC_THREADS | 35 | `1 << 35` | Create public threads |
| CREATE_PRIVATE_THREADS | 36 | `1 << 36` | Create private threads |
| SEND_MESSAGES_IN_THREADS | 38 | `1 << 38` | Send in threads |

> Bits marked "reserved" are defined for forward compatibility but won't be enforced until the relevant feature ships.

### Default @everyone Permissions

For a new guild, `@everyone` gets:
```
VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | ADD_REACTIONS |
EMBED_LINKS | ATTACH_FILES | USE_EXTERNAL_EMOJIS |
CREATE_PUBLIC_THREADS | SEND_MESSAGES_IN_THREADS |
CREATE_INSTANT_INVITE
```

---

## 3. Permission Computation Algorithm

Exactly matches [Discord's documented algorithm](https://discord.com/developers/docs/topics/permissions#permission-overwrites):

```typescript
function computeBasePermissions(member: GuildMember, guild: Guild, roles: Role[]): bigint {
  // Guild owner has all permissions
  if (guild.owner_id === member.user_id) {
    return ALL_PERMISSIONS;
  }

  // Start with @everyone role permissions
  const everyoneRole = roles.find(r => r.id === guild.id)!;
  let permissions = BigInt(everyoneRole.permissions);

  // OR permissions from all member's roles
  for (const roleId of member.roles) {
    const role = roles.find(r => r.id === roleId);
    if (role) {
      permissions |= BigInt(role.permissions);
    }
  }

  // ADMINISTRATOR bypasses everything
  if (permissions & ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  return permissions;
}

function computeOverwrites(
  basePermissions: bigint,
  member: GuildMember,
  channel: Channel,
  guildId: string,
  overwrites: PermissionOverwrite[],
): bigint {
  // ADMINISTRATOR bypasses channel overwrites
  if (basePermissions & ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  let permissions = basePermissions;

  // Step 1: Apply @everyone role overwrite
  const everyoneOverwrite = overwrites.find(o => o.id === guildId);
  if (everyoneOverwrite) {
    permissions &= ~BigInt(everyoneOverwrite.deny);
    permissions |= BigInt(everyoneOverwrite.allow);
  }

  // Step 2: Apply role-specific overwrites (combined)
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const roleId of member.roles) {
    const overwrite = overwrites.find(o => o.id === roleId && o.type === 0);
    if (overwrite) {
      roleAllow |= BigInt(overwrite.allow);
      roleDeny |= BigInt(overwrite.deny);
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  // Step 3: Apply member-specific overwrite
  const memberOverwrite = overwrites.find(o => o.id === member.user_id && o.type === 1);
  if (memberOverwrite) {
    permissions &= ~BigInt(memberOverwrite.deny);
    permissions |= BigInt(memberOverwrite.allow);
  }

  return permissions;
}

function computePermissions(
  member: GuildMember,
  channel: Channel,
  guild: Guild,
  roles: Role[],
  overwrites: PermissionOverwrite[],
): bigint {
  const base = computeBasePermissions(member, guild, roles);
  return computeOverwrites(base, member, channel, guild.id, overwrites);
}
```

---

## 4. API Endpoints

### 4.1 Role CRUD

All match Discord's endpoints exactly.

#### GET /guilds/:guildId/roles
Returns all roles for the guild (array, sorted by position).

#### POST /guilds/:guildId/roles
Create a new role. Returns the created role.

Body (all optional):
```json
{
  "name": "new role",
  "permissions": "0",
  "color": 0,
  "hoist": false,
  "mentionable": false
}
```

Default: name = "new role", position = next available, permissions = "0".

#### PATCH /guilds/:guildId/roles/:roleId
Update a role. Returns the modified role.

Body (partial update):
```json
{
  "name": "updated",
  "permissions": "104324673",
  "color": 15158332,
  "hoist": true,
  "mentionable": true
}
```

Constraint: cannot modify a role at or above your highest role (unless guild owner).

#### DELETE /guilds/:guildId/roles/:roleId
Delete a role. Returns 204 on success.

Constraint: cannot delete the @everyone role. Cannot delete a role at or above your highest role.

#### PATCH /guilds/:guildId/roles
Bulk-update role positions. Body is an array of `{ id, position }` objects.

### 4.2 Role Assignment

#### PUT /guilds/:guildId/members/:userId/roles/:roleId
Add a role to a member. Returns 204.

Constraint: can only assign roles below your highest role.

#### DELETE /guilds/:guildId/members/:userId/roles/:roleId
Remove a role from a member. Returns 204.

Constraint: can only remove roles below your highest role.

### 4.3 Permission Overwrites (Already Exists — No Changes)

- `PUT /channels/:channelId/permissions/:targetId` — already implemented
- `DELETE /channels/:channelId/permissions/:targetId` — already implemented

---

## 5. Enforcement Middleware

### 5.1 Approach

Create a `requirePermission(permission: bigint)` middleware that:
1. Gets the authenticated user
2. Loads the guild, member, roles, and channel overwrites
3. Runs `computePermissions()`
4. If the required permission bit is not set, returns 403 `{ message: "Missing Permissions", code: 50013 }`

### 5.2 Which Routes Get Enforcement

| Route | Required Permission |
|---|---|
| GET channels/:id/messages | VIEW_CHANNEL |
| POST channels/:id/messages | SEND_MESSAGES (+ VIEW_CHANNEL) |
| DELETE messages (other's) | MANAGE_MESSAGES |
| PATCH channels/:id | MANAGE_CHANNELS |
| DELETE channels/:id | MANAGE_CHANNELS |
| POST guilds/:id/channels | MANAGE_CHANNELS |
| PUT channel permissions | MANAGE_ROLES |
| DELETE channel permissions | MANAGE_ROLES |
| PATCH guild | MANAGE_GUILD |
| POST threads | CREATE_PUBLIC_THREADS or CREATE_PRIVATE_THREADS |
| POST thread messages | SEND_MESSAGES_IN_THREADS |
| GET guild members | (any guild member) |
| Manage roles | MANAGE_ROLES |
| Kick/Ban | KICK_MEMBERS / BAN_MEMBERS |

### 5.3 Guild Owner Bypass

Guild owner always passes all permission checks (returns `ALL_PERMISSIONS` from `computeBasePermissions`).

### 5.4 Bot Behavior

Bots use the same permission system as human users. When a bot joins:
1. A managed role is auto-created with the bot's name
2. The managed role gets a default permission set (configurable at join time)
3. The role is assigned to the bot's member entry

---

## 6. Gateway Events

When roles or permissions change, emit events to connected clients:

| Event | Payload |
|---|---|
| GUILD_ROLE_CREATE | `{ guild_id, role }` |
| GUILD_ROLE_UPDATE | `{ guild_id, role }` |
| GUILD_ROLE_DELETE | `{ guild_id, role_id }` |
| GUILD_MEMBER_UPDATE | `{ guild_id, user, roles, ... }` (when roles change) |

---

## 7. Migration

### 7.1 Schema Migration

1. Create `roles` table
2. For each existing guild, create an `@everyone` role with `id = guild_id` and default permissions
3. Existing `channel_permission_overwrites` continue to work unchanged (they already reference role/member IDs)

### 7.2 Backward Compatibility

- Existing per-channel overwrites for bot members (type=1) continue working
- The new algorithm will check both role-level and member-level overwrites
- No breaking changes to existing API consumers

---

## 8. Scope Decisions

### In Scope
- `roles` table + CRUD API
- @everyone role auto-creation
- Role → member assignment API
- Full permission computation algorithm
- Enforcement middleware on all routes
- Gateway events for role changes
- Migration

### Out of Scope (explicitly deferred)
- Role hierarchy enforcement for moderation actions (kick/ban only by higher roles)
- Category-level permission inheritance
- UI for role management (API-first, #282 will handle later)
- Role icons / unicode emoji
- 2FA requirement for certain permissions

---

## 9. Implementation Phases

### Phase 1: Data Layer
- Create `roles` table migration
- `RolesRepo` with CRUD operations
- Auto-create `@everyone` role on guild creation
- Migration: create `@everyone` for existing guilds

### Phase 2: Permission Computation
- `computeBasePermissions()` + `computeOverwrites()` + `computePermissions()`
- Unit tests covering all algorithm edge cases
- Update `PermissionFlags` to include all defined bits

### Phase 3: API Endpoints
- Role CRUD routes (GET/POST/PATCH/DELETE)
- Role assignment routes (PUT/DELETE member roles)
- Role position bulk update

### Phase 4: Enforcement
- `requirePermission()` middleware
- Apply to all existing routes
- Gateway events for role lifecycle

### Phase 5: Bot Integration
- Auto-create managed role on bot join
- Update OpenClaw plugin to handle role-based access (no more per-channel overwrites needed)

---

## 10. Test Plan

1. **Unit: Permission computation** — test all algorithm branches (owner bypass, ADMINISTRATOR, @everyone overwrite, role overwrites combined, member overwrite precedence)
2. **Unit: RolesRepo** — CRUD, position ordering, @everyone constraints
3. **Integration: Role API** — create/update/delete roles, position reorder
4. **Integration: Assignment** — add/remove roles from members, verify permission changes
5. **Integration: Enforcement** — verify 403 on missing permission, 200 on granted
6. **Integration: Migration** — existing data preserved, @everyone created
7. **E2E: Bot flow** — bot joins → managed role created → bot gets server-wide access → new channel auto-accessible
