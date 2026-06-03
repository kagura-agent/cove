import { useEffect, useState } from "react";
import { Avatar, Spin } from "antd";
import * as api from "../lib/api";
import type { GuildMember } from "../types";
import type { CSSProperties } from "react";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";

const styles = {
  root: { width: "var(--member-list-width)", minWidth: "var(--member-list-width)", height: "100%", background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflowY: "auto", paddingTop: "var(--header-height)" } as CSSProperties,
  header: { padding: "var(--space-lg) var(--space-lg) var(--space-xs)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" } as CSSProperties,
  member: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-sm) var(--space-lg)", borderRadius: 4, cursor: "default", transition: "background 0.15s" } as CSSProperties,
  memberHover: { background: "var(--member-hover)" } as CSSProperties,
  avatar: { flexShrink: 0 } as CSSProperties,
  username: { fontSize: "var(--font-size-md)", color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 } as CSSProperties,
  badge: { fontSize: "var(--font-size-xs)", fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: "var(--accent)", color: "#ffffff", marginLeft: "var(--space-xs)", flexShrink: 0, lineHeight: "14px", display: "inline-block" } as CSSProperties,
  loading: { display: "flex", justifyContent: "center", padding: "var(--space-xxl)" } as CSSProperties,
};

function hashColor(name: string): string {
  return pickAvatarColor(name);
}

function MemberRow({ member }: { member: GuildMember }) {
  const [hovered, setHovered] = useState(false);
  const user = member.user;
  return (
    <div
      style={{ ...styles.member, ...(hovered ? styles.memberHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Avatar size="small" style={{ backgroundColor: hashColor(user.username), color: getContrastTextColor(hashColor(user.username)), fontWeight: 700, ...styles.avatar }}>
        {user.username.charAt(0).toUpperCase()}
      </Avatar>
      <span style={styles.username}>{member.nick || user.username}</span>
      {user.bot && <span style={styles.badge}>APP</span>}
    </div>
  );
}

export function MemberList() {
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fetchMembers()
      .then(setMembers)
      .catch((err) => console.error("fetch members:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={styles.root} className="member-list scroll-container">
        <div style={styles.loading}><Spin /></div>
      </div>
    );
  }

  return (
    <div style={styles.root} className="member-list scroll-container">
      <div style={styles.header}>Online — {members.length}</div>
      {members.map((m) => <MemberRow key={m.user.id} member={m} />)}
    </div>
  );
}
