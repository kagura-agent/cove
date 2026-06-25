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
  mentionable  INTEGER NOT NULL DEFAULT 0,
  flags        INTEGER NOT NULL DEFAULT 0,
  bot_id       TEXT    DEFAULT NULL
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
Returns all roles for the guild (array, sorted by position ascending, ties broken by role ID).

#### POST /guilds/:guildId/roles
Create a new role. Returns the created role.

Requires: MANAGE_ROLES permission + hierarchy constraints (§5.6).

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

Default: name = "new role", position = max(existing positions) + 1, permissions = guild's @everyone role permissions (matching Discord — new roles inherit @everyone's permission set).

**Permission value validation:** The `permissions` value must be a subset of the caller's own computed permissions (see §5.6). Returns 403 `{ message: "Missing Permissions", code: 50013 }` if violated.

#### PATCH /guilds/:guildId/roles/:roleId
Update a role. Returns the modified role.

Requires: MANAGE_ROLES permission + hierarchy constraints (§5.6).

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

Constraints:
- Cannot modify a role at or above your highest role (unless guild owner)
- Cannot modify managed roles (return 403)
- Permission value must be subset of caller's permissions (§5.6)
- Permission value must be subset of caller's permissions (§5.6) — ADMINISTRATOR users can set any permissions including ADMINISTRATOR on lower-position roles

#### DELETE /guilds/:guildId/roles/:roleId
Delete a role. Returns 204 on success.

Requires: MANAGE_ROLES permission.

Constraints:
- Cannot delete the @everyone role
- Cannot delete a role at or above your highest role
- Cannot delete managed roles (return 403)

**Cleanup on deletion (in same transaction):**
- Remove the deleted role ID from all `guild_members.roles` arrays
- Delete all `channel_permission_overwrites` rows where `target_id = roleId AND target_type = 0`
- Emit `GUILD_ROLE_DELETE` only (no GUILD_MEMBER_UPDATE — Discord behavior: clients clean up locally)

#### GET /guilds/:guildId/roles/:roleId
Get a single role. Returns the role object. Requires guild membership.

#### PATCH /guilds/:guildId/roles
Bulk-update role positions. Body is an array of `{ id, position }` objects. Returns 200 with an array of **all** guild role objects (matching Discord).

Requires: MANAGE_ROLES permission.

**Position semantics (matching Discord):**
- Position 0 is reserved exclusively for @everyone (immovable)
- Only the roles included in the request body are updated; others retain current position
- Position values need not be contiguous (gaps are allowed)
- Sorting is by position ascending, ties broken by role ID (snowflake order)
- Request must not include @everyone (return 400 if position 0 is targeted)
- Cannot move a role to or above your highest role position
- Non-existent role IDs in the array are silently ignored
- Duplicate positions across roles are allowed (sorted by ID as tiebreaker)

Wrapped in a single transaction for atomicity.

### 4.2 Role Assignment

#### PUT /guilds/:guildId/members/:userId/roles/:roleId
Add a role to a member. Returns 204.

Requires: MANAGE_ROLES permission.

Constraints:
- Can only assign roles below your highest role
- Cannot assign managed roles (return 403)
- Idempotent: if the member already has the role, return 204 without emitting GUILD_MEMBER_UPDATE

#### DELETE /guilds/:guildId/members/:userId/roles/:roleId
Remove a role from a member. Returns 204.

Requires: MANAGE_ROLES permission.

Constraints:
- Can only remove roles below your highest role
- Cannot remove managed roles (return 403)
- Idempotent: if the member doesn't have the role, return 204 without emitting GUILD_MEMBER_UPDATE

### 4.3 Permission Overwrites (Existing Routes — Enforcement Added)

- `PUT /channels/:channelId/permissions/:targetId` — already implemented, **now requires MANAGE_ROLES** (see §5.3) + **overwrite value constraint** (see §5.6 rule 4)
- `DELETE /channels/:channelId/permissions/:targetId` — already implemented, **now requires MANAGE_ROLES** (see §5.3)

> **Note:** These routes currently allow any human guild member to modify overwrites without authorization. Phase A enforcement fixes this security gap — this is intentionally NOT backward-compatible.

---

## 5. Enforcement Middleware

### 5.1 Approach

Create a `requirePermission(permission: bigint)` middleware that:
1. Gets the authenticated user
2. Loads the guild, member, roles, and channel overwrites
3. Runs `computePermissions()`
4. If the required permission bit is not set, returns 403 `{ message: "Missing Permissions", code: 50013 }`

