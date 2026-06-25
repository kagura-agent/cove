# Spec: Permissions Management UI (#282)

> Discord parity: add Server Settings → Roles and upgrade Channel Settings → Permissions to use the new role-based permission system (#430).

## Problem

The permissions backend (#430) is live but there's no UI to manage it. Currently:
- No way to create/edit/delete roles
- No way to assign roles to members
- Channel Settings → Permissions only shows bot VIEW_CHANNEL toggles
- Server Settings panel doesn't exist

Users must manage permissions via API calls only.

## Design Principle

**Match Discord's UI patterns.** Same layout structure, same interaction model. Users familiar with Discord should feel at home.

---

## 1. Server Settings Panel

### 1.1 Entry Point

Discord pattern: click server name in sidebar header → dropdown menu → "Server Settings".

Add a gear icon (⚙️) next to the server name in the sidebar header. Clicking it opens the Server Settings panel as a full-screen overlay (same pattern as the existing User Settings panel / `SettingsPanel.tsx`).

Only visible to users with MANAGE_GUILD permission (or guild owner). For our current setup, Luna is the owner so this is always visible.

### 1.2 Navigation

Left sidebar with sections (same layout as `SettingsPanel.tsx` and `ChannelSettings.tsx`):

```
SERVER SETTINGS
  Overview (future — server name, icon, etc.)
  Roles ← this spec
  
USER MANAGEMENT
  Members ← this spec (role assignment)
```

Overview and other sections are out of scope for this PR — just show disabled nav items as placeholders.

### 1.3 Roles Section

#### Role List (left sub-panel)

Discord layout: left side shows the role list, right side shows the selected role's settings.

- List all roles sorted by position (highest first, @everyone at bottom)
- Each role shows: color dot + name
- Click to select → right panel shows that role's settings
- "Create Role" button at the top
- @everyone is always listed, cannot be deleted, but can be edited (permissions only)

#### Role Editor (right sub-panel)

Tabs matching Discord:
- **Display** — name, color
- **Permissions** — permission toggles

**Display Tab:**
- Role name input
- Color picker (preset swatches + custom hex input, matching Discord's palette)
- Save / Reset buttons

**Permissions Tab:**
- Grouped permission toggles matching Discord's categories:

```
GENERAL SERVER PERMISSIONS
  ☐ View Channels
  ☐ Manage Channels
  ☐ Manage Roles
  ☐ Manage Server
  ☐ Create Invite
  ☐ Manage Nicknames
  ☐ Manage Webhooks
  ☐ View Audit Log

MEMBERSHIP PERMISSIONS
  ☐ Kick Members
  ☐ Ban Members

TEXT CHANNEL PERMISSIONS
  ☐ Send Messages
  ☐ Send Messages in Threads
  ☐ Create Public Threads
  ☐ Create Private Threads
  ☐ Embed Links
  ☐ Attach Files
  ☐ Add Reactions
  ☐ Use External Emojis
  ☐ Mention Everyone
  ☐ Manage Messages
  ☐ Manage Threads
  ☐ Read Message History

ADVANCED
  ☐ Administrator
```

Each toggle is a three-state for channel overwrites (allow / neutral / deny) but two-state for role base permissions (on / off).

ADMINISTRATOR toggle shows a warning: "Members with this permission can do everything — including delete the server. Grant carefully."

Changes are tracked locally. Show a save bar at the bottom when there are unsaved changes: "You have unsaved changes" + [Reset] [Save Changes].

#### Create Role

Click "Create Role" → immediately creates a role via `POST /guilds/:guildId/roles` (inherits @everyone permissions as default) → selects the new role in the editor.

#### Delete Role

In the role editor, a "Delete Role" button at the bottom (red, with confirmation dialog). Calls `DELETE /guilds/:guildId/roles/:roleId`.

Cannot delete @everyone (button hidden).

### 1.4 Members Section

List all guild members with their assigned roles.

Each member row shows:
- Avatar / initial + username
- Role badges (colored dots with role names)
- "+" button to assign a role → dropdown of available roles
- Click "×" on a role badge to remove it

API calls:
- `PUT /guilds/:guildId/members/:userId/roles/:roleId` to assign
- `DELETE /guilds/:guildId/members/:userId/roles/:roleId` to remove

---

## 2. Channel Settings → Permissions Upgrade

### 2.1 Current State

The Permissions tab currently shows a simple list of bots with VIEW_CHANNEL on/off toggles. This needs to be replaced with the full Discord-style permissions editor.

### 2.2 New Permissions Tab

Discord layout:
- Left side: list of roles/members that have overwrites on this channel, plus "Add a role or member" button
- Right side: permission toggles for the selected role/member

#### Role/Member List (left)

- Shows all roles and members that have an overwrite entry for this channel
- "Add a role or member" button at top → dropdown/search to add a new overwrite target
- Each entry shows: role color dot + name (for roles) or avatar + username (for members)
- Click to select → right side shows that target's overwrite toggles

#### Permission Toggles (right)

For channel overwrites, each permission is **three-state** (matching Discord):
- ✅ Allow (green checkmark)
- ╳ Deny (red X)  
- ─ Neutral/Inherit (gray slash)

Only channel-relevant permissions shown (not guild-only bits like KICK_MEMBERS, BAN_MEMBERS, MANAGE_GUILD, VIEW_AUDIT_LOG, MANAGE_NICKNAMES, ADMINISTRATOR).

Channel-level permissions to show:

```
GENERAL CHANNEL PERMISSIONS
  View Channel — Allow / Neutral / Deny
  Manage Channel — Allow / Neutral / Deny
  Manage Permissions — Allow / Neutral / Deny  (= MANAGE_ROLES in channel scope)

TEXT CHANNEL PERMISSIONS
  Send Messages
  Send Messages in Threads
  Create Public Threads
  Create Private Threads
  Embed Links
  Attach Files
  Add Reactions
  Use External Emojis
  Mention Everyone
  Manage Messages
  Manage Threads
  Read Message History
  Manage Webhooks
```

Save bar at bottom when changes are pending.

#### Remove Overwrite

"Remove overwrite" button at the bottom of the right panel → removes all allow/deny for this role/member on this channel (`DELETE /channels/:channelId/permissions/:targetId`).

---

## 3. Client API Layer

New functions in `packages/client/src/lib/api.ts`:

```typescript
// Roles
export function fetchRoles(guildId: string): Promise<Role[]>
export function createRole(guildId: string, data?: Partial<Role>): Promise<Role>
export function updateRole(guildId: string, roleId: string, data: Partial<Role>): Promise<Role>
export function deleteRole(guildId: string, roleId: string): Promise<void>
export function updateRolePositions(guildId: string, positions: { id: string; position: number }[]): Promise<Role[]>

// Role assignment
export function addMemberRole(guildId: string, userId: string, roleId: string): Promise<void>
export function removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void>

// Role for single lookup
export function fetchRole(guildId: string, roleId: string): Promise<Role>
```

Permission overwrite APIs already exist (`putPermissionOverwrite`, `deletePermissionOverwrite`).

---

## 4. Client State

### 4.1 New Store: `useRoleStore.ts`

```typescript
interface RoleStore {
  roles: Map<string, Role[]>;  // guildId → roles (sorted by position desc)
  setRoles: (guildId: string, roles: Role[]) => void;
  addRole: (guildId: string, role: Role) => void;
  updateRole: (guildId: string, role: Role) => void;
  removeRole: (guildId: string, roleId: string) => void;
}
```

Populated from READY payload (roles are already included in guild data) and kept in sync via gateway events:
- `GUILD_ROLE_CREATE` → `addRole`
- `GUILD_ROLE_UPDATE` → `updateRole`
- `GUILD_ROLE_DELETE` → `removeRole`

### 4.2 Existing Store Updates

`useMemberStore` — members already have `roles: string[]`. No schema change needed, but `GUILD_MEMBER_UPDATE` should update the member's role list when roles are assigned/removed.

---

## 5. Gateway Event Handling

Subscribe to new events in `gateway-subscriptions.ts`:

```typescript
subscribe("GUILD_ROLE_CREATE", (data) => {
  useRoleStore.getState().addRole(data.guild_id, data.role);
});
subscribe("GUILD_ROLE_UPDATE", (data) => {
  useRoleStore.getState().updateRole(data.guild_id, data.role);
});
subscribe("GUILD_ROLE_DELETE", (data) => {
  useRoleStore.getState().removeRole(data.guild_id, data.role_id);
});
```

---

## 6. READY Payload

Check if the server already includes `roles` in the READY guild data. If not, the client should call `GET /guilds/:guildId/roles` on startup to populate the store.

---

## 7. Routing

Server Settings opens as a full-screen overlay (not URL-routed), matching Discord's behavior. No new routes needed — it's a modal triggered by the sidebar gear icon.

Channel Settings already has its own modal pattern — just upgrading the Permissions tab content.

---

## 8. Scope

### In Scope
- Server Settings panel shell (with Roles and Members sections)
- Role CRUD UI (create, edit name/color/permissions, delete, position reorder)
- Role assignment UI (add/remove roles on members)
- Channel Permissions upgrade (three-state toggles for role/member overwrites)
- Client API functions for role endpoints
- Role store + gateway event subscriptions
- Save bar pattern for unsaved changes

### Out of Scope
- Server Overview section (server name/icon editing)
- Role drag-and-drop reordering (use up/down buttons for now)
- Role icons / unicode emoji
- Animated role color preview
- Permission calculator / "effective permissions" viewer
- Audit log viewer
- Category-level permission inheritance

---

## 9. Implementation Phases

### Phase 1: Foundation
- `useRoleStore` + gateway subscriptions
- Client API functions for roles
- READY payload roles handling
- Server Settings panel shell (overlay + nav)

### Phase 2: Role Management
- Role list + role editor (Display + Permissions tabs)
- Create / delete role
- Permission toggles (two-state for base permissions)
- Save bar pattern

### Phase 3: Members
- Members section with role assignment
- Role badge display
- Add/remove role interactions

### Phase 4: Channel Permissions Upgrade
- Replace current bot visibility toggles with full overwrite editor
- Three-state permission toggles
- Add role/member to channel overwrites
- Remove overwrite

---

## 10. Test Plan

1. **Role CRUD** — create role, edit name/color/permissions, delete, verify gateway events update UI
2. **Permission toggles** — toggle each permission, save, reload, verify persisted
3. **Role assignment** — assign role to member, remove role, verify member's effective permissions change
4. **Channel overwrites** — add role overwrite, set allow/deny, verify channel access changes
5. **@everyone** — cannot delete, can edit permissions, verify changes affect all members
6. **Concurrent updates** — two tabs open, edit role in one, verify gateway event updates the other
7. **Edge cases** — attempt to delete role that's assigned, create role when at position limit
