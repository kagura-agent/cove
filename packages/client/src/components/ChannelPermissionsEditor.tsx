import React, { useState, useEffect } from "react";
import { PermissionBits, type PermissionOverwrite, type Role } from "@cove/shared";
import { useRoleStore } from "../stores/useRoleStore";

const EMPTY_ROLES: import("@cove/shared").Role[] = [];
const EMPTY_MEMBERS: Record<string, never> = {};
import { useMemberStore } from "../stores/useMemberStore";
import { ThreeStateToggle } from "./ThreeStateToggle";
import * as api from "../lib/api";
import type { GuildMember } from "../types";

type ToggleState = "allow" | "neutral" | "deny";

interface Props {
  channelId: string;
  guildId: string;
  overwrites: PermissionOverwrite[];
  onOverwritesChange: () => void;
}

// Channel-level permissions (no guild-only bits)
const CHANNEL_PERMISSIONS = [
  { header: "GENERAL CHANNEL PERMISSIONS", perms: [
    { key: "CREATE_INSTANT_INVITE", label: "Create Invite" },
    { key: "VIEW_CHANNEL", label: "View Channel" },
    { key: "MANAGE_CHANNELS", label: "Manage Channel" },
    { key: "MANAGE_ROLES", label: "Manage Permissions" },
  ]},
  { header: "TEXT CHANNEL PERMISSIONS", perms: [
    { key: "SEND_MESSAGES", label: "Send Messages" },
    { key: "SEND_MESSAGES_IN_THREADS", label: "Send Messages in Threads" },
    { key: "CREATE_PUBLIC_THREADS", label: "Create Public Threads" },
    { key: "CREATE_PRIVATE_THREADS", label: "Create Private Threads" },
    { key: "EMBED_LINKS", label: "Embed Links" },
    { key: "ATTACH_FILES", label: "Attach Files" },
    { key: "ADD_REACTIONS", label: "Add Reactions" },
    { key: "USE_EXTERNAL_EMOJIS", label: "Use External Emojis" },
    { key: "MENTION_EVERYONE", label: "Mention Everyone" },
    { key: "MANAGE_MESSAGES", label: "Manage Messages" },
    { key: "MANAGE_THREADS", label: "Manage Threads" },
    { key: "READ_MESSAGE_HISTORY", label: "Read Message History" },
    { key: "MANAGE_WEBHOOKS", label: "Manage Webhooks" },
  ]},
] as const;

function getToggleState(allow: bigint, deny: bigint, bit: bigint): ToggleState {
  if (allow & bit) return "allow";
  if (deny & bit) return "deny";
  return "neutral";
}

function setBit(value: bigint, bit: bigint, set: boolean): bigint {
  return set ? value | bit : value & ~bit;
}

