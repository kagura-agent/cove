import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { Input, Button, Switch, Modal } from "antd";
import { PermissionBits } from "@cove/shared";
import type { Role } from "@cove/shared";
import { useRoleStore } from "../stores/useRoleStore";

const EMPTY_ROLES: import("@cove/shared").Role[] = [];
import * as api from "../lib/api";

interface RoleEditorProps {
  guildId: string;
  roleId: string;
  userHighestPosition: number;
  userPermissions: bigint;
}

type TabKey = "display" | "permissions";

/* ── Permission Groups ─────────────────────────────────────── */

const PERMISSION_GROUPS: { label: string; perms: { key: keyof typeof PermissionBits; label: string }[] }[] = [
  {
    label: "GENERAL SERVER",
    perms: [
      { key: "MANAGE_GUILD", label: "Manage Server" },
      { key: "MANAGE_CHANNELS", label: "Manage Channels" },
      { key: "MANAGE_ROLES", label: "Manage Roles" },
      { key: "MANAGE_WEBHOOKS", label: "Manage Webhooks" },
      { key: "VIEW_AUDIT_LOG", label: "View Audit Log" },
      { key: "CREATE_INSTANT_INVITE", label: "Create Invite" },
    ],
  },
  {
    label: "MEMBERSHIP",
    perms: [
      { key: "KICK_MEMBERS", label: "Kick Members" },
      { key: "BAN_MEMBERS", label: "Ban Members" },
      { key: "MANAGE_NICKNAMES", label: "Manage Nicknames" },
    ],
  },
  {
    label: "TEXT CHANNEL",
    perms: [
      { key: "VIEW_CHANNEL", label: "View Channels" },
      { key: "SEND_MESSAGES", label: "Send Messages" },
      { key: "SEND_MESSAGES_IN_THREADS", label: "Send Messages in Threads" },
      { key: "CREATE_PUBLIC_THREADS", label: "Create Public Threads" },
      { key: "CREATE_PRIVATE_THREADS", label: "Create Private Threads" },
      { key: "MANAGE_MESSAGES", label: "Manage Messages" },
      { key: "MANAGE_THREADS", label: "Manage Threads" },
      { key: "EMBED_LINKS", label: "Embed Links" },
      { key: "ATTACH_FILES", label: "Attach Files" },
      { key: "ADD_REACTIONS", label: "Add Reactions" },
      { key: "USE_EXTERNAL_EMOJIS", label: "Use External Emojis" },
      { key: "MENTION_EVERYONE", label: "Mention @everyone" },
      { key: "READ_MESSAGE_HISTORY", label: "Read Message History" },
      { key: "SEND_TTS_MESSAGES", label: "Send TTS Messages" },
    ],
  },
  {
    label: "ADVANCED",
    perms: [
      { key: "ADMINISTRATOR", label: "Administrator" },
    ],
  },
];

const PRESET_COLORS = [0x5865f2, 0x57f287, 0xfee75c, 0xeb459e, 0xed4245, 0xf47b67, 0xe67e22, 0x1abc9c, 0x3498db, 0x9b59b6];

