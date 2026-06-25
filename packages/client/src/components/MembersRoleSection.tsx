import React, { useState, useRef, useEffect } from "react";
import { useMemberStore } from "../stores/useMemberStore";
import { useRoleStore } from "../stores/useRoleStore";
import { addMemberRole, removeMemberRole } from "../lib/api";
import type { GuildMember } from "../types";

interface Props {
  guildId: string;
  userHighestPosition: number;
}

export function MembersRoleSection({ guildId, userHighestPosition }: Props) {
  const members = useMemberStore((s) => Object.values(s.membersByGuildId[guildId] ?? {}));
  const roles = useRoleStore((s) => s.roles[guildId] ?? []);
  const [dropdownUserId, setDropdownUserId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownUserId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const assignableRoles = roles.filter(
    (r) => r.position < userHighestPosition && r.position > 0 && !r.managed
  );

  async function handleAddRole(userId: string, roleId: string) {
    try {
      await addMemberRole(guildId, userId, roleId);
      setDropdownUserId(null);
    } catch (e) {
      alert("Failed to assign role");
    }
  }

  async function handleRemoveRole(userId: string, roleId: string) {
    try {
      await removeMemberRole(guildId, userId, roleId);
    } catch (e) {
      alert("Failed to remove role");
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 20, color: "#fff" }}>Members</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {members.map((member: GuildMember) => {
          const memberRoles = (member.roles || [])
            .map((rid: string) => roles.find((r) => r.id === rid))
            .filter(Boolean);

          return (
            <div
              key={member.user.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
                borderRadius: 4,
                backgroundColor: "#2b2d31",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  backgroundColor: "#5865f2",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {(member.user.username || "?")[0].toUpperCase()}
              </div>

              {/* Username */}
              <span style={{ color: "#fff", fontSize: 14, minWidth: 100 }}>
                {member.user.username}
                {member.user.bot && <span style={{ color: "#5865f2", marginLeft: 4, fontSize: 11 }}>BOT</span>}
              </span>

              {/* Role badges */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                {memberRoles.map((role: any) => (
                  <span
                    key={role.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 6px",
                      borderRadius: 3,
                      fontSize: 12,
                      backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, "0")}33` : "#3f4147",
                      color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#b5bac1",
                      border: `1px solid ${role.color ? `#${role.color.toString(16).padStart(6, "0")}66` : "#3f4147"}`,
                    }}
                  >
                    {role.name}
                    {role.position < userHighestPosition && !role.managed && (
                      <button
                        onClick={() => handleRemoveRole(member.user.id, role.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "inherit",
                          cursor: "pointer",
                          padding: 0,
                          fontSize: 12,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}

                {/* Add role button */}
                <div style={{ position: "relative" }} ref={dropdownUserId === member.user.id ? dropdownRef : undefined}>
                  <button
                    onClick={() => setDropdownUserId(dropdownUserId === member.user.id ? null : member.user.id)}
                    style={{
                      background: "none",
                      border: "1px dashed #4e5058",
                      borderRadius: 3,
                      color: "#b5bac1",
                      cursor: "pointer",
                      padding: "2px 6px",
                      fontSize: 12,
                    }}
                  >
                    +
                  </button>

                  {dropdownUserId === member.user.id && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        zIndex: 10,
                        backgroundColor: "#1e1f22",
                        border: "1px solid #3f4147",
                        borderRadius: 4,
                        padding: 4,
                        minWidth: 150,
                        maxHeight: 200,
                        overflowY: "auto",
                      }}
                    >
                      {assignableRoles
                        .filter((r) => !member.roles.includes(r.id))
                        .map((role) => (
                          <div
                            key={role.id}
                            onClick={() => handleAddRole(member.user.id, role.id)}
                            style={{
                              padding: "6px 8px",
                              cursor: "pointer",
                              borderRadius: 3,
                              fontSize: 13,
                              color: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#b5bac1",
                            }}
                            onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = "#2b2d31"; }}
                            onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = "transparent"; }}
                          >
                            {role.name}
                          </div>
                        ))}
                      {assignableRoles.filter((r) => !member.roles.includes(r.id)).length === 0 && (
                        <div style={{ padding: "6px 8px", color: "#72767d", fontSize: 13 }}>No roles available</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
