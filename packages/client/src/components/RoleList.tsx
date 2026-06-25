import { useState } from "react";
import type { CSSProperties } from "react";
import { Button } from "antd";
import { useRoleStore } from "../stores/useRoleStore";
import * as api from "../lib/api";

interface RoleListProps {
  guildId: string;
  selectedRoleId: string | null;
  onSelectRole: (roleId: string) => void;
  userHighestPosition: number;
}

export function RoleList({ guildId, selectedRoleId, onSelectRole, userHighestPosition }: RoleListProps) {
  const roles = useRoleStore((s) => s.roles[guildId] ?? []);
  const [creating, setCreating] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    try {
      const role = await api.createRole(guildId);
      useRoleStore.getState().addRole(guildId, role);
      onSelectRole(role.id);
    } catch (err) {
      console.error("create role:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleMoveUp(roleId: string) {
    const idx = roles.findIndex((r) => r.id === roleId);
    if (idx <= 0) return;
    const above = roles[idx - 1];
    const current = roles[idx];
    try {
      const updated = await api.updateRolePositions(guildId, [
        { id: current.id, position: above.position },
        { id: above.id, position: current.position },
      ]);
      const store = useRoleStore.getState();
      for (const r of updated) store.updateRole(guildId, r);
    } catch (err) {
      console.error("move role up:", err);
    }
  }

  async function handleMoveDown(roleId: string) {
    const idx = roles.findIndex((r) => r.id === roleId);
    if (idx < 0 || idx >= roles.length - 1) return;
    const below = roles[idx + 1];
    const current = roles[idx];
    // Don't swap with @everyone (position 0)
    if (below.position === 0) return;
    try {
      const updated = await api.updateRolePositions(guildId, [
        { id: current.id, position: below.position },
        { id: below.id, position: current.position },
      ]);
      const store = useRoleStore.getState();
      for (const r of updated) store.updateRole(guildId, r);
    } catch (err) {
      console.error("move role down:", err);
    }
  }

  const isEveryone = (position: number) => position === 0;
  const isAboveUser = (position: number) => position >= userHighestPosition;

  return (
    <div style={containerStyle}>
      <Button type="primary" onClick={handleCreate} loading={creating} style={{ marginBottom: "var(--space-md)" }}>
        Create Role
      </Button>

      <div style={listStyle}>
        {roles.map((role) => {
          const disabled = isAboveUser(role.position);
          const everyone = isEveryone(role.position);
          const selected = role.id === selectedRoleId;
          const hovered = role.id === hoveredId;
          const showArrows = hovered && !disabled && !everyone;

          return (
            <div
              key={role.id}
              style={{
                ...roleRowStyle,
                ...(selected ? selectedRowStyle : {}),
                ...(disabled ? disabledRowStyle : {}),
                cursor: disabled ? "default" : "pointer",
              }}
              onClick={() => !disabled && onSelectRole(role.id)}
              onMouseEnter={() => setHoveredId(role.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "var(--text-muted)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {role.name}
                </span>
                {role.managed && <span style={{ flexShrink: 0 }} title="Managed role">🤖</span>}
              </div>

              {showArrows && (
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button
                    style={arrowBtnStyle}
                    onClick={(e) => { e.stopPropagation(); handleMoveUp(role.id); }}
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    style={arrowBtnStyle}
                    onClick={(e) => { e.stopPropagation(); handleMoveDown(role.id); }}
                    title="Move down"
                  >
                    ▼
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: 220,
  flexShrink: 0,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  overflowY: "auto",
};

const roleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "var(--space-xs) var(--space-sm)",
  borderRadius: "var(--space-xs)",
  color: "var(--text-normal)",
  fontSize: "var(--font-size-md)",
  userSelect: "none",
};

const selectedRowStyle: CSSProperties = {
  background: "var(--bg-modifier-hover)",
};

const disabledRowStyle: CSSProperties = {
  opacity: 0.5,
};

const arrowBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  padding: "0 2px",
  fontSize: 10,
  lineHeight: 1,
};