### 5.2 Helper Functions

Inline helper functions (not Hono middleware) to match existing code architecture. Current codebase uses `requireGuildMember()` which returns the `Channel` object — new helpers follow the same pattern.

```typescript
// For channel-scoped routes — resolves channel → guild → member → roles → overwrites
async function requireChannelPermission(
  repos: Repos,
  channelId: string,
  userId: string,
  permission: bigint
): Promise<Channel> {
  // 1. Load channel → get guild_id
  // 2. Load member by (guild_id, userId)
  // 3. Load all roles for guild
  // 4. Load all overwrites for channel
  // 5. computePermissions() → check bit
  // 6. Return channel (for handler to use)
  // Throws 403 { message: "Missing Permissions", code: 50013 } if denied
}

// For guild-scoped routes — no channel context, checks base permissions only
async function requireGuildPermission(
  repos: Repos,
  guildId: string,
  userId: string,
  permission: bigint
): Promise<Guild> {
  // 1. Load guild
  // 2. Load member by (guildId, userId)
  // 3. Load all roles for guild
  // 4. computeBasePermissions() → check bit
  // 5. Return guild (for handler to use)
  // Throws 403 { message: "Missing Permissions", code: 50013 } if denied
}
```

For thread channels (type 11): `requireChannelPermission` resolves the thread's `parent_id` and uses the **parent channel's** overwrites. Threads do not have independent permission overwrites — this matches Discord's behavior.

Multi-permission checks use AND semantics: `requireChannelPermission(repos, id, userId, SEND_MESSAGES | VIEW_CHANNEL)` requires **both** bits to be set.

**Module location:** `computePermissions` and related functions go in `src/permissions/compute.ts` (new module), imported by both route handlers and WebSocket dispatcher.

### 5.3 Which Routes Get Enforcement

