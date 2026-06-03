import { useEffect, useState } from "react";
import { Avatar, Spin } from "antd";
import * as api from "../lib/api";
import type { GuildMember } from "../types";
import type { CSSProperties } from "react";
import { pickAvatarColor, getContrastTextColor } from "../lib/avatar-palette";
import { usePresenceStore } from "../stores/usePresenceStore";

const styles = {
  root: { width: "var(--member-list-width)", minWidth: "var(--member-list-width)", height: "100%", background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", overflowY: "auto", paddingTop: "var(--header-height)" } as CSSProperties,
  header: { padding: "var(--space-lg) var(--space-lg) var(--space-xs)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" } as CSSProperties,
  member: { display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-sm) var(--space-lg)", borderRadius: 4, cursor: "default", transition: "background 0.15s" } as CSSProperties,
  memberHover: { background: "var(--member-hover)" } as CSSProperties,
  avatar: { flexShrink: 0 } as CSSProperties,
  avatarWrapper: { position: "relative", flexShrink: 0 } as CSSProperties,
  username: { fontSize: "var(--font-size-md)", color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 } as CSSProperties,
  badge: { fontSize: "var(--font-size-xs)", fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: "var(--accent)", color: "var(--text-on-accent)", marginLeft: "var(--space-xs)", flexShrink: 0, lineHeight: "14px", display: "inline-block" } as CSSProperties,
  loading: { display: "flex", justifyContent: "center", padding: "var(--space-xxl)" } as CSSProperties,
};

function statusDotStyle(online: boolean): CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: online ? "var(--status-online)" : "var(--status-offline)",
    border: "2px solid var(--bg-secondary)",
    position: "absolute",
    bottom: -1,
    right: -1,
  };
}

function MemberRow({ member, online }: { member: GuildMember; online: boolean }) {
  const [hovered, setHovered] = useState(false);
  const user = member.user;
  const color = pickAvatarColor(user.username);
  return (
    <div
      style={{ ...styles.member, ...(hovered ? styles.memberHover : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.avatarWrapper}>
        <Avatar size="small" style={{ backgroundColor: color, color: getContrastTextColor(color), fontWeight: 700, ...styles.avatar }}>
          {user.username.charAt(0).toUpperCase()}
        </Avatar>
        <div style={statusDotStyle(online)} />
      </div>
      <span style={styles.username}>{member.nick || user.username}</span>
      {user.bot && <span style={styles.badge}>APP</span>}
    </div>
  );
}

export function MemberList() {
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

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

  const online = members.filter((m) => onlineUsers.has(m.user.id));
  const offline = members.filter((m) => !onlineUsers.has(m.user.id));

  return (
    <div style={styles.root} className="member-list scroll-container">
      {online.length > 0 && (
        <>
          <div style={styles.header}>Online — {online.length}</div>
          {online.map((m) => <MemberRow key={m.user.id} member={m} online />)}
        </>
      )}
      {offline.length > 0 && (
        <>
          <div style={styles.header}>Offline — {offline.length}</div>
          {offline.map((m) => <MemberRow key={m.user.id} member={m} online={false} />)}
        </>
      )}
    </div>
  );
}