export function RoleEditor({ guildId, roleId, userHighestPosition, userPermissions }: RoleEditorProps) {
<<<<<<< HEAD
  const roles = useRoleStore((s) => s.roles[guildId] || EMPTY_ROLES);
=======
  const roles = useRoleStore((s) => s.roles[guildId] ?? []);
>>>>>>> ea54fc4 (fix(client): fix all unstable zustand selectors causing React #185)
  const role = roles.find((r) => r.id === roleId);

  const [tab, setTab] = useState<TabKey>("display");
  const [name, setName] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [permissions, setPermissions] = useState(0n);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false);

  const isEveryone = role?.position === 0;
  const isManaged = role?.managed ?? false;
  const isAboveUser = (role?.position ?? 0) >= userHighestPosition;
  const readOnly = isManaged || isAboveUser;

  // Sync form state from role
  useEffect(() => {
    if (!role) return;
    setName(role.name);
    setColorHex(role.color ? role.color.toString(16).padStart(6, "0") : "");
    setPermissions(BigInt(role.permissions));
  }, [role?.id, role?.name, role?.color, role?.permissions]);

  // Reset tab if switching to @everyone
  useEffect(() => {
    if (isEveryone && tab === "display") setTab("permissions");
  }, [isEveryone, tab]);

  // Dirty detection
  const isDirty = useMemo(() => {
    if (!role) return false;
    const origColor = role.color ? role.color.toString(16).padStart(6, "0") : "";
    if (name !== role.name) return true;
    if (colorHex !== origColor) return true;
    if (permissions !== BigInt(role.permissions)) return true;
    return false;
  }, [role, name, colorHex, permissions]);

  function handleReset() {
    if (!role) return;
    setName(role.name);
    setColorHex(role.color ? role.color.toString(16).padStart(6, "0") : "");
    setPermissions(BigInt(role.permissions));
  }

  async function handleSave() {
    if (!role) return;
    setSaving(true);
    try {
      const colorNum = colorHex ? parseInt(colorHex, 16) : 0;
      const updated = await api.updateRole(guildId, roleId, {
        name,
        color: colorNum,
        permissions: permissions.toString(),
      });
      useRoleStore.getState().updateRole(guildId, updated);
    } catch (err) {
      alert("Failed to save role");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await api.deleteRole(guildId, roleId);
      useRoleStore.getState().removeRole(guildId, roleId);
    } catch (err) {
      alert("Failed to delete role");
    } finally {
      setDeleteConfirmOpen(false);
    }
  }

  function togglePermission(bit: bigint) {
    if (bit === PermissionBits.ADMINISTRATOR && !(permissions & bit)) {
      setAdminConfirmOpen(true);
      return;
    }
    setPermissions((prev) => prev ^ bit);
  }

  function confirmAdmin() {
    setPermissions((prev) => prev | PermissionBits.ADMINISTRATOR);
    setAdminConfirmOpen(false);
  }

  if (!role) {
    return <div style={{ color: "var(--text-muted)", padding: "var(--space-lg)" }}>Select a role to edit.</div>;
  }

  return (
    <div style={editorContainerStyle}>
      {/* Tabs */}
      <div style={tabBarStyle}>
        {!isEveryone && (
          <button
            style={{ ...tabBtnStyle, ...(tab === "display" ? tabActiveStyle : {}) }}
            onClick={() => setTab("display")}
          >
            Display
          </button>
        )}
        <button
          style={{ ...tabBtnStyle, ...(tab === "permissions" ? tabActiveStyle : {}) }}
          onClick={() => setTab("permissions")}
        >
          Permissions
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-lg) 0" }}>
        {/* Display Tab */}
        {tab === "display" && !isEveryone && (
          <div>
            <div style={{ marginBottom: "var(--space-xl)" }}>
              <label style={fieldLabelStyle}>ROLE NAME</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                disabled={readOnly}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: "var(--space-xl)" }}>
              <label style={fieldLabelStyle}>ROLE COLOR</label>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>#</span>
                <Input
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6))}
                  maxLength={6}
                  disabled={readOnly}
                  style={{ ...inputStyle, width: 100 }}
                  placeholder="000000"
                />
                {colorHex && (
                  <div style={{ width: 24, height: 24, borderRadius: 4, backgroundColor: `#${colorHex.padStart(6, "0")}` }} />
                )}
              </div>
              <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                {PRESET_COLORS.map((c) => {
                  const hex = c.toString(16).padStart(6, "0");
                  return (
                    <button
                      key={c}
                      style={{
                        ...swatchStyle,
                        backgroundColor: `#${hex}`,
                        outline: colorHex === hex ? "2px solid var(--text-normal)" : "none",
                        outlineOffset: 2,
                      }}
                      onClick={() => !readOnly && setColorHex(hex)}
                      disabled={readOnly}
                      title={`#${hex}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Permissions Tab */}
        {tab === "permissions" && (
          <div>
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: "var(--space-xl)" }}>
                <label style={fieldLabelStyle}>{group.label}</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                  {group.perms.map(({ key, label }) => {
                    const bit = PermissionBits[key];
                    const checked = (permissions & bit) !== 0n;
                    const canToggle = !readOnly && (userPermissions & bit) !== 0n;
                    return (
                      <div key={key} style={permRowStyle}>
                        <span style={{ color: canToggle ? "var(--text-normal)" : "var(--text-muted)" }}>{label}</span>
                        <Switch
                          checked={checked}
                          disabled={!canToggle}
                          onChange={() => togglePermission(bit)}
                          size="small"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete button */}
        {!isEveryone && !isManaged && !isAboveUser && (
          <div style={{ marginTop: "var(--space-xl)", paddingTop: "var(--space-lg)", borderTop: "1px solid var(--border-subtle)" }}>
            <Button danger onClick={() => setDeleteConfirmOpen(true)}>
              Delete Role
            </Button>
          </div>
        )}
      </div>

      {/* Save bar */}
      {isDirty && !readOnly && (
        <div style={saveBarStyle}>
          <span style={{ color: "var(--text-normal)", fontSize: "var(--font-size-md)" }}>
            You have unsaved changes
          </span>
          <div style={{ display: "flex", gap: "var(--space-sm)" }}>
            <Button onClick={handleReset} disabled={saving}>Reset</Button>
            <Button type="primary" onClick={handleSave} loading={saving}>Save Changes</Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <Modal
        title="Delete Role"
        open={deleteConfirmOpen}
        onOk={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
        okText="Delete"
        okButtonProps={{ danger: true }}
      >
        <p>Are you sure you want to delete <strong>{role.name}</strong>? This cannot be undone.</p>
      </Modal>

      {/* Admin confirmation */}
      <Modal
        title="Enable Administrator"
        open={adminConfirmOpen}
        onOk={confirmAdmin}
        onCancel={() => setAdminConfirmOpen(false)}
        okText="Enable"
        okButtonProps={{ danger: true }}
      >
        <p>
          Granting Administrator gives this role full access to the server, bypassing all permission checks.
          Are you sure?
        </p>
      </Modal>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const editorContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
};

const tabBarStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-xs)",
  borderBottom: "1px solid var(--border-subtle)",
  paddingBottom: "var(--space-xs)",
};

const tabBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: "var(--space-xs) var(--space-md)",
  fontSize: "var(--font-size-md)",
  color: "var(--text-muted)",
  cursor: "pointer",
  borderRadius: "var(--space-xs)",
};

const tabActiveStyle: CSSProperties = {
  color: "var(--text-normal)",
  background: "var(--bg-modifier-hover)",
  fontWeight: 600,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  display: "block",
  marginBottom: "var(--space-xs)",
};

const inputStyle: CSSProperties = {
  background: "var(--input-background, var(--bg-tertiary))",
  borderColor: "var(--border-subtle)",
  color: "var(--text-normal)",
};

const permRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-xs) var(--space-sm)",
  borderRadius: "var(--space-xs)",
};

const saveBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-md) var(--space-lg)",
  background: "var(--bg-tertiary, var(--bg-secondary))",
  borderRadius: "var(--space-xs)",
  position: "sticky",
  bottom: 0,
};

const swatchStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  border: "none",
  cursor: "pointer",
};