| Route | Helper | Required Permission | Notes |
|---|---|---|---|
| GET channels/:id/messages | requireChannelPermission | VIEW_CHANNEL | |
| POST channels/:id/messages | requireChannelPermission | SEND_MESSAGES \| VIEW_CHANNEL | |
| PATCH channels/:id/messages/:msgId | requireChannelPermission | VIEW_CHANNEL | Author-only check in handler |
| DELETE channels/:id/messages/:msgId | requireChannelPermission | VIEW_CHANNEL | Self-delete: VIEW_CHANNEL only; other's message: MANAGE_MESSAGES. Handler checks `message.author_id === user.id` |
| POST channels/:id/messages/bulk-delete | requireChannelPermission | MANAGE_MESSAGES | |
| PUT channels/:id/messages/:msgId/ack | requireChannelPermission | VIEW_CHANNEL | |
| POST channels/:id/typing | requireChannelPermission | SEND_MESSAGES | |
| PATCH channels/:id | requireChannelPermission | MANAGE_CHANNELS | |
| DELETE channels/:id | requireChannelPermission | MANAGE_CHANNELS | |
| POST guilds/:id/channels | requireGuildPermission | MANAGE_CHANNELS | |
| GET guilds/:guildId/channels | — | — | In-handler per-item VIEW_CHANNEL filter (computePermissions per channel) |
| GET guilds/:guildId/threads/active | — | — | In-handler per-item VIEW_CHANNEL filter |
| PUT channel permissions | requireChannelPermission | MANAGE_ROLES | + overwrite value constraint (§5.6) |
| DELETE channel permissions | requireChannelPermission | MANAGE_ROLES | |
| PATCH guild | requireGuildPermission | MANAGE_GUILD | |
| POST threads | requireChannelPermission | CREATE_PUBLIC_THREADS or CREATE_PRIVATE_THREADS | |
| POST thread messages | requireChannelPermission | SEND_MESSAGES_IN_THREADS | |
| GET guild members | requireGuildPermission | (any guild member) | |
| GET guilds/:guildId/roles | requireGuildPermission | (any guild member) | |
| POST/PATCH/DELETE roles | requireGuildPermission | MANAGE_ROLES | + hierarchy constraints (§5.6) |
| PUT/DELETE member roles | requireGuildPermission | MANAGE_ROLES | + hierarchy constraints (§5.6) |
| Kick/Ban | requireGuildPermission | KICK_MEMBERS / BAN_MEMBERS | |
| POST channels/:id/messages/:msgId/reactions | requireChannelPermission | ADD_REACTIONS \| VIEW_CHANNEL | |
| DELETE reactions (other's) | requireChannelPermission | MANAGE_MESSAGES | |

### 5.4 Guild Owner Bypass

Guild owner always passes all permission checks (returns `ALL_PERMISSIONS` from `computeBasePermissions`).

### 5.5 Bot Behavior — Managed Roles

Bots use the same permission system as human users.

**Trigger:** When `PUT /guilds/:guildId/members/:userId` detects `user.bot === true` and the bot doesn't already have a managed role:

1. Auto-create a managed role:
   - `name`: bot's display name
   - `managed`: true
   - `permissions`: from request body `permissions` field, or default to `VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY | EMBED_LINKS | ATTACH_FILES | ADD_REACTIONS`
   - `position`: max(existing positions) + 1
2. Assign the managed role to the bot's `guild_members.roles`

**Managed role constraints (match Discord):**
- Cannot be modified via standard `PATCH /guilds/:guildId/roles/:roleId` endpoint → return 403
- Cannot be assigned/removed via `PUT/DELETE /guilds/:guildId/members/:userId/roles/:roleId` → return 403
- Only the system (bot join/leave lifecycle) can modify managed roles
- When a bot is removed from the guild, its managed role is deleted

**Migration for existing bots:** Phase 5 creates managed roles for all existing bot members with permissions equivalent to `VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY` (conservative default). Existing per-channel member overwrites (type=1) remain functional and take precedence over the managed role per the algorithm.

### 5.6 Role Hierarchy Security Invariants

These are Discord's core security constraints for MANAGE_ROLES operations:

1. **Position constraint:** Can only create/modify/delete roles with position strictly below the caller's highest role position. Guild owner is exempt.

2. **Permission value constraint:** When creating or modifying a role, the `permissions` value must be a **subset** of the caller's own computed permissions. Specifically:
   - `newRolePermissions & ~callerPermissions` must equal `0n`
   - Exception: users with ADMINISTRATOR can set any permissions including ADMINISTRATOR (they have ALL_PERMISSIONS, so the subset check passes)
   - This matches Discord: ADMINISTRATOR users can grant ADMINISTRATOR to lower-position roles

4. **Channel overwrite value constraint:** When creating or modifying a channel permission overwrite (`PUT /channels/:channelId/permissions/:targetId`), the `allow` and `deny` values are subject to:
   - `allow` and `deny` bits must be a subset of the caller's own computed permissions
   - Guild-level bits cannot appear in channel overwrites: ADMINISTRATOR, KICK_MEMBERS, BAN_MEMBERS, MANAGE_GUILD, VIEW_AUDIT_LOG, MANAGE_NICKNAMES (return 400 if present)
   - MANAGE_ROLES IS allowed in channel overwrites — in channel context it means "Manage Permissions" for that specific channel (Discord T, V, S scope)
   - This prevents a user with MANAGE_ROLES from granting themselves channel-level permissions they don't have via member overwrites

3. **Assignment constraint:** Can only assign/remove roles below the caller's highest role position.

These invariants prevent privilege escalation through role creation.

### 5.7 Performance: Permission Computation

At current scale (single-process SQLite, <100 concurrent users), permission computation runs synchronous queries per-request (guild + member + roles + overwrites = 3-4 queries). **No caching is needed at current scale.**

Optimization path if latency becomes an issue:
- Guild roles change rarely → first candidate for in-memory `Map<guildId, Role[]>` cache
- Invalidate on GUILD_ROLE_CREATE/UPDATE/DELETE events
- Channel overwrites are already loaded per-request for the specific channel (lightweight)

For routes requiring multiple permission bits (e.g., SEND_MESSAGES + VIEW_CHANNEL), compute once and check both bits against the result.

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

### 7.1 Schema Migration (v19-roles)

Migration file: `v19-roles.ts`. Runs at startup before the server accepts requests.

```sql
-- Step 1: Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color INTEGER NOT NULL DEFAULT 0,
  hoist INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '0',
  managed INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_roles_guild ON roles(guild_id);

-- Step 2: For each existing guild, create @everyone role
INSERT OR IGNORE INTO roles (id, guild_id, name, position, permissions)
  SELECT id, id, '@everyone', 0, '<DEFAULT_PERMISSIONS>'
  FROM guilds;

-- Step 3: Clean orphaned role IDs from guild_members.roles
-- (Role IDs that don't correspond to any role in the new table)
-- Implementation: iterate members, JSON.parse(roles), filter to existing role IDs, update
```

**Default permissions for existing guilds' @everyone role:** Same as new guild defaults (§2). This preserves current human behavior because humans currently have unrestricted access, and the default permissions cover all standard operations (VIEW_CHANNEL, SEND_MESSAGES, etc.).

**Idempotency:** `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` ensures the migration can run multiple times safely.

### 7.2 Transition from Current Enforcement

**Current state:**
- `requireGuildMember()` — only checks guild membership for human users
- `requireBotChannelPermission()` — checks channel_permission_overwrites for bot users; humans pass unconditionally (`if (!isBotUser) return true`)
- `PermissionsRepo.hasPermission()` — single (channel_id, target_id) row lookup for bots
- ~30+ callsites across messages.ts, channels.ts, threads.ts, channel-files.ts, webhooks.ts, reactions.ts
- GatewayDispatcher's `broadcastToGuildWithChannelFilter()` — per-message bot filtering

**After migration:**
- `requireChannelPermission(bit)` / `requireGuildPermission(bit)` replace both old helpers
- ALL users (human and bot) go through the same permission computation

**Breaking behavioral change:** Human users gain channel-level restrictions they never had before. This is intentional — it fixes a security gap where any guild member could do anything. The @everyone default permissions (§2) cover all standard operations, so no legitimate workflows break.

**Cutover strategy: Atomic replacement**

Since Phases 1-4 ship as a single deployment (see §9):
1. Old helpers (`requireGuildMember` + `requireBotChannelPermission`) are removed entirely
2. Every route handler is updated to use `requireChannelPermission` or `requireGuildPermission`
3. `PermissionsRepo.hasPermission()` is removed (dead code)
4. GatewayDispatcher's channel filter is updated to use `computePermissions()`

No dual-system period. No feature flag needed. The migration runs first (creating @everyone with default permissions), then the new enforcement code starts.

**Note:** The current `permissions.ts` route allows any human member to modify channel permission overwrites without authorization. Phase 4 enforcement fixes this security gap — this is intentionally NOT backward-compatible for that specific operation (now requires MANAGE_ROLES).

### 7.3 Backward Compatibility

- Existing per-channel overwrites for bot members (type=1) continue working — the algorithm handles them in Step 3 (member-specific overwrite)
- The new algorithm checks both role-level and member-level overwrites
- Bot member overwrites take precedence over managed role (per algorithm order)
- No breaking changes to existing API consumers for standard read/write operations
- **One intentional breaking change:** human users modifying channel permissions now requires MANAGE_ROLES (previously unrestricted)

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

### Phase A: Core Permission System (single PR, atomic deploy)

Phases 1-4 ship together as one migration + code deployment. No intermediate states.

**Data Layer:**
- v19-roles migration (creates table, seeds @everyone, cleans orphaned role IDs)
- `RolesRepo` with CRUD operations
- Auto-create `@everyone` role on guild creation
- Update `PermissionFlags` in shared/types.ts to include all defined bits (remain string-encoded for JSON transport, add `PermissionBits` export with actual bigint values for server-side computation)

**Permission Computation:**
- `computeBasePermissions()` + `computeOverwrites()` + `computePermissions()`
- Unit tests covering all algorithm edge cases
- Thread parent lookup for type-11 channels

**API Endpoints:**
- Role CRUD routes with hierarchy security invariants (§5.6)
- Role assignment routes with MANAGE_ROLES enforcement
- Role position bulk update with transaction
- Permission value validation on create/modify

**Enforcement:**
- `requireChannelPermission()` + `requireGuildPermission()` middleware
- Replace all `requireBotChannelPermission()` and `requireGuildMember()` callsites
- Remove `PermissionsRepo.hasPermission()` (dead code)
- Update GatewayDispatcher channel filter to use `computePermissions()`:
  - Remove the `if (session.user?.bot)` guard — ALL sessions (human and bot) are now filtered
  - Pre-load guild roles + channel overwrites once per broadcast, then per-session query only the member
  - Without this change, human users denied VIEW_CHANNEL would still receive messages via WebSocket → data leak
- Gateway events for role lifecycle

**Rationale for atomic deploy:** Single-process SQLite server with <10 active users. The phased approach creates dangerous intermediate states (API without enforcement = privilege escalation). Migration runs at startup before accepting requests, so there is no window where new code runs without role data.

### Phase B: Bot Integration (separate PR)

- Auto-create managed role on bot join (§5.5)
- Managed role constraints (immutable via standard API)
- Migration: create managed roles for existing bot members
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