export function ChannelPermissionsEditor({ channelId, guildId, overwrites, onOverwritesChange }: Props) {
  const roles = useRoleStore((s) => s.roles[guildId] || EMPTY_ROLES);
  const memberMap = useMemberStore((s) => s.membersByGuildId[guildId] || EMPTY_MEMBERS);
  const members = React.useMemo(() => Object.values(memberMap), [memberMap]);

  const [selectedTarget, setSelectedTarget] = useState<{ id: string; type: number } | null>(null);
  const [editAllow, setEditAllow] = useState(0n);
  const [editDeny, setEditDeny] = useState(0n);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load overwrite state when selecting a target
  useEffect(() => {
    if (!selectedTarget) return;
    const ow = overwrites.find((o) => o.id === selectedTarget.id);
    setEditAllow(ow ? BigInt(ow.allow) : 0n);
    setEditDeny(ow ? BigInt(ow.deny) : 0n);
    setDirty(false);
  }, [selectedTarget, overwrites]);

  function handleToggle(key: string, newState: ToggleState) {
    const bit = PermissionBits[key as keyof typeof PermissionBits];
    if (!bit) return;

    let newAllow = editAllow;
    let newDeny = editDeny;

    if (newState === "allow") {
      newAllow = setBit(newAllow, bit, true);
      newDeny = setBit(newDeny, bit, false);
    } else if (newState === "deny") {
      newAllow = setBit(newAllow, bit, false);
      newDeny = setBit(newDeny, bit, true);
    } else {
      newAllow = setBit(newAllow, bit, false);
      newDeny = setBit(newDeny, bit, false);
    }

    setEditAllow(newAllow);
    setEditDeny(newDeny);
    setDirty(true);
  }

  async function handleSave() {
    if (!selectedTarget) return;
    setSaving(true);
    try {
      await api.putPermissionOverwrite(channelId, selectedTarget.id, {
        type: selectedTarget.type,
        allow: editAllow.toString(),
        deny: editDeny.toString(),
      });
      setDirty(false);
      onOverwritesChange();
    } catch (e) {
      alert("Failed to save permissions");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!selectedTarget) return;
    if (!confirm("Remove all permission overwrites for this target?")) return;
    try {
      await api.deletePermissionOverwrite(channelId, selectedTarget.id);
      setSelectedTarget(null);
      onOverwritesChange();
    } catch (e) {
      alert("Failed to remove overwrite");
    }
  }

  // Build list of targets that have overwrites
  const overwriteTargets = overwrites.map((ow) => {
    if (ow.type === 0) {
      const role = roles.find((r) => r.id === ow.id);
      return { id: ow.id, type: 0, name: role?.name ?? "Unknown Role", color: role?.color ?? 0 };
    } else {
      const member = members.find((m: GuildMember) => m.user.id === ow.id);
      return { id: ow.id, type: 1, name: member?.user.username ?? "Unknown Member", color: 0 };
    }
  });

  return (
    <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
      {/* Left: target list */}
      <div style={{ width: 200, borderRight: "1px solid #3f4147", paddingRight: 12 }}>
        <div style={{ marginBottom: 12 }}>
          <select
            onChange={(e) => {
              const [type, id] = e.target.value.split(":");
              if (id) {
                // Add new overwrite target
                setSelectedTarget({ id, type: parseInt(type) });
              }
            }}
            value=""
            style={{ width: "100%", padding: "6px 8px", backgroundColor: "#1e1f22", color: "#b5bac1", border: "1px solid #3f4147", borderRadius: 4, fontSize: 13 }}
          >
            <option value="">+ Add role/member</option>
            <optgroup label="Roles">
              {roles.filter((r) => !overwrites.some((o) => o.id === r.id)).map((r) => (
                <option key={r.id} value={`0:${r.id}`}>{r.name}</option>
              ))}
            </optgroup>
            <optgroup label="Members">
              {members.filter((m: GuildMember) => !overwrites.some((o) => o.id === m.user.id)).map((m: GuildMember) => (
                <option key={m.user.id} value={`1:${m.user.id}`}>{m.user.username}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {overwriteTargets.map((target) => (
          <div
            key={target.id}
            onClick={() => setSelectedTarget({ id: target.id, type: target.type })}
            style={{
              padding: "8px 10px",
              borderRadius: 4,
              cursor: "pointer",
              backgroundColor: selectedTarget?.id === target.id ? "#3f4147" : "transparent",
              color: target.color ? `#${target.color.toString(16).padStart(6, "0")}` : "#b5bac1",
              fontSize: 13,
              marginBottom: 2,
            }}
          >
            {target.type === 0 ? "⬤ " : "👤 "}{target.name}
          </div>
        ))}
      </div>

      {/* Right: permission toggles */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {selectedTarget ? (
          <>
            {CHANNEL_PERMISSIONS.map((group) => (
              <div key={group.header} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#72767d", marginBottom: 8 }}>
                  {group.header}
                </div>
                {group.perms.map((perm) => {
                  const bit = PermissionBits[perm.key as keyof typeof PermissionBits];
                  const state = getToggleState(editAllow, editDeny, bit);
                  return (
                    <ThreeStateToggle
                      key={perm.key}
                      label={perm.label}
                      value={state}
                      onChange={(v) => handleToggle(perm.key, v)}
                    />
                  );
                })}
              </div>
            ))}

            {/* Save bar */}
            {dirty && (
              <div style={{ position: "sticky", bottom: 0, backgroundColor: "#1e1f22", padding: "12px 0", borderTop: "1px solid #3f4147", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "#b5bac1", fontSize: 14, flex: 1 }}>You have unsaved changes</span>
                <button onClick={() => { const ow = overwrites.find((o) => o.id === selectedTarget.id); setEditAllow(ow ? BigInt(ow.allow) : 0n); setEditDeny(ow ? BigInt(ow.deny) : 0n); setDirty(false); }} style={{ padding: "6px 16px", border: "none", borderRadius: 3, backgroundColor: "transparent", color: "#b5bac1", cursor: "pointer", fontSize: 14 }}>Reset</button>
                <button onClick={handleSave} disabled={saving} style={{ padding: "6px 16px", border: "none", borderRadius: 3, backgroundColor: "#5865f2", color: "#fff", cursor: "pointer", fontSize: 14 }}>{saving ? "Saving…" : "Save Changes"}</button>
              </div>
            )}

            {/* Remove overwrite */}
            <button onClick={handleRemove} style={{ marginTop: 16, padding: "8px 16px", border: "none", borderRadius: 3, backgroundColor: "#da373c", color: "#fff", cursor: "pointer", fontSize: 14 }}>
              Remove Overwrite
            </button>
          </>
        ) : (
          <div style={{ color: "#72767d", padding: 16 }}>Select a role or member to edit channel permissions.</div>
        )}
      </div>
    </div>
  );
}
